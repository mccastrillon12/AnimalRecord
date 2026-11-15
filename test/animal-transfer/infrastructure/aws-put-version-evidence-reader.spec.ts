import {
  GetObjectCommand,
  NoSuchKey,
  type GetObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { PublishedHistoryFinalPutReconciler } from '../../../src/context/animal-transfer/application/item-staging-put-reconciler';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { publishedHistoryFinalCoverageSelection } from '../../../src/context/animal-transfer/domain/published-history-final-coverage';
import {
  publishedHistoryFinalPutVersionScope,
  type PublishedHistoryFinalPutVersionRecord,
} from '../../../src/context/animal-transfer/domain/published-history-final-reconciliation';
import type { PublishedHistoryFinalPermissionInput } from '../../../src/context/animal-transfer/domain/published-history-final-permission';
import {
  type ItemHistoricalPutVersionReader,
  type ItemHistoricalPutVersionScope,
  type PutVersionEvidence,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import { AwsPutVersionEvidenceReader } from '../../../src/context/animal-transfer/infrastructure/storage/aws-put-version-evidence-reader';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';

const config = {
  bucket: 'synthetic-permission-audit',
  bucketOwner: '123456789013',
  issuerId: '123e4567-e89b-42d3-a456-426614174001',
  maxBytes: 4096,
};
const scope: ItemHistoricalPutVersionScope = {
  authorizationId: archiveHash('original permission ID'),
  permissionHash: archiveHash('original permission'),
  target: {
    bucket: 'synthetic-copies',
    key: 'retained/version',
    expectedBucketOwner: '123456789012',
  },
  size: 16,
  sha256: archiveHash('synthetic bytes'),
};
const protocols = [
  'ITEM_HISTORICAL_PUT_VERSION_EVIDENCE_V1',
  'ITEM_STAGING_PUT_VERSION_EVIDENCE_V1',
  'ITEM_RECIPIENT_FINAL_PUT_VERSION_EVIDENCE_V1',
  'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1',
  'PUBLISHED_HISTORY_STAGING_PUT_VERSION_EVIDENCE_V1',
  'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1',
] as const;
const historicalProtocol = 'PUBLISHED_HISTORY_PUT_VERSION_EVIDENCE_V1';

function evidenceFor<Protocol extends PutVersionEvidence['protocol']>(
  protocol: Protocol,
) {
  return {
    protocol,
    issuerId: config.issuerId,
    scopeHash: archiveHash(scope),
    revision: {
      versionId: 'synthetic-put-version',
      etag: '"written-etag"',
      size: scope.size,
    },
    provenanceEvidenceHash: archiveHash('independent provenance'),
    conservationEvidenceHash: archiveHash('independent version conservation'),
    conservationControlsHash: archiveHash('conservation controls generation'),
    validFrom: '2026-10-29T12:00:00.000Z',
    validUntil: '2026-10-29T12:08:00.000Z',
  };
}

function setup<Protocol extends PutVersionEvidence['protocol']>(
  protocol: Protocol,
  document: unknown = evidenceFor(protocol),
  options = config,
) {
  const bytes = Buffer.from(JSON.stringify(document));
  const body = Readable.from([bytes]);
  const response: GetObjectCommandOutput = {
    $metadata: { httpStatusCode: 200 },
    Body: body as NonNullable<GetObjectCommandOutput['Body']>,
    ContentLength: bytes.length,
    VersionId: 'synthetic-report-version',
  };
  const send = jest
    .fn<Promise<GetObjectCommandOutput>, [GetObjectCommand]>()
    .mockResolvedValue(response);
  const reader = new AwsPutVersionEvidenceReader(
    { send } as unknown as Pick<S3Client, 'send'>,
    options,
    protocol,
  );
  return { reader, send, response, body };
}

describe('Independent archived PUT version evidence', () => {
  it.each(protocols)(
    'reads the exact versioned report for %s',
    async (protocol) => {
      const document = evidenceFor(protocol);
      const expected = archiveHash(document);
      const f = setup(protocol, document);
      await expect(
        f.reader.readVersionEvidence(scope, expected),
      ).resolves.toEqual(document);
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
      expect(f.send.mock.calls[0][0].input).toEqual({
        Bucket: config.bucket,
        ExpectedBucketOwner: config.bucketOwner,
        Key: `put-version-evidence/v1/${protocol}/${archiveHash(scope)}/${expected}.json`,
      });
      expect(f.body.destroyed).toBe(true);
    },
  );

  it.each([
    { protocol: 'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1' },
    { scopeHash: archiveHash('different permit scope') },
    { issuerId: '123e4567-e89b-42d3-a456-426614174002' },
    { validUntil: '2026-10-29T12:00:00.000Z' },
  ])(
    'rejects incompatible evidence even if its content hash matches (%#)',
    async (change) => {
      const document = { ...evidenceFor(historicalProtocol), ...change };
      const f = setup(historicalProtocol, document);
      await expect(
        f.reader.readVersionEvidence(scope, archiveHash(document)),
      ).rejects.toThrow('inconsistent');
    },
  );

  it('rejects a different document at the requested archive key', async () => {
    const f = setup(historicalProtocol);
    await expect(
      f.reader.readVersionEvidence(scope, archiveHash('different evidence')),
    ).rejects.toThrow('inconsistent');
  });

  it('rejects an invalid hash before sending a request', async () => {
    const f = setup(historicalProtocol);
    await expect(
      f.reader.readVersionEvidence(scope, '../unexpected'),
    ).rejects.toThrow('inconsistent');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('keeps a missing report distinct from a storage failure', async () => {
    const f = setup(historicalProtocol);
    const expected = archiveHash(evidenceFor(historicalProtocol));
    f.send.mockRejectedValueOnce(
      new NoSuchKey({ message: 'Missing', $metadata: { httpStatusCode: 404 } }),
    );
    await expect(
      f.reader.readVersionEvidence(scope, expected),
    ).resolves.toBeNull();
    f.send.mockRejectedValueOnce(new Error('Access denied'));
    await expect(f.reader.readVersionEvidence(scope, expected)).rejects.toThrow(
      'could not read',
    );
  });

  it('rejects unversioned and oversized documents', async () => {
    const document = evidenceFor(historicalProtocol);
    const expected = archiveHash(document);
    const f = setup(historicalProtocol, document);
    f.send.mockResolvedValueOnce({ ...f.response, VersionId: 'null' });
    await expect(f.reader.readVersionEvidence(scope, expected)).rejects.toThrow(
      'inconsistent',
    );
    const bounded = setup(historicalProtocol, document, {
      ...config,
      maxBytes: 8,
    });
    await expect(
      bounded.reader.readVersionEvidence(scope, expected),
    ).rejects.toThrow('inconsistent');
    expect(bounded.body.destroyed).toBe(true);
  });

  it('feeds the retained final reconciliation before reading and recording the selected object version', async () => {
    const dossier = await publishedLaterPeriod('processing');
    const file = dossier.retainedFile;
    const { binding } = dossier.retainedScope;
    const record = file.publishedHistoryFinalPutVersion;
    const context = {
      definition: file.publishedHistoryFinalPutDeclaration.attempt,
      permission: file.publishedHistoryFinalPutPermission,
    };
    const input = publishedHistoryFinalCoverageSelection(
      {
        archiveId: binding.archiveId,
        expectedArchiveDefinitionHash: binding.archiveDefinitionHash,
        expectedReservationEpoch: binding.reservationEpoch,
        expectedPublicationHash: binding.publicationHash,
        expectedSourceManifestHash: binding.sourceManifestHash,
        requiredThrough: binding.requiredThrough,
      },
      file,
    );
    const reader = setup(record.evidence.protocol, record.evidence, {
      ...config,
      issuerId: record.evidence.issuerId,
    }).reader;
    const readPublishedFinalVersionContext = jest.fn(() =>
      Promise.resolve(context),
    );
    const recordPublishedFinalVersion = jest.fn(
      (
        _input: PublishedHistoryFinalPermissionInput,
        value: PublishedHistoryFinalPutVersionRecord,
      ) => Promise.resolve(value),
    );
    const readVersion = jest.fn<
      ReturnType<ItemHistoricalPutVersionReader['readVersion']>,
      Parameters<ItemHistoricalPutVersionReader['readVersion']>
    >((_, revision) =>
      Promise.resolve({
        revision,
        body: Readable.from([dossier.bytes]),
        close: () => undefined,
      }),
    );
    const service = new PublishedHistoryFinalPutReconciler(
      { readPublishedFinalVersionContext, recordPublishedFinalVersion },
      reader,
      { readVersion },
      dossier.now,
    );
    const observed = await service.reconcileAndRecord({
      selection: input,
      expectedPermissionHash: context.permission.permissionHash,
      expectedEvidenceHash: record.observation.evidenceHash,
      requiredThrough: binding.requiredThrough,
    });
    expect(readVersion).toHaveBeenCalledWith(
      publishedHistoryFinalPutVersionScope(context).target,
      record.observation.revision,
    );
    expect(readPublishedFinalVersionContext).toHaveBeenCalledTimes(2);
    expect(recordPublishedFinalVersion).toHaveBeenCalledWith(input, observed);
    expect(observed.evidence).toEqual(record.evidence);
  });
});
