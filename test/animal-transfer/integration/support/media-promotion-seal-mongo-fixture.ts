import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { HttpResponse } from '@smithy/protocol-http';
import { MediaPromotionVerifier } from '../../../../src/context/animal-media/application/media-promotion-verifier';
import { AwsMediaPromotionDestinationReader } from '../../../../src/context/animal-media/infrastructure/aws-media-promotion-destination-reader';
import { MEDIA_PROMOTION_STORAGE_PROTOCOL } from '../../../../src/context/animal-media/domain/media-promotion-persistence';
import { promotionFixture } from '../../fixtures/media-promotion.fixture';
import { LocalMongoTestSettings } from './local-mongo-test-safety';
import { MediaPromotionMongoFixture } from './media-promotion-mongo-fixture';
import {
  assertOwnedSealTestDatabase,
  createSealTestNamespace,
  readPromotionSealMongoSettings,
} from './media-promotion-seal-mongo-safety';
import { PromotionSealTransport } from './promotion-seal-transport';

export const SEAL_BYTES = Buffer.alloc(32, 'a');
export const SEAL_SHA256 = createHash('sha256')
  .update(SEAL_BYTES)
  .digest('hex');
export const SEAL_REVISION = {
  etag: '"final"',
  size: 32,
  versionId: 'final/version 1',
};
export class PromotionSealMongoFixture extends MediaPromotionMongoFixture {
  override readonly namespace = createSealTestNamespace();
  transport!: PromotionSealTransport;
  private readonly clients: S3Client[] = [];
  protected override assertOwnership(
    name: string,
    marker: unknown,
    collections: string[],
  ): void {
    assertOwnedSealTestDatabase(this.namespace, name, marker, collections);
  }
  override async open(settings: LocalMongoTestSettings): Promise<void> {
    const checked = readPromotionSealMongoSettings({
      MEDIA_PROMOTION_SEAL_MONGO_TESTS: '1',
      MEDIA_PROMOTION_SEAL_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    this.transport = new PromotionSealTransport(checked);
    await super.open(checked);
  }
  async seedSeal(
    kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
    authorized = true,
    intended = true,
  ) {
    if (authorized && !intended)
      throw new Error('Authorization requires an intention');
    const f = promotionFixture(kind),
      j = f.journal;
    const handle = { id: j.id, instanceId: j.instanceId };
    const selection = {
      operationId: j.id,
      instanceId: j.instanceId,
      animalId: f.animalId,
    };
    await this.left.controls.create(
      [{ animalId: f.animalId, ownerId: j.actorId, ownershipVersion: 2 }],
      { w: 'majority' },
    );
    await this.left.journal.create({
      ...handle,
      protocol: j.protocol,
      mediaPromotionProtocol: MEDIA_PROMOTION_STORAGE_PROTOCOL,
      actorId: j.actorId,
      kind,
      instanceStartedAt: j.createdAt,
      createdAt: j.createdAt,
      updatedAt: j.createdAt,
      issuesUploadUrl: false,
      lifecycle: 'OPEN',
      callback: 'NOT_STARTED',
      claims: [
        {
          animalId: f.animalId,
          state: 'NOT_ATTEMPTED',
          updatedAt: j.createdAt,
        },
      ],
    });
    await this.left.journal.claim(handle, f.animalId, 'INTENT', j.createdAt, 2);
    if (
      !(await this.left.ownership.beginWrite({
        animalId: f.animalId,
        ownerId: j.actorId,
        expectedOwnershipVersion: 2,
        token: j.id,
        startedAt: j.createdAt,
        journal: { operationId: j.id, instanceId: j.instanceId },
      }))
    )
      throw new Error('Seal fixture claim acquisition failed');
    await this.left.journal.permitCallback(handle, j.createdAt);
    const { pinned, ...ordinary } = f.upload;
    const pin = { ...pinned!, sha256: SEAL_SHA256 };
    await this.left.uploadRepository.create(ordinary);
    const upload = await this.left.uploadRepository.pin(ordinary.finalKey, pin); // First pin, never rewritten.
    this.transport.bindDestination(upload.finalKey);
    await this.left.repository.open(selection);
    await this.left.repository.apply(selection, 0, {
      type: 'DECLARE_EFFECT',
      effectId: f.effectId,
      uploadId: upload.id,
      bucket: 'animalrecord-test-media',
    });
    if (intended) await this.left.repository.apply(selection, 1, f.intention);
    const authorize = { ...f.authorize, dispatcherInstanceId: f.id(10) };
    if (authorized) await this.left.repository.apply(selection, 2, authorize);
    const input = {
      selection,
      scope: f.initial.scope,
      effectId: f.effectId,
      observationId: f.id(40),
    };
    const observation = {
      id: input.observationId,
      finding: 'MATCH' as const,
      uploadId: upload.id,
      sha256: SEAL_SHA256,
      revision: { ...SEAL_REVISION },
      evidenceRef: 'test:seal-verified',
    };
    return {
      id: f.id,
      input,
      selection,
      handle,
      upload,
      authorize,
      intention: f.intention,
      attemptId: f.attemptId,
      observation,
      head: (overrides: Record<string, string> = {}) =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: SEAL_REVISION.etag,
            'content-length': '32',
            'content-type': upload.mimeType,
            'x-amz-version-id': SEAL_REVISION.versionId,
            'x-amz-meta-animal-upload-id': upload.id,
            'x-amz-meta-animal-upload-sha256': SEAL_SHA256,
            ...overrides,
          },
          body: Readable.from([]),
        }),
      get: (bytes = SEAL_BYTES) =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: SEAL_REVISION.etag,
            'content-length': '32',
            'x-amz-version-id': SEAL_REVISION.versionId,
          },
          body: Readable.from([bytes]),
        }),
    };
  }
  verifier(side: 'left' | 'right' = 'left'): MediaPromotionVerifier {
    const client = new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'SYNTHETIC',
        secretAccessKey: 'synthetic-secret',
      },
      requestHandler: new NodeHttpHandler(),
      retryMode: 'standard',
      defaultsMode: 'standard',
      maxAttempts: 3,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      followRegionRedirects: false,
      useFipsEndpoint: false,
      useDualstackEndpoint: false,
    });
    this.clients.push(client);
    return new MediaPromotionVerifier(
      this[side].repository,
      new AwsMediaPromotionDestinationReader(client),
    );
  }
  override async drain(): Promise<void> {
    this.transport?.releaseAll();
    await super.drain();
    for (const client of this.clients.splice(0)) client.destroy();
  }
  override async close(): Promise<void> {
    try {
      await super.close();
    } finally {
      this.transport?.restore();
    }
  }
}
