import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type GetObjectRetentionCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PublishedHistoryFinalPutReconciler } from '../../../src/context/animal-transfer/application/item-staging-put-reconciler';
import { PutVersionAuditSelectionReader } from '../../../src/context/animal-transfer/application/put-version-audit-selection';
import {
  PutVersionEvidenceProducer,
  type PutVersionProvenanceReader,
} from '../../../src/context/animal-transfer/application/put-version-evidence-producer';
import type { StableCutVersionStorage } from '../../../src/context/animal-transfer/application/stable-cut-version-evidence';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { publishedHistoryFinalCoverageSelection } from '../../../src/context/animal-transfer/domain/published-history-final-coverage';
import {
  matchPublishedHistoryFinalPutVersionRecord,
  publishedHistoryFinalPutVersionScope,
  type PublishedHistoryFinalPutVersionRecord,
} from '../../../src/context/animal-transfer/domain/published-history-final-reconciliation';
import type { PublishedHistoryFinalPermissionInput } from '../../../src/context/animal-transfer/domain/published-history-final-permission';
import {
  capturePutVersionRecord,
  type ItemHistoricalPutVersionReader,
  type ItemHistoricalPutVersionScope,
  type PutVersionEvidence,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import {
  AwsPutVersionEvidencePublisher,
  AwsPutVersionEvidenceReader,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-put-version-evidence-reader';
import { ITEM_PUT_AUDIT_METADATA } from '../../../src/context/animal-transfer/infrastructure/storage/aws-item-put-transport';
import { AwsPutVersionEvidencePublication } from '../../../src/context/animal-transfer/infrastructure/storage/aws-put-version-evidence-publication';
import { AwsPutVersionEvidenceReconciliation } from '../../../src/context/animal-transfer/infrastructure/storage/aws-put-version-evidence-reconciliation';
import { s3CreatedPutNotificationsKey } from '../../../src/context/animal-transfer/infrastructure/storage/aws-s3-created-put-notifications';
import {
  AwsPutVersionProvenanceReader,
  AwsS3PutAuditReader,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-s3-put-audit';
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

function publication(
  protocol: PutVersionEvidence['protocol'] = historicalProtocol,
) {
  const bytes = Buffer.from('synthetic bytes');
  const targetScope = {
    ...scope,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const original = evidenceFor(protocol);
  const marker = 'a'.repeat(64);
  const admittedAt = '2026-10-29T12:01:00.000Z';
  const auditMarkerHash = archiveHash(marker);
  const notification = {
    event: 'ObjectCreated:Put' as const,
    requestId: 'synthetic-put-request',
    target: targetScope.target,
    occurredAt: '2026-10-29T12:02:00.000Z',
    revision: { ...original.revision, size: bytes.length },
  };
  const scopeHash = archiveHash(targetScope);
  const event = {
    scopeHash,
    protocol,
    revision: notification.revision,
    appliedAt: notification.occurredAt,
    provenanceEvidenceHash: archiveHash({
      protocol,
      scopeHash,
      admittedAt,
      auditMarkerHash,
      revision: notification.revision,
      occurredAt: notification.occurredAt,
      eventEvidenceHash: archiveHash([
        'S3_OBJECT_CREATED_PUT_V1',
        notification.target.bucket,
        notification.target.expectedBucketOwner,
        notification.requestId,
      ]),
    }),
  };
  const readCreatedPuts = jest.fn().mockResolvedValue([notification]);
  const head = jest
    .fn<Promise<HeadObjectCommandOutput>, [HeadObjectCommand]>()
    .mockResolvedValue({
      $metadata: { httpStatusCode: 200 },
      VersionId: notification.revision.versionId,
      ETag: notification.revision.etag,
      ContentLength: notification.revision.size,
      Metadata: { [ITEM_PUT_AUDIT_METADATA]: marker },
    });
  const provenance = new AwsPutVersionProvenanceReader(
    new AwsS3PutAuditReader({ readCreatedPuts }, {
      send: head,
    } as unknown as Pick<S3Client, 'send'>),
    { protocol, scope: targetScope, admittedAt, auditMarkerHash },
  );
  const readAppliedVersion = jest.spyOn<
    PutVersionProvenanceReader,
    'readAppliedVersion'
  >(provenance, 'readAppliedVersion');
  const close = jest.fn();
  const retention = {
    expectedBucketOwner: targetScope.target.expectedBucketOwner,
    mode: 'COMPLIANCE' as const,
    reportedRetainUntil: original.validUntil,
  };
  const storage = {
    readSourceRetention: jest.fn<
      ReturnType<StableCutVersionStorage['readSourceRetention']>,
      Parameters<StableCutVersionStorage['readSourceRetention']>
    >(() => Promise.resolve(retention)),
    readVersion: jest.fn<
      ReturnType<StableCutVersionStorage['readVersion']>,
      Parameters<StableCutVersionStorage['readVersion']>
    >((_, revision) =>
      Promise.resolve({ revision, body: Readable.from([bytes]), close }),
    ),
  };
  const requiredThrough = '2026-10-29T12:05:00.000Z';
  const clock = jest.fn(() => new Date('2026-10-29T12:03:00.000Z'));
  const producer = new PutVersionEvidenceProducer(
    provenance,
    storage,
    configWithControls(),
    clock,
  );
  const documents = new Map<string, Buffer>();
  const versionId = 'published-report-version';
  const send = jest.fn<
    Promise<GetObjectCommandOutput | PutObjectCommandOutput>,
    [GetObjectCommand | PutObjectCommand]
  >((command) => {
    const { Key } = command.input;
    if (!Key) throw new Error('Expected an archive key');
    if (command instanceof PutObjectCommand) {
      if (documents.has(Key))
        return Promise.reject(new Error('Conditional conflict'));
      if (!Buffer.isBuffer(command.input.Body))
        throw new Error('Expected JSON bytes');
      documents.set(Key, command.input.Body);
      return Promise.resolve({
        $metadata: { httpStatusCode: 200 },
        VersionId: versionId,
      });
    }
    const stored = documents.get(Key);
    if (!stored)
      return Promise.reject(
        new NoSuchKey({
          message: 'Missing',
          $metadata: { httpStatusCode: 404 },
        }),
      );
    return Promise.resolve({
      $metadata: { httpStatusCode: 200 },
      ContentLength: stored.length,
      VersionId: versionId,
      Body: Readable.from([stored]) as NonNullable<
        GetObjectCommandOutput['Body']
      >,
    });
  });
  const client = { send } as unknown as Pick<S3Client, 'send'>;
  const publisher = new AwsPutVersionEvidencePublisher(
    client,
    config,
    protocol,
    producer,
  );
  const reader = new AwsPutVersionEvidenceReader(client, config, protocol);
  return {
    targetScope,
    event,
    storage,
    close,
    head,
    provenance,
    readCreatedPuts,
    readAppliedVersion,
    retention,
    requiredThrough,
    clock,
    send,
    documents,
    reader,
    publish: () => publisher.publish(targetScope, requiredThrough),
  };
}

function configWithControls() {
  return {
    issuerId: config.issuerId,
    conservationControlsHash: archiveHash('authorized conservation generation'),
  };
}

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

  it('captures a retained version across realms before strict validation and preserves unexpected fields for rejection', async () => {
    const { retainedFile: file } = await publishedLaterPeriod('processing');
    const context = {
      definition: file.publishedHistoryFinalPutDeclaration.attempt,
      permission: file.publishedHistoryFinalPutPermission,
    };
    const record = file.publishedHistoryFinalPutVersion;
    const foreign = structuredClone(record);
    const captured = capturePutVersionRecord(foreign);
    Object.assign(foreign.observation.scope.target, {
      key: 'different-object',
    });
    expect(
      matchPublishedHistoryFinalPutVersionRecord(context, captured),
    ).toEqual(record);
    expect(() =>
      matchPublishedHistoryFinalPutVersionRecord(
        context,
        capturePutVersionRecord({
          ...record,
          evidence: { ...record.evidence, unexpected: true },
        }),
      ),
    ).toThrow('evidence is inconsistent');
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

describe('Publishing independently verified PUT versions', () => {
  it.each(protocols)(
    'archives a report readable by the existing adapter for %s',
    async (protocol) => {
      const f = publication(protocol);
      const receipt = await f.publish();
      if (!receipt) throw new Error('Expected a receipt');
      expect(f.readCreatedPuts).toHaveBeenCalledWith(f.targetScope.target);
      expect(f.head.mock.calls[0][0].input).toEqual({
        Bucket: f.targetScope.target.bucket,
        ExpectedBucketOwner: f.targetScope.target.expectedBucketOwner,
        Key: f.targetScope.target.key,
        VersionId: f.event.revision.versionId,
        IfMatch: f.event.revision.etag,
      });
      expect(f.storage.readVersion).toHaveBeenCalledWith(
        f.targetScope.target,
        f.event.revision,
      );
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(f.send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
      expect(f.send.mock.calls[0][0].input).toMatchObject({
        Bucket: config.bucket,
        ExpectedBucketOwner: config.bucketOwner,
        IfNoneMatch: '*',
        Key: receipt.objectKey,
      });
      const report = await f.reader.readVersionEvidence(
        f.targetScope,
        receipt.evidenceHash,
      );
      expect(report).toMatchObject({
        protocol,
        scopeHash: f.event.scopeHash,
        revision: f.event.revision,
        validFrom: f.clock().toISOString(),
        validUntil: f.retention.reportedRetainUntil,
        provenanceEvidenceHash: f.event.provenanceEvidenceHash,
      });
      expect(archiveHash(report)).toBe(receipt.evidenceHash);
      expect(receipt.versionId).toBe('published-report-version');
    },
  );

  it('leaves the report absent when the provenance authority has no matching event', async () => {
    const f = publication();
    f.readCreatedPuts.mockResolvedValueOnce([]);
    await expect(f.publish()).resolves.toBeNull();
    expect(f.head).not.toHaveBeenCalled();
    expect(f.storage.readSourceRetention).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects a substituted permit or protocol before reading notifications', async () => {
    const f = publication();
    await expect(
      f.provenance.readAppliedVersion(
        {
          ...f.targetScope,
          permissionHash: archiveHash('different permission'),
        },
        historicalProtocol,
      ),
    ).rejects.toThrow('do not identify one permitted PUT');
    await expect(
      f.provenance.readAppliedVersion(
        f.targetScope,
        'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1',
      ),
    ).rejects.toThrow('do not identify one permitted PUT');
    expect(f.readCreatedPuts).not.toHaveBeenCalled();
  });

  it('rejects proof for another permission before reading the target', async () => {
    const f = publication();
    f.readAppliedVersion.mockResolvedValueOnce({
      ...f.event,
      scopeHash: archiveHash('another permission'),
    });
    await expect(f.publish()).rejects.toThrow(
      'applied PUT version evidence is inconsistent',
    );
    expect(f.storage.readSourceRetention).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('leaves the report absent when retention ends at the horizon', async () => {
    const f = publication();
    f.storage.readSourceRetention.mockResolvedValueOnce({
      ...f.retention,
      reportedRetainUntil: f.requiredThrough,
    });
    await expect(f.publish()).rejects.toThrow(
      'applied PUT version evidence is inconsistent',
    );
    expect(f.storage.readVersion).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('closes a version with incorrect bytes and blocks publication', async () => {
    const f = publication();
    f.storage.readVersion.mockResolvedValueOnce({
      revision: f.event.revision,
      body: Readable.from([Buffer.alloc(f.targetScope.size)]),
      close: f.close,
    });
    await expect(f.publish()).rejects.toThrow(
      'applied PUT version evidence is inconsistent',
    );
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('recognizes an identical report already archived at the same key', async () => {
    const f = publication();
    const first = await f.publish();
    expect(first).not.toBeNull();
    await expect(f.publish()).resolves.toEqual(first);
    expect(f.documents.size).toBe(1);
    expect(f.send.mock.calls[2][0]).toBeInstanceOf(GetObjectCommand);
  });
});

describe('Publishing from a recorded permit', () => {
  async function setupOperation(withMarker = true) {
    const dossier = await publishedLaterPeriod('processing');
    const file = dossier.retainedFile;
    const { binding } = dossier.retainedScope;
    const protocol = 'PUBLISHED_HISTORY_FINAL_PUT_VERSION_EVIDENCE_V1' as const;
    const marker = 'a'.repeat(64);
    const auditMarkerHash = archiveHash(marker);
    const { permissionHash, ...facts } =
      file.publishedHistoryFinalPutPermission;
    const originalSelection = publishedHistoryFinalCoverageSelection(
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
    const selection = withMarker
      ? { ...originalSelection, auditMarkerHash }
      : originalSelection;
    const markedFacts = {
      ...facts,
      selectionHash: archiveHash(selection),
      auditMarkerHash,
    };
    const permission = withMarker
      ? { ...markedFacts, permissionHash: archiveHash(markedFacts) }
      : { ...facts, permissionHash };
    const context = {
      definition: file.publishedHistoryFinalPutDeclaration.attempt,
      permission,
    };
    const selectedScope = publishedHistoryFinalPutVersionScope(context);
    const { target } = selectedScope;
    let recorded: PublishedHistoryFinalPutVersionRecord | undefined;
    const readPublishedFinalVersionContext = jest.fn(() =>
      Promise.resolve({ ...context, versionRecord: recorded }),
    );
    const recordPublishedFinalVersion = jest.fn(
      (
        _input: PublishedHistoryFinalPermissionInput,
        version: PublishedHistoryFinalPutVersionRecord,
      ) => {
        recorded = version;
        return Promise.reject(new Error('Lost registration response'));
      },
    );
    const items = {
      readHistoricalPutReconciliationContext: jest.fn(),
      readStagingPutReconciliationContext: jest.fn(),
      readRecipientFinalPutReconciliationContext: jest.fn(),
      recordHistoricalPutVersion: jest.fn(),
      recordStagingPutVersion: jest.fn(),
      recordRecipientFinalPutVersion: jest.fn(),
    };
    const history = {
      readPublishedCopyVersionContext: jest.fn(),
      readPublishedStagingVersionContext: jest.fn(),
      readPublishedFinalVersionContext,
      recordPublishedCopyVersion: jest.fn(),
      recordPublishedStagingVersion: jest.fn(),
      recordPublishedFinalVersion,
    };
    const selections = new PutVersionAuditSelectionReader(items, history);
    const feed = {
      auditBucket: 'synthetic-notifications',
      auditBucketOwner: '123456789014',
      sourceBucket: target.bucket,
      sourceBucketOwner: target.expectedBucketOwner,
      sourceRegion: 'us-east-1',
      notificationConfigurationId: 'synthetic-put-only',
      maxBytes: 4096,
    };
    const readNotifications = jest.fn<
      Promise<GetObjectCommandOutput>,
      [GetObjectCommand]
    >();
    const readVersion = jest.fn<
      Promise<
        | HeadObjectCommandOutput
        | GetObjectRetentionCommandOutput
        | GetObjectCommandOutput
      >,
      [HeadObjectCommand | GetObjectRetentionCommand | GetObjectCommand]
    >();
    const archive = jest.fn<
      Promise<PutObjectCommandOutput | GetObjectCommandOutput>,
      [PutObjectCommand | GetObjectCommand]
    >();
    const client = (send: unknown) => ({ send }) as Pick<S3Client, 'send'>;
    const evidenceArchive = client(archive);
    const objectVersions = client(readVersion);
    const operation = new AwsPutVersionEvidencePublication(
      selections,
      {
        notificationArchive: client(readNotifications),
        objectVersions,
        evidenceArchive,
      },
      {
        notificationArchive: feed,
        evidenceArchive: config,
        conservationControlsHash: configWithControls().conservationControlsHash,
      },
      dossier.now,
    );
    const reconciler = new AwsPutVersionEvidenceReconciliation(
      items,
      history,
      evidenceArchive,
      objectVersions,
      {
        evidenceArchive: config,
        objectVersions: {
          bucket: target.bucket,
          expectedBucketOwner: target.expectedBucketOwner,
        },
      },
      dossier.now,
    );
    return {
      dossier,
      protocol,
      feed,
      selectedScope,
      marker,
      permission,
      readPublishedFinalVersionContext,
      readNotifications,
      readVersion,
      archive,
      selection,
      recordPublishedFinalVersion,
      reconcile: (
        receipt: Readonly<{ evidenceHash: string }>,
        horizon = binding.requiredThrough,
      ) =>
        reconciler.reconcileAndRecord(
          {
            protocol,
            selection,
            expectedPermissionHash: permission.permissionHash,
          },
          receipt,
          horizon,
        ),
      publish: (expectedPermissionHash = permission.permissionHash) =>
        operation.publish(
          { protocol, selection, expectedPermissionHash },
          binding.requiredThrough,
        ),
    };
  }

  it('publishes after a delayed event and recovers the recorded version after a lost response', async () => {
    const f = await setupOperation();
    f.readNotifications.mockRejectedValueOnce(
      new NoSuchKey({
        message: 'Audit event has not arrived',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(f.publish()).resolves.toBeNull();
    expect(f.readVersion).not.toHaveBeenCalled();
    expect(f.archive).not.toHaveBeenCalled();

    const { target, size } = f.selectedScope;
    const revision = {
      versionId: 'correlated-version',
      etag: '"correlated-etag"',
      size,
    };
    const event = {
      eventVersion: '2.6',
      eventSource: 'aws:s3',
      awsRegion: f.feed.sourceRegion,
      eventTime: f.permission.admittedAt,
      eventName: 'ObjectCreated:Put',
      responseElements: { 'x-amz-request-id': 'request-retained-final' },
      s3: {
        s3SchemaVersion: '1.0',
        configurationId: f.feed.notificationConfigurationId,
        bucket: { name: target.bucket, arn: `arn:aws:s3:::${target.bucket}` },
        object: {
          key: encodeURIComponent(target.key),
          size,
          versionId: revision.versionId,
          eTag: 'correlated-etag',
        },
      },
    };
    const get = (data: Buffer, versionId: string): GetObjectCommandOutput => ({
      $metadata: { httpStatusCode: 200 },
      Body: Readable.from([data]) as NonNullable<
        GetObjectCommandOutput['Body']
      >,
      ContentLength: data.length,
      VersionId: versionId,
    });
    f.readNotifications.mockResolvedValueOnce(
      get(
        Buffer.from(
          JSON.stringify({
            sourceBucketOwner: target.expectedBucketOwner,
            Records: [event],
          }),
        ),
        'event-archive-version',
      ),
    );
    const headers = {
      $metadata: { httpStatusCode: 200 },
      VersionId: revision.versionId,
      ContentLength: size,
      ETag: revision.etag,
    };
    f.readVersion
      .mockResolvedValueOnce({
        ...headers,
        Metadata: { [ITEM_PUT_AUDIT_METADATA]: f.marker },
      })
      .mockResolvedValueOnce({
        $metadata: headers.$metadata,
        Retention: {
          Mode: 'COMPLIANCE',
          RetainUntilDate: new Date('2026-12-31T12:00:00.000Z'),
        },
      })
      .mockResolvedValueOnce({
        ...get(f.dossier.bytes, revision.versionId),
        ...headers,
      });
    f.archive.mockResolvedValueOnce({
      $metadata: { httpStatusCode: 200 },
      VersionId: 'report-archive-version',
    });
    const receipt = await f.publish();
    if (!receipt) throw new Error('Expected a published report');
    expect(f.readNotifications.mock.calls[1][0].input.Key).toBe(
      s3CreatedPutNotificationsKey(target),
    );
    expect(f.readPublishedFinalVersionContext).toHaveBeenCalledTimes(2);
    expect(
      f.readVersion.mock.calls.map(([command]) => command.constructor),
    ).toEqual([HeadObjectCommand, GetObjectRetentionCommand, GetObjectCommand]);
    for (const [command] of f.readVersion.mock.calls) {
      expect(command.input).toMatchObject({
        Bucket: target.bucket,
        Key: target.key,
        ExpectedBucketOwner: target.expectedBucketOwner,
        VersionId: revision.versionId,
      });
    }
    const [[write]] = f.archive.mock.calls;
    expect(f.archive.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.readVersion.mock.invocationCallOrder[2],
    );
    expect(write).toBeInstanceOf(PutObjectCommand);
    expect(write.input).toMatchObject({
      Bucket: config.bucket,
      Key: receipt.objectKey,
      IfNoneMatch: '*',
    });
    if (
      !(write instanceof PutObjectCommand) ||
      !Buffer.isBuffer(write.input.Body)
    )
      throw new Error('Expected a conditional evidence archive write');
    f.archive.mockResolvedValueOnce(get(write.input.Body, receipt.versionId));
    f.readVersion.mockResolvedValueOnce({
      ...get(f.dossier.bytes, revision.versionId),
      ...headers,
    });
    await expect(f.reconcile(receipt)).rejects.toThrow(
      'Lost registration response',
    );
    expect(f.archive.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    expect(f.archive.mock.calls[1][0].input.Key).toBe(receipt.objectKey);
    expect(f.readVersion.mock.calls[3][0].input).toMatchObject({
      Bucket: target.bucket,
      Key: target.key,
      ExpectedBucketOwner: target.expectedBucketOwner,
      VersionId: revision.versionId,
      IfMatch: revision.etag,
    });
    expect(f.readPublishedFinalVersionContext).toHaveBeenCalledTimes(4);
    const [[savedSelection, saved]] = f.recordPublishedFinalVersion.mock.calls;
    expect(savedSelection).toEqual(f.selection);
    expect(saved).toMatchObject({
      observation: {
        evidenceHash: receipt.evidenceHash,
        scope: f.selectedScope,
      },
      evidence: {
        protocol: f.protocol,
        scopeHash: receipt.scopeHash,
        revision,
      },
    });
    await expect(f.reconcile(receipt)).resolves.toEqual(saved);
    await expect(
      f.reconcile({
        evidenceHash: archiveHash('replacement report'),
      }),
    ).rejects.toThrow('cannot be replaced');
    expect(f.recordPublishedFinalVersion).toHaveBeenCalledTimes(1);
    expect(f.readNotifications).toHaveBeenCalledTimes(2);
    expect(f.readVersion).toHaveBeenCalledTimes(4);
    expect(f.archive).toHaveBeenCalledTimes(2);
  });

  it('keeps a legacy permit without a marker uncertain and rejects selection by another hash', async () => {
    const f = await setupOperation(false);
    await expect(f.publish()).resolves.toBeNull();
    await expect(f.publish(archiveHash('different permit'))).rejects.toThrow(
      'recorded PUT permission',
    );
    expect(f.readNotifications).not.toHaveBeenCalled();
    expect(f.readVersion).not.toHaveBeenCalled();
    expect(f.archive).not.toHaveBeenCalled();
  });
});
