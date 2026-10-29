import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { HttpResponse } from '@smithy/protocol-http';
import { AwsMediaPromotionConfirmation } from '../../../../src/context/animal-media/infrastructure/aws-media-promotion-confirmation';
import { MEDIA_PROMOTION_STORAGE_PROTOCOL } from '../../../../src/context/animal-media/domain/media-promotion-persistence';
import { promotionFixture } from '../../fixtures/media-promotion.fixture';
import { LocalMongoTestSettings } from './local-mongo-test-safety';
import { MediaPromotionMongoFixture } from './media-promotion-mongo-fixture';
import {
  assertOwnedConfirmTestDatabase,
  createConfirmTestNamespace,
  readPromotionConfirmMongoSettings,
} from './media-promotion-confirm-mongo-safety';
import { PromotionConfirmTransport } from './promotion-confirm-transport';
import { PromotionConfirmationCall } from '../../../../src/context/animal-media/domain/media-promotion-confirmation-runner';
import { mediaConfirmationContext } from '../../../../src/context/animal-media/domain/media-confirmation-context';
import { promotionId } from '../../../../src/context/animal-media/domain/media-promotion-effect';

/** Fixture-only correlation of backend-generated IDs; never a grant or an SDK retry. */
export function captureConfirmTestCall(
  raw: PromotionConfirmationCall,
  expected: PromotionConfirmationCall,
): Readonly<PromotionConfirmationCall> {
  const scope = mediaConfirmationContext(raw.scope, expected.scope);
  if (
    Object.keys(raw).sort().join(',') !==
      'dispatcherInstanceId,effectId,observationId,scope,uploadId' ||
    scope.operationId !== expected.scope.operationId ||
    scope.instanceId !== expected.scope.instanceId ||
    scope.ownershipVersion !== expected.scope.ownershipVersion ||
    raw.uploadId !== expected.uploadId
  )
    throw new Error('Confirmation fixture call binding mismatch');
  const call = Object.freeze({
    scope,
    uploadId: promotionId(raw.uploadId),
    effectId: promotionId(raw.effectId),
    dispatcherInstanceId: promotionId(raw.dispatcherInstanceId),
    observationId: promotionId(raw.observationId),
  });
  if (
    new Set([
      scope.operationId,
      scope.instanceId,
      call.uploadId,
      call.effectId,
      call.dispatcherInstanceId,
      call.observationId,
    ]).size !== 6
  )
    throw new Error('Confirmation fixture identities must be separate');
  return call;
}

export const CONFIRM_BYTES = Buffer.alloc(32, 'a');
export const CONFIRM_SHA256 = createHash('sha256')
  .update(CONFIRM_BYTES)
  .digest('hex');
export const CONFIRM_REVISION = {
  etag: '"final"',
  size: 32,
  versionId: 'final/version 1',
};

export class PromotionConfirmMongoFixture extends MediaPromotionMongoFixture {
  override readonly namespace = createConfirmTestNamespace();
  transport!: PromotionConfirmTransport;
  readonly delegatedPermissions: string[] = [];
  protected override monitoredCommands(): string[] {
    return [
      ...super.monitoredCommands(),
      'hello',
      'listCollections',
      'listIndexes',
      'create',
    ];
  }
  protected override assertOwnership(
    name: string,
    marker: unknown,
    collections: string[],
  ): void {
    assertOwnedConfirmTestDatabase(this.namespace, name, marker, collections);
  }
  override async open(settings: LocalMongoTestSettings): Promise<void> {
    const checked = readPromotionConfirmMongoSettings({
      MEDIA_PROMOTION_CONFIRM_MONGO_TESTS: '1',
      MEDIA_PROMOTION_CONFIRM_MONGO_TEST_URI: settings.uri,
    });
    if (checked.replicaSet !== settings.replicaSet)
      throw new Error('Replica-set settings disagree');
    this.transport = new PromotionConfirmTransport(checked);
    await super.open(checked);
  }
  async seedConfirmation(
    kind: 'PROFILE_CONFIRM' | 'ATTACHMENT_CONFIRM' = 'PROFILE_CONFIRM',
    optIn = true,
  ) {
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
      ...(optIn
        ? { mediaPromotionProtocol: MEDIA_PROMOTION_STORAGE_PROTOCOL }
        : {}),
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
      throw new Error('Confirmation fixture claim acquisition failed');
    await this.left.journal.permitCallback(handle, j.createdAt);
    const { pinned, ...ordinary } = f.upload;
    await this.left.uploadRepository.create(ordinary);
    const upload = await this.left.uploadRepository.pin(ordinary.finalKey, {
      ...pinned!,
      sha256: CONFIRM_SHA256,
      versionId: 'source/version 1',
    });
    this.transport.bind(f.initial.scope, upload, CONFIRM_REVISION);
    const input = {
      scope: f.initial.scope,
      uploadId: upload.id,
      effectId: f.effectId,
      dispatcherInstanceId: f.id(30),
      observationId: f.id(40),
    };
    let expectedCall: PromotionConfirmationCall = input;
    let observed = false;
    this.transport.beforePut = async () => {
      const attempt = await this.right.records
        .findOne({
          operationId: selection.operationId,
          kind: 'ATTEMPT',
          effectId: expectedCall.effectId,
        })
        .sort({ ordinal: -1 })
        .read('primary')
        .readConcern('majority')
        .lean()
        .exec();
      if (
        attempt?.kind !== 'ATTEMPT' ||
        !attempt.authorizationId ||
        attempt.data.dispatcherInstanceId !==
          expectedCall.dispatcherInstanceId ||
        this.delegatedPermissions.includes(attempt.authorizationId)
      )
        throw new Error(
          'A fresh committed permission must precede each synthetic PUT',
        );
      this.delegatedPermissions.push(attempt.authorizationId);
    };
    return {
      ...f,
      selection,
      handle,
      upload,
      input,
      observeCall: (call: PromotionConfirmationCall) => {
        if (observed)
          throw new Error('Confirmation fixture call already observed');
        expectedCall = captureConfirmTestCall(call, input);
        observed = true;
        return expectedCall;
      },
      head: () =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: CONFIRM_REVISION.etag,
            'content-length': '32',
            'x-amz-version-id': CONFIRM_REVISION.versionId,
            'content-type': upload.mimeType,
            'x-amz-meta-animal-upload-id': upload.id,
            'x-amz-meta-animal-upload-sha256': CONFIRM_SHA256,
          },
          body: Readable.from([]),
        }),
      get: (bytes = CONFIRM_BYTES) =>
        new HttpResponse({
          statusCode: 200,
          headers: {
            etag: CONFIRM_REVISION.etag,
            'content-length': '32',
            'x-amz-version-id': CONFIRM_REVISION.versionId,
          },
          body: Readable.from([bytes]),
        }),
      absent: () =>
        new HttpResponse({ statusCode: 404, body: Readable.from([]) }),
    };
  }
  runtime(maxAttempts = 1) {
    return new AwsMediaPromotionConfirmation(this.left.repository, {
      bucket: 'animalrecord-test-media',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'SYNTHETIC',
        secretAccessKey: 'synthetic-secret',
      },
      maxAttempts,
    });
  }
  override async drain(): Promise<void> {
    this.transport?.releaseAll();
    await super.drain(); // Observed runtime promises include SDK destruction in finally.
    await this.transport?.drain();
  }
  override async close(): Promise<void> {
    try {
      await super.close();
    } finally {
      this.transport?.restore();
    }
  }
}
