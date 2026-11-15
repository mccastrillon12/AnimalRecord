import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3ServiceException,
  type GetObjectCommandOutput,
  type PutObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { LaterPeriodStableCutCopyEvidence } from '../../../src/context/animal-transfer/domain/later-period-stable-cut-copy-evidence';
import {
  LaterPeriodStableCutEvidenceProducer,
  type LaterPeriodStableCutWriterCoverage,
} from '../../../src/context/animal-transfer/application/later-period-stable-cut-evidence-producer';
import {
  StableCutInventoryEvidenceReader,
  stableCutWriterInventoryBinding,
  type StableCutWriterFindings,
  type StableCutWriterInventory,
} from '../../../src/context/animal-transfer/application/stable-cut-writer-evidence';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  PUT_DESTINATION_WRITER_GROUPS,
  type PutDestinationWriters,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-put-destination-protection';
import {
  appendItemStableCutCopyAttemptDigest,
  buildItemStableCutScope,
  itemStableCutCopyAttemptsDigestSeed,
  LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
  type ItemStableCutAttemptPin,
  type ItemStableCutCopyInventory,
  type LaterPeriodStableCutScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import {
  AwsSignedItemStableCutCoverage,
  AwsSignedLaterPeriodStableCutCoverage,
  ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
  LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-signed-stable-cut-coverage';
import {
  AwsStableCutOperationalEvidenceArchive,
  AwsStableCutOperationalEvidenceSource,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-stable-cut-operational-evidence-source';
import { AwsStableCutWriterCoveragePublisher } from '../../../src/context/animal-transfer/infrastructure/storage/aws-stable-cut-writer-coverage-publisher';
import { StableCutWriterCoverageIssuer } from '../../../src/context/animal-transfer/infrastructure/storage/signed-stable-cut-coverage';
import { runStableCutCoverageOperation } from '../../../src/operations/stable-cut-coverage.cli';
import { publishedLaterPeriod } from '../fixtures/published-later-period.fixture';

const signer = generateKeyPairSync('ed25519');
const unauthorizedSigner = generateKeyPairSync('ed25519');
const config = {
  bucket: 'synthetic-cut-audit',
  bucketOwner: '123456789012',
  issuerId: '123e4567-e89b-42d3-a456-426614174001',
  controlsHash: archiveHash('active cut controls'),
  publicKey: signer.publicKey,
  maxBytes: 4096,
};
const protocol = LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL;
const now = '2026-10-29T12:03:00.000Z';
const scopeFacts = {
  protocol: LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
  archiveId: 'synthetic-dossier',
  admissionHash: archiveHash('original decision and reservation'),
  retainedScopeHash: archiveHash('retained scope'),
  retainedProjectionHash: archiveHash('retained projection'),
  retainedFileCount: 0,
  liveManifest: {
    entryCount: 1,
    fileCount: 0,
    entriesDigest: archiveHash('entries'),
    filesDigest: archiveHash('files'),
  },
  liveProjectionHash: archiveHash('current projection'),
  liveMediaDigest: archiveHash([]),
  conservationControlsHashes: [archiveHash('retention controls')],
  requiredThrough: '2026-10-29T12:05:00.000Z',
  stableCut: 'NOT_ASSESSED',
  businessCommit: 'NOT_AUTHORIZED',
} as const;
const scope: LaterPeriodStableCutScope = {
  ...scopeFacts,
  scopeHash: archiveHash(scopeFacts),
};
const report: LaterPeriodStableCutWriterCoverage = {
  issuerId: config.issuerId,
  scopeHash: scope.scopeHash,
  controlsHash: config.controlsHash,
  writerInventoryHash: archiveHash('closed writer inventory'),
  writers: Object.fromEntries(
    PUT_DESTINATION_WRITER_GROUPS.map((group) => [
      group,
      { disposition: 'ISOLATED', evidenceHash: archiveHash(group) },
    ]),
  ) as PutDestinationWriters,
  copyEffects: {
    disposition: 'RECONCILED_AND_CONTROLLED',
    evidenceHash: archiveHash('copy effects'),
  },
  validFrom: '2026-10-29T12:02:00.000Z',
  validUntil: '2026-10-29T12:06:00.000Z',
};

function verifiedEvidence(scopeHash = scope.scopeHash) {
  return {
    scopeHash,
    controlsHash: report.controlsHash,
    writerInventoryHash: report.writerInventoryHash,
    writers: report.writers,
    copyEffects: report.copyEffects,
    validFrom: report.validFrom,
    validUntil: report.validUntil,
  };
}

function operationalEvidence(scopeHash = scope.scopeHash) {
  const legacy = archiveHash('legacy deployment');
  const current = archiveHash('current deployment');
  const copy = archiveHash('original copy permission and attempt');
  const isolated = (identityHash: string) => ({
    identityHash,
    disposition: 'ISOLATED' as const,
    evidenceHash: archiveHash([identityHash, 'isolation evidence']),
  });
  const reconciled = (identityHash: string) => ({
    identityHash,
    disposition: 'RECONCILED_AND_CONTROLLED' as const,
    evidenceHash: archiveHash([
      identityHash,
      'remote observation and controls',
    ]),
  });
  const binding = { scopeHash, controlsHash: config.controlsHash };
  const inventory: StableCutWriterInventory = {
    ...binding,
    validFrom: '2026-10-29T12:00:00.000Z',
    validUntil: '2026-10-29T12:07:00.000Z',
    groups: {
      applicationDeployments: {
        completenessEvidenceHash: archiveHash('deployment census'),
        identityHashes: [legacy, current],
      },
      externalSystems: {
        completenessEvidenceHash: archiveHash('external systems census'),
        identityHashes: [],
      },
      priorCapabilities: {
        completenessEvidenceHash: archiveHash('prior capabilities census'),
        identityHashes: [],
      },
      multipartUploads: {
        completenessEvidenceHash: archiveHash('multipart census'),
        identityHashes: [],
      },
      replication: {
        completenessEvidenceHash: archiveHash('replication census'),
        identityHashes: [],
      },
      administrative: {
        completenessEvidenceHash: archiveHash('admin census'),
        identityHashes: [],
      },
      copyEffects: {
        completenessEvidenceHash: archiveHash('copy effects census'),
        identityHashes: [copy],
      },
    },
  };
  const findings: StableCutWriterFindings = {
    ...binding,
    validFrom: report.validFrom,
    validUntil: report.validUntil,
    writerInventoryHash: archiveHash('different inventory'),
    groups: {
      applicationDeployments: [isolated(legacy), reconciled(current)],
      externalSystems: [],
      priorCapabilities: [],
      multipartUploads: [],
      replication: [],
      administrative: [],
      copyEffects: [reconciled(copy)],
    },
  };
  const readInventory = jest.fn(() => Promise.resolve(inventory));
  const readFindings = jest.fn(
    (_scope: unknown, _controls: string, writerInventoryHash: string) =>
      Promise.resolve({ ...findings, writerInventoryHash }),
  );
  const evidence = new StableCutInventoryEvidenceReader({
    readInventory,
    readFindings,
  });
  return {
    inventory,
    findings,
    readInventory,
    readFindings,
    issuer: new StableCutWriterCoverageIssuer(
      evidence,
      { ...config, privateKey: signer.privateKey },
      () => new Date(now),
    ),
  };
}

function issuerFor(
  evidence: ReturnType<typeof verifiedEvidence> | null = verifiedEvidence(),
  clock = () => new Date(now),
) {
  const readVerifiedCoverage = jest.fn(() => Promise.resolve(evidence));
  return {
    readVerifiedCoverage,
    issuer: new StableCutWriterCoverageIssuer(
      { readVerifiedCoverage },
      { ...config, privateKey: signer.privateKey },
      clock,
    ),
  };
}

function signedReport(
  candidate: LaterPeriodStableCutWriterCoverage,
  key = signer.privateKey,
) {
  return {
    protocol,
    report: candidate,
    signature: sign(
      null,
      Buffer.from(archiveHash({ protocol, report: candidate }), 'hex'),
      key,
    ).toString('base64'),
  };
}

function versionedObject(candidate: unknown) {
  return versionedBytes(Buffer.from(JSON.stringify(candidate)));
}

function versionedBytes(bytes: Buffer, versionId = 'synthetic-object-version') {
  const body = Readable.from([bytes.subarray(0, 13), bytes.subarray(13)]);
  const response: GetObjectCommandOutput = {
    $metadata: { httpStatusCode: 200 },
    Body: body as NonNullable<GetObjectCommandOutput['Body']>,
    ContentLength: bytes.length,
    VersionId: versionId,
  };
  return { response, body };
}

function versionedObjectStore() {
  const objects = new Map<string, { bytes: Buffer; versionId: string }>();
  const write = (command: PutObjectCommand): PutObjectCommandOutput => {
    const { Key, Body, IfNoneMatch } = command.input;
    if (!Key || !Buffer.isBuffer(Body) || IfNoneMatch !== '*')
      throw new Error('Unexpected PUT');
    if (objects.has(Key))
      throw new S3ServiceException({
        name: 'PreconditionFailed',
        $fault: 'client',
        $metadata: { httpStatusCode: 412 },
      });
    const versionId = 'published-coverage-version';
    objects.set(Key, { bytes: Buffer.from(Body), versionId });
    return { $metadata: { httpStatusCode: 200 }, VersionId: versionId };
  };
  const send = jest.fn<
    Promise<GetObjectCommandOutput | PutObjectCommandOutput>,
    [GetObjectCommand | PutObjectCommand]
  >((command) => {
    if (command instanceof PutObjectCommand)
      return Promise.resolve().then(() => write(command));
    const stored = objects.get(command.input.Key ?? '');
    if (stored)
      return Promise.resolve(
        versionedBytes(stored.bytes, stored.versionId).response,
      );
    return Promise.reject(
      new NoSuchKey({ message: 'Missing', $metadata: { httpStatusCode: 404 } }),
    );
  });
  const client = { send } as unknown as Pick<S3Client, 'send'>;
  return { client, send, objects, write };
}

function coveragePublication(
  issuer = issuerFor().issuer,
  maxBytes = config.maxBytes,
) {
  const store = versionedObjectStore();
  const publisher = new AwsStableCutWriterCoveragePublisher(
    store.client,
    { ...config, maxBytes },
    issuer,
  );
  return { ...store, publisher };
}

function setup(candidate: unknown = signedReport(report)) {
  const { response, body } = versionedObject(candidate);
  const send = jest
    .fn<Promise<GetObjectCommandOutput>, [GetObjectCommand]>()
    .mockResolvedValue(response);
  const client = { send } as unknown as Pick<S3Client, 'send'>;
  return {
    client,
    source: new AwsSignedLaterPeriodStableCutCoverage(
      client,
      config,
      () => new Date(now),
    ),
    send,
    response,
    body,
  };
}

function archivedOperationalEvidence(
  scopeHash = scope.scopeHash,
  documents: {
    inventory: StableCutWriterInventory;
    findings: StableCutWriterFindings;
  } = operationalEvidence(scopeHash),
) {
  const { inventory, findings: unbound } = documents;
  const binding = stableCutWriterInventoryBinding(inventory);
  if (!binding) throw new Error('Invalid synthetic inventory');
  const findings = {
    ...unbound,
    writerInventoryHash: binding.writerInventoryHash,
  };
  const prefix = `stable-cut-operational-evidence/v1/${scopeHash}/${config.controlsHash}`;
  const inventoryKey = `${prefix}/inventory.json`;
  const findingsKey = `${prefix}/findings/${binding.writerInventoryHash}.json`;
  const archive = new Map<string, unknown>([
    [inventoryKey, inventory],
    [findingsKey, findings],
  ]);
  const send = jest.fn<Promise<GetObjectCommandOutput>, [GetObjectCommand]>(
    ({ input }) => {
      if (input.Key && archive.has(input.Key))
        return Promise.resolve(
          versionedObject(archive.get(input.Key)).response,
        );
      return Promise.reject(
        new NoSuchKey({
          message: 'Missing',
          $metadata: { httpStatusCode: 404 },
        }),
      );
    },
  );
  const evidenceConfig = {
    evidenceBucket: 'synthetic-operational-evidence',
    evidenceBucketOwner: '123456789013',
    maxBytes: 1024 * 1024,
  };
  const client = { send } as unknown as Pick<S3Client, 'send'>;
  const source = new AwsStableCutOperationalEvidenceSource(
    client,
    evidenceConfig,
  );
  return {
    archive,
    inventoryKey,
    findingsKey,
    binding,
    inventory,
    findings,
    send,
    source,
    evidenceConfig,
    issuer: new StableCutWriterCoverageIssuer(
      new StableCutInventoryEvidenceReader(source),
      { ...config, privateKey: signer.privateKey },
      () => new Date(now),
    ),
  };
}

describe('Signed writer coverage read from S3', () => {
  it('reads one bounded object from the configured owner and accepts the exact signed report', async () => {
    const f = setup();
    await expect(f.source.readCoverage(scope)).resolves.toEqual(report);
    expect(f.send).toHaveBeenCalledTimes(1);
    const [[request]] = f.send.mock.calls;
    expect(request).toBeInstanceOf(GetObjectCommand);
    expect(request.input).toEqual({
      Bucket: config.bucket,
      ExpectedBucketOwner: config.bucketOwner,
      Key: `stable-cut-writer-coverage/v1/${scope.scopeHash}.json`,
    });
    expect(f.body.destroyed).toBe(true);
  });

  it('does not query S3 for a scope whose facts no longer match its hash', async () => {
    const f = setup();
    await expect(
      f.source.readCoverage({ ...scope, requiredThrough: report.validUntil }),
    ).rejects.toThrow('coverage is inconsistent');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('supplies the evidence producer with scope-bound writer coverage', async () => {
    const dossier = await publishedLaterPeriod('processing');
    const { issuer, readVerifiedCoverage } = issuerFor(
      verifiedEvidence(dossier.jointScope.scopeHash),
    );
    const issued = await issuer.issue(dossier.jointScope);
    expect(issued?.objectKey).toBe(
      `stable-cut-writer-coverage/v1/${dossier.jointScope.scopeHash}.json`,
    );
    expect(readVerifiedCoverage).toHaveBeenCalledWith(
      dossier.jointScope,
      config.controlsHash,
    );
    const f = setup(issued?.envelope);
    const readSourceRetention = jest.fn().mockResolvedValue({
      expectedBucketOwner: dossier.target.expectedBucketOwner,
      mode: 'COMPLIANCE',
      reportedRetainUntil: report.validUntil,
    });
    const producer = new LaterPeriodStableCutEvidenceProducer(
      f.source,
      {
        readSourceRetention,
        readVersion: (target, revision) =>
          Promise.resolve({
            revision,
            body: Readable.from([
              target.key === dossier.live.media.historical.target.key ||
              target.key === dossier.live.media.final.target.key
                ? dossier.live.bytes
                : dossier.bytes,
            ]),
            close: () => undefined,
          }),
      },
      dossier.now,
    );
    await expect(
      producer.produce({
        scope: dossier.jointScope,
        retainedScope: dossier.retainedScope,
        retainedFiles: dossier.retainedFiles,
        liveMedia: [dossier.live.media],
      }),
    ).resolves.toMatchObject({
      accreditation: {
        writerInventoryHash: report.writerInventoryHash,
        copyEffects: report.copyEffects,
        controlsHash: report.controlsHash,
      },
      observation: { businessCommit: 'NOT_AUTHORIZED' },
    });
    expect(readSourceRetention).toHaveBeenCalledTimes(4);
  });

  it('returns an absent report only for a missing scoped object', async () => {
    const f = setup();
    f.send.mockRejectedValueOnce(
      new NoSuchKey({
        message: 'synthetic missing',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(f.source.readCoverage(scope)).resolves.toBeNull();
    f.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 403 } });
    await expect(f.source.readCoverage(scope)).rejects.toThrow(
      'could not read the signed',
    );
  });

  it('rejects an unversioned object before treating its content as a report', async () => {
    const f = setup();
    f.send.mockResolvedValueOnce({ ...f.response, VersionId: 'null' });
    await expect(f.source.readCoverage(scope)).rejects.toThrow(
      'coverage is inconsistent',
    );
    expect(f.body.destroyed).toBe(true);
  });

  it('rejects an authentic report whose version exceeds the configured read bound', async () => {
    const f = setup();
    const bounded = new AwsSignedLaterPeriodStableCutCoverage(
      f.client,
      { ...config, maxBytes: 20 },
      () => new Date(now),
    );
    await expect(bounded.readCoverage(scope)).rejects.toThrow(
      'coverage is inconsistent',
    );
    expect(f.body.destroyed).toBe(true);
  });

  it.each([
    signedReport(report, unauthorizedSigner.privateKey),
    {
      ...signedReport(report),
      report: {
        ...report,
        writerInventoryHash: archiveHash('altered inventory'),
      },
    },
    signedReport({ ...report, scopeHash: archiveHash('another reservation') }),
    signedReport({
      ...report,
      issuerId: '123e4567-e89b-42d3-a456-426614174002',
    }),
    signedReport({
      ...report,
      controlsHash: archiveHash('other controls generation'),
    }),
    signedReport({ ...report, validFrom: '2026-10-29T12:04:00.000Z' }),
    signedReport({ ...report, validUntil: scope.requiredThrough }),
    signedReport({
      ...report,
      writers: Object.fromEntries(
        Object.entries(report.writers).filter(
          ([group]) => group !== 'priorCapabilities',
        ),
      ) as PutDestinationWriters,
    }),
    signedReport({
      ...report,
      copyEffects: { ...report.copyEffects, evidenceHash: '' },
    }),
  ])(
    'rejects an invalid or inapplicable certification (%#)',
    async (candidate) => {
      const f = setup(candidate);
      await expect(f.source.readCoverage(scope)).rejects.toThrow(
        'coverage is inconsistent',
      );
    },
  );
});

function initialScope(
  copyInventory: ItemStableCutCopyInventory = {
    gate: null,
    attemptCount: 0,
    permissionCount: 0,
    attemptsDigest: itemStableCutCopyAttemptsDigestSeed(),
  },
) {
  return buildItemStableCutScope(
    {
      selector: {
        actorId: config.issuerId,
        transferId: '123e4567-e89b-42d3-a456-426614174003',
        itemId: '123e4567-e89b-42d3-a456-426614174004',
        decisionOperationId: '123e4567-e89b-42d3-a456-426614174005',
        expectedRequestVersion: 2,
        expectedCaptureRevision: 1,
      },
      expectedSealHash: archiveHash('initial seal'),
      expectedManifestHash: archiveHash('initial manifest'),
      expectedPreparedCoverageHash: archiveHash('initial prepared coverage'),
      expectedProjectionHash: archiveHash('initial projection'),
      requiredThrough: scope.requiredThrough,
    },
    copyInventory,
    {
      fileCount: 0,
      versionsDigest: archiveHash('empty version inventory'),
      conservationControlsHashes: [],
    },
  );
}

describe('Independent stable-cut writer coverage issuance', () => {
  it('publishes an initial-period envelope readable with the configured public key', async () => {
    const initial = initialScope();
    const { issuer } = archivedOperationalEvidence(initial.scopeHash);
    const issued = await issuer.issue(initial);
    expect(issued?.envelope.protocol).toBe(
      ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    );
    const { client, publisher, objects } = coveragePublication(issuer);
    const receipt = await publisher.publish(initial);
    if (!receipt) throw new Error('Expected initial period publication');
    expect(objects.get(receipt.objectKey)?.versionId).toBe(receipt.versionId);
    const reader = new AwsSignedItemStableCutCoverage(
      client,
      config,
      () => new Date(now),
    );
    await expect(reader.readCoverage(initial)).resolves.toEqual(
      issued?.envelope.report,
    );
  });

  it('returns no envelope if the independent source cannot establish coverage', async () => {
    await expect(issuerFor(null).issuer.issue(scope)).resolves.toBeNull();
  });

  it('rejects a changed scope before requesting writer evidence', async () => {
    const { issuer, readVerifiedCoverage } = issuerFor();
    await expect(
      issuer.issue({ ...scope, requiredThrough: report.validUntil }),
    ).rejects.toThrow('coverage is inconsistent');
    expect(readVerifiedCoverage).not.toHaveBeenCalled();
  });

  it.each([
    { scopeHash: archiveHash('different scope') },
    { controlsHash: archiveHash('different controls') },
    { writerInventoryHash: '' },
    {
      writers: Object.fromEntries(
        Object.entries(report.writers).filter(
          ([group]) => group !== 'priorCapabilities',
        ),
      ) as PutDestinationWriters,
    },
    { copyEffects: { ...report.copyEffects, evidenceHash: '' } },
    { validFrom: '2026-10-29T12:04:00.000Z' },
    { validUntil: scope.requiredThrough },
  ])('rejects unusable writer evidence (%#)', async (change) => {
    const { issuer } = issuerFor({ ...verifiedEvidence(), ...change });
    await expect(issuer.issue(scope)).rejects.toThrow(
      'coverage is inconsistent',
    );
  });

  it('rejects a report if its horizon elapses during evidence lookup', async () => {
    const clock = jest
      .fn(() => new Date(report.validUntil))
      .mockReturnValueOnce(new Date(now));
    await expect(
      issuerFor(verifiedEvidence(), clock).issuer.issue(scope),
    ).rejects.toThrow('coverage is inconsistent');
  });

  it('requires an Ed25519 private key for the configured issuer', () => {
    const { readVerifiedCoverage } = issuerFor();
    expect(
      () =>
        new StableCutWriterCoverageIssuer(
          { readVerifiedCoverage },
          { ...config, privateKey: config.publicKey },
          () => new Date(now),
        ),
    ).toThrow('issuer is not configured');
  });
});

describe('Initial copy permissions in operational evidence', () => {
  function permissionArchive() {
    const pins: readonly ItemStableCutAttemptPin[] = [
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174020',
        definitionHash: archiveHash('intent without permission'),
      },
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174021',
        definitionHash: archiveHash('permitted intent'),
        permission: {
          authorizationId: '123e4567-e89b-42d3-a456-426614174022',
          permissionHash: archiveHash('original MAY_RUN permission'),
        },
      },
    ];
    const initial = initialScope({
      gate: {
        id: '123e4567-e89b-42d3-a456-426614174023',
        recordHash: archiveHash('revoked copy gate'),
        revision: 2,
        state: 'REVOKED',
      },
      attemptCount: pins.length,
      permissionCount: 1,
      attemptsDigest: pins.reduce(
        appendItemStableCutCopyAttemptDigest,
        itemStableCutCopyAttemptsDigestSeed(),
      ),
    });
    const f = archivedOperationalEvidence(initial.scopeHash);
    const group = f.inventory.groups.copyEffects;
    const identityHash = archiveHash(pins[1]);
    const inventory = {
      ...f.inventory,
      initialCopyAttempts: pins,
      groups: {
        ...f.inventory.groups,
        copyEffects: {
          ...group,
          identityHashes: [...group.identityHashes, identityHash],
        },
      },
    };
    const binding = stableCutWriterInventoryBinding(inventory);
    if (!binding) throw new Error('Expected fixture inventory hash');
    const findingsKey = f.findingsKey.replace(
      f.binding.writerInventoryHash,
      binding.writerInventoryHash,
    );
    const findings = {
      ...f.findings,
      writerInventoryHash: binding.writerInventoryHash,
      groups: {
        ...f.findings.groups,
        copyEffects: [
          ...f.findings.groups.copyEffects,
          {
            identityHash,
            disposition: 'ISOLATED',
            evidenceHash: archiveHash('independent isolation proof'),
          },
        ],
      },
    };
    f.archive.set(f.inventoryKey, inventory);
    f.archive.set(findingsKey, findings);
    return { ...f, initial, pins, inventory, findings, findingsKey };
  }

  it('uses a distinct independent finding for the original permission under a revoked gate', async () => {
    const f = permissionArchive();
    const issued = await f.issuer.issue(f.initial);
    expect(issued?.envelope.report).toMatchObject({
      scopeHash: f.initial.scopeHash,
      writerInventoryHash: f.findings.writerInventoryHash,
    });
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it.each(['missing', 'reordered', 'altered'] as const)(
    'blocks issuance if the original attempt list is %s',
    async (change) => {
      const f = permissionArchive();
      const pins = {
        missing: undefined,
        reordered: [...f.pins].reverse(),
        altered: [
          f.pins[0],
          { ...f.pins[1], definitionHash: archiveHash('another intent') },
        ],
      }[change];
      f.archive.set(f.inventoryKey, {
        ...f.inventory,
        initialCopyAttempts: pins,
      });
      await expect(f.issuer.issue(f.initial)).resolves.toBeNull();
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );

  it('blocks a completeness declaration that omits the recorded permission', async () => {
    const f = permissionArchive();
    f.archive.set(f.inventoryKey, {
      ...f.inventory,
      groups: {
        ...f.inventory.groups,
        copyEffects: {
          ...f.inventory.groups.copyEffects,
          identityHashes: f.inventory.groups.copyEffects.identityHashes.slice(
            0,
            -1,
          ),
        },
      },
    });
    await expect(f.issuer.issue(f.initial)).resolves.toBeNull();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('blocks a recorded permission with no independent finding', async () => {
    const f = permissionArchive();
    f.archive.set(f.findingsKey, {
      ...f.findings,
      groups: {
        ...f.findings.groups,
        copyEffects: f.findings.groups.copyEffects.slice(0, 1),
      },
    });
    await expect(f.issuer.issue(f.initial)).resolves.toBeNull();
    expect(f.send).toHaveBeenCalledTimes(2);
  });
});

describe('Versioned publication of signed writer coverage', () => {
  it('conditionally publishes the later-period envelope with a checksum', async () => {
    const { issuer } = archivedOperationalEvidence();
    const { client, publisher, objects, send } = coveragePublication(issuer);
    const receipt = await publisher.publish(scope);
    const objectKey = `stable-cut-writer-coverage/v1/${scope.scopeHash}.json`;
    const stored = objects.get(objectKey);
    if (!stored) throw new Error('Expected published bytes');
    expect(receipt).toEqual({ objectKey, versionId: stored.versionId });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: config.bucket,
      ExpectedBucketOwner: config.bucketOwner,
      Key: objectKey,
      IfNoneMatch: '*',
      ContentLength: stored.bytes.length,
      ContentType: 'application/json',
      ChecksumSHA256: createHash('sha256')
        .update(stored.bytes)
        .digest('base64'),
    });
    const reader = new AwsSignedLaterPeriodStableCutCoverage(
      client,
      config,
      () => new Date(now),
    );
    await expect(reader.readCoverage(scope)).resolves.toMatchObject({
      scopeHash: scope.scopeHash,
    });
  });

  it('confirms an identical concurrent publication with the same version', async () => {
    const { publisher, objects, send } = coveragePublication();
    const [first, second] = await Promise.all([
      publisher.publish(scope),
      publisher.publish(scope),
    ]);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(objects.size).toBe(1);
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      PutObjectCommand,
      PutObjectCommand,
      GetObjectCommand,
    ]);
  });

  it('recovers a lost PUT response by observing the identical version', async () => {
    const { publisher, send, write } = coveragePublication();
    send.mockImplementationOnce((command) => {
      if (!(command instanceof PutObjectCommand))
        throw new Error('Expected PUT');
      write(command);
      return Promise.reject(new Error('Connection lost after write'));
    });
    await expect(publisher.publish(scope)).resolves.toEqual({
      objectKey: `stable-cut-writer-coverage/v1/${scope.scopeHash}.json`,
      versionId: 'published-coverage-version',
    });
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      PutObjectCommand,
      GetObjectCommand,
    ]);
  });

  it('preserves a different signed report at the same key', async () => {
    const { client, publisher, objects } = coveragePublication();
    const receipt = await publisher.publish(scope);
    if (!receipt) throw new Error('Expected prior publication');
    const original = objects.get(receipt.objectKey);
    const { issuer } = issuerFor({
      ...verifiedEvidence(),
      writerInventoryHash: archiveHash('changed inventory'),
    });
    const contender = new AwsStableCutWriterCoveragePublisher(
      client,
      config,
      issuer,
    );
    await expect(contender.publish(scope)).rejects.toThrow(
      'published stable-cut writer coverage is inconsistent',
    );
    expect(objects.get(receipt.objectKey)).toBe(original);
  });

  it('keeps an ambiguous write unconfirmed if the GET finds no object', async () => {
    const { publisher, send } = coveragePublication();
    send.mockRejectedValueOnce(new Error('Connection interrupted'));
    await expect(publisher.publish(scope)).rejects.toThrow(
      'publication was not confirmed',
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('requires a version for a successful PUT or a matching GET', async () => {
    const { publisher, send } = coveragePublication();
    send.mockResolvedValueOnce({
      $metadata: { httpStatusCode: 200 },
      VersionId: 'null',
    });
    send.mockResolvedValueOnce({
      ...versionedObject(signedReport(report)).response,
      VersionId: 'null',
    });
    await expect(publisher.publish(scope)).rejects.toThrow(
      'published stable-cut writer coverage is inconsistent',
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('skips publication when coverage is absent or too large', async () => {
    const unavailable = coveragePublication(issuerFor(null).issuer);
    await expect(unavailable.publisher.publish(scope)).resolves.toBeNull();
    expect(unavailable.send).not.toHaveBeenCalled();
    const bounded = coveragePublication(issuerFor().issuer, 1);
    await expect(bounded.publisher.publish(scope)).rejects.toThrow(
      'published stable-cut writer coverage is inconsistent',
    );
    expect(bounded.send).not.toHaveBeenCalled();
  });
});

describe('Later-period copy permissions in operational evidence', () => {
  async function laterCopyArchive() {
    const dossier = await publishedLaterPeriod('processing');
    const scope = dossier.jointScope;
    const file = dossier.live.record;
    const proof: LaterPeriodStableCutCopyEvidence = {
      retainedBinding: dossier.retainedScope.binding,
      retainedFiles: dossier.retainedFiles,
      liveMedia: [
        { fileId: file.scope.fileId, evidence: file.liveMediaEvidence },
      ],
    };
    const livePermissions = file.liveMediaEvidence.copyPermissionHashes;
    if (!livePermissions)
      throw new Error('Expected original live PUT permissions');
    const identities = [
      ...dossier.retainedFiles.flatMap(({ attempts }) =>
        attempts.map(({ permissionHash }) => permissionHash),
      ),
      livePermissions.historical,
      livePermissions.final,
    ];
    const { inventory, findings } = operationalEvidence(scope.scopeHash);
    const archived = archivedOperationalEvidence(scope.scopeHash, {
      inventory: {
        ...inventory,
        laterCopyEvidence: proof,
        groups: {
          ...inventory.groups,
          copyEffects: {
            ...inventory.groups.copyEffects,
            identityHashes: [
              ...inventory.groups.copyEffects.identityHashes,
              ...identities,
            ],
          },
        },
      },
      findings: {
        ...findings,
        groups: {
          ...findings.groups,
          copyEffects: [
            ...findings.groups.copyEffects,
            ...identities.map((identityHash) => ({
              identityHash,
              disposition: 'RECONCILED_AND_CONTROLLED' as const,
              evidenceHash: archiveHash(['independent finding', identityHash]),
            })),
          ],
        },
      },
    });
    return { ...archived, scope, proof };
  }

  it('signs when retained and live copy permits have their own findings', async () => {
    const f = await laterCopyArchive();
    const issued = await f.issuer.issue(f.scope);
    expect(issued?.envelope.report).toMatchObject({
      scopeHash: f.scope.scopeHash,
      writerInventoryHash: f.binding.writerInventoryHash,
    });
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it('archives the nonempty copy proof in a form the issuer can use', async () => {
    const upstream = await laterCopyArchive();
    const store = versionedObjectStore();
    const collector = new AwsStableCutOperationalEvidenceArchive(
      store.client,
      upstream.evidenceConfig,
      upstream.source,
    );
    await expect(
      collector.archive(upstream.scope, config.controlsHash),
    ).resolves.toMatchObject({
      writerInventoryHash: upstream.binding.writerInventoryHash,
    });
    expect(store.send.mock.calls.map(([command]) => command.input.Key)).toEqual(
      [upstream.findingsKey, upstream.inventoryKey],
    );
    const source = new AwsStableCutOperationalEvidenceSource(
      store.client,
      upstream.evidenceConfig,
    );
    const issuer = new StableCutWriterCoverageIssuer(
      new StableCutInventoryEvidenceReader(source),
      { ...config, privateKey: signer.privateKey },
      () => new Date(now),
    );
    await expect(issuer.issue(upstream.scope)).resolves.toMatchObject({
      envelope: {
        report: { writerInventoryHash: upstream.binding.writerInventoryHash },
      },
    });
  });

  it.each(['missing', 'retained version', 'live permission'] as const)(
    'prevents signing with %s copy evidence',
    async (change) => {
      const f = await laterCopyArchive();
      const retained = f.proof.retainedFiles[0];
      const live = f.proof.liveMedia[0];
      const proofs = {
        missing: undefined,
        'retained version': {
          ...f.proof,
          retainedFiles: [
            {
              ...retained,
              historical: {
                ...retained.historical,
                revision: {
                  ...retained.historical.revision,
                  versionId: 'different-version',
                },
              },
            },
          ],
        },
        'live permission': {
          ...f.proof,
          liveMedia: [
            {
              ...live,
              evidence: {
                ...live.evidence,
                copyPermissionHashes: {
                  ...live.evidence.copyPermissionHashes,
                  final: archiveHash('different original permit'),
                },
              },
            },
          ],
        },
      };
      f.archive.set(f.inventoryKey, {
        ...f.inventory,
        laterCopyEvidence: proofs[change],
      });
      await expect(f.issuer.issue(f.scope)).resolves.toBeNull();
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );

  it('stops before loading findings when the inventory omits a pinned permission', async () => {
    const f = await laterCopyArchive();
    f.archive.set(f.inventoryKey, {
      ...f.inventory,
      groups: {
        ...f.inventory.groups,
        copyEffects: {
          ...f.inventory.groups.copyEffects,
          identityHashes: f.inventory.groups.copyEffects.identityHashes.slice(
            0,
            -1,
          ),
        },
      },
    });
    await expect(f.issuer.issue(f.scope)).resolves.toBeNull();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('requires a finding for every pinned permission', async () => {
    const f = await laterCopyArchive();
    f.archive.set(f.findingsKey, {
      ...f.findings,
      groups: {
        ...f.findings.groups,
        copyEffects: f.findings.groups.copyEffects.slice(0, -1),
      },
    });
    await expect(f.issuer.issue(f.scope)).resolves.toBeNull();
    expect(f.send).toHaveBeenCalledTimes(2);
  });
});

describe('Standalone coverage issuer operation', () => {
  function operationFixture() {
    const evidence = archivedOperationalEvidence();
    const output = coveragePublication();
    const keyFile = resolve('synthetic-mounted-issuer.pem');
    const scopeFile = 'synthetic-scope.json';
    const keyBytes = Buffer.from(
      signer.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    );
    const fingerprint = createHash('sha256')
      .update(signer.publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex');
    const args = ['publish', '--scope-file', scopeFile];
    const env = {
      STABLE_CUT_REGION: 'us-east-1',
      STABLE_CUT_ISSUER_ID: config.issuerId,
      STABLE_CUT_CONTROLS_HASH: config.controlsHash,
      STABLE_CUT_PRIVATE_KEY_FILE: keyFile,
      STABLE_CUT_PUBLIC_KEY_SHA256: fingerprint,
      STABLE_CUT_EVIDENCE_BUCKET: evidence.evidenceConfig.evidenceBucket,
      STABLE_CUT_EVIDENCE_BUCKET_OWNER:
        evidence.evidenceConfig.evidenceBucketOwner,
      STABLE_CUT_COVERAGE_BUCKET: config.bucket,
      STABLE_CUT_COVERAGE_BUCKET_OWNER: config.bucketOwner,
    };
    const client = {
      send: jest.fn((command: GetObjectCommand | PutObjectCommand) =>
        command instanceof GetObjectCommand &&
        command.input.Bucket === evidence.evidenceConfig.evidenceBucket
          ? evidence.send(command)
          : output.send(command),
      ),
      destroy: jest.fn(),
    };
    const ports = {
      readFile: jest.fn((path: string) => {
        if (path === scopeFile)
          return Promise.resolve(Buffer.from(JSON.stringify(scope)));
        if (path === keyFile) return Promise.resolve(keyBytes);
        return Promise.reject(new Error('Unexpected path'));
      }),
      createClient: jest.fn(
        () => client as unknown as Pick<S3Client, 'send' | 'destroy'>,
      ),
      now: () => new Date(now),
    };
    return { args, env, ports, keyBytes, client, evidence, output };
  }

  it('publishes a version with the pinned public key and releases the client', async () => {
    const { args, env, ports, keyBytes, client, evidence, output } =
      operationFixture();
    const result = await runStableCutCoverageOperation(args, env, ports);
    expect(result).toEqual({
      exitCode: 0,
      output: {
        version: 'STABLE_CUT_COVERAGE_OPERATION_V1',
        status: 'PUBLISHED',
        objectKey: `stable-cut-writer-coverage/v1/${scope.scopeHash}.json`,
        versionId: 'published-coverage-version',
      },
    });
    expect(ports.createClient).toHaveBeenCalledWith(env.STABLE_CUT_REGION);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(keyBytes.every((byte) => byte === 0)).toBe(true);
    const reader = new AwsSignedLaterPeriodStableCutCoverage(
      output.client,
      config,
      () => new Date(now),
    );
    await expect(reader.readCoverage(scope)).resolves.toMatchObject({
      writerInventoryHash: evidence.binding.writerInventoryHash,
    });
  });

  it('shows help without reading configuration or opening the client', async () => {
    const { ports } = operationFixture();
    await expect(
      runStableCutCoverageOperation(['--help'], {}, ports),
    ).resolves.toMatchObject({ exitCode: 0, output: { status: 'HELP' } });
    expect(ports.readFile).not.toHaveBeenCalled();
    expect(ports.createClient).not.toHaveBeenCalled();
  });

  it('rejects incomplete configuration before reading files or opening the client', async () => {
    const { args, env, ports } = operationFixture();
    await expect(
      runStableCutCoverageOperation(
        args,
        { ...env, STABLE_CUT_COVERAGE_BUCKET_OWNER: undefined },
        ports,
      ),
    ).resolves.toMatchObject({ exitCode: 1, output: { stage: 'INPUT' } });
    expect(ports.readFile).not.toHaveBeenCalled();
    expect(ports.createClient).not.toHaveBeenCalled();
  });

  it('rejects an altered scope before reading the signing key', async () => {
    const { args, env, ports } = operationFixture();
    ports.readFile.mockResolvedValueOnce(
      Buffer.from(
        JSON.stringify({ ...scope, requiredThrough: report.validUntil }),
      ),
    );
    await expect(
      runStableCutCoverageOperation(args, env, ports),
    ).resolves.toMatchObject({ exitCode: 1, output: { stage: 'SCOPE' } });
    expect(ports.readFile).toHaveBeenCalledTimes(1);
    expect(ports.createClient).not.toHaveBeenCalled();
  });

  it('rejects an unexpected signing key before storage I/O and wipes its input buffer', async () => {
    const { args, env, ports, keyBytes } = operationFixture();
    const result = await runStableCutCoverageOperation(
      args,
      { ...env, STABLE_CUT_PUBLIC_KEY_SHA256: archiveHash('different key') },
      ports,
    );
    expect(result.output).toEqual({
      version: 'STABLE_CUT_COVERAGE_OPERATION_V1',
      status: 'ERROR',
      stage: 'KEY',
    });
    expect(keyBytes.every((byte) => byte === 0)).toBe(true);
    expect(ports.createClient).not.toHaveBeenCalled();
  });

  it('reports absent evidence without attempting publication', async () => {
    const { args, env, ports, client, evidence, output } = operationFixture();
    evidence.archive.delete(evidence.findingsKey);
    await expect(
      runStableCutCoverageOperation(args, env, ports),
    ).resolves.toMatchObject({
      exitCode: 2,
      output: { status: 'EVIDENCE_UNAVAILABLE' },
    });
    expect(output.send).not.toHaveBeenCalled();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('Archived operational evidence', () => {
  it('reads exact collector objects and issues coverage that the later-period reader accepts', async () => {
    const { issuer, send, inventoryKey, findingsKey, binding, evidenceConfig } =
      archivedOperationalEvidence();
    const issued = await issuer.issue(scope);
    expect(issued?.envelope.report.writerInventoryHash).toBe(
      binding.writerInventoryHash,
    );
    expect(send.mock.calls).toHaveLength(2);
    expect(send.mock.calls.map(([command]) => command.input)).toEqual(
      [inventoryKey, findingsKey].map((Key) => ({
        Bucket: evidenceConfig.evidenceBucket,
        ExpectedBucketOwner: evidenceConfig.evidenceBucketOwner,
        Key,
      })),
    );
    const { source } = setup(issued?.envelope);
    await expect(source.readCoverage(scope)).resolves.toEqual(
      issued?.envelope.report,
    );
  });

  it('stops when the inventory is absent', async () => {
    const { archive, inventoryKey, issuer, send } =
      archivedOperationalEvidence();
    archive.delete(inventoryKey);
    await expect(issuer.issue(scope)).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not sign when only findings for the previous inventory are present', async () => {
    const { archive, inventory, inventoryKey, issuer, send, findingsKey } =
      archivedOperationalEvidence();
    archive.set(inventoryKey, {
      ...inventory,
      validUntil: '2026-10-29T12:08:00.000Z',
    });
    await expect(issuer.issue(scope)).resolves.toBeNull();
    expect(archive.has(findingsKey)).toBe(true);
    expect(send.mock.calls[1][0].input.Key).not.toBe(findingsKey);
  });

  it.each([
    { scopeHash: archiveHash('another transfer') },
    { controlsHash: archiveHash('another generation') },
    { writerInventoryHash: archiveHash('previous inventory') },
    { validUntil: 'not a date' },
    { groups: {} },
  ])(
    'rejects a mismatched or malformed findings object (%#)',
    async (change) => {
      const { archive, findingsKey, findings, issuer } =
        archivedOperationalEvidence();
      archive.set(findingsKey, { ...findings, ...change });
      await expect(issuer.issue(scope)).rejects.toThrow();
    },
  );

  it('distinguishes an unavailable evidence bucket from a missing object', async () => {
    const { issuer, send } = archivedOperationalEvidence();
    send.mockRejectedValueOnce(new Error('Access denied'));
    await expect(issuer.issue(scope)).rejects.toThrow('S3 could not read');
  });

  it('rejects an unversioned inventory before requesting findings', async () => {
    const { issuer, send, inventory } = archivedOperationalEvidence();
    const { response, body } = versionedObject(inventory);
    send.mockResolvedValueOnce({ ...response, VersionId: 'null' });
    await expect(issuer.issue(scope)).rejects.toThrow(
      'document is inconsistent',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(body.destroyed).toBe(true);
  });

  it('rejects an invalid inventory selector without calling storage', async () => {
    const { source, send } = archivedOperationalEvidence();
    await expect(
      source.readFindings(scope, config.controlsHash, '../findings'),
    ).rejects.toThrow('document is inconsistent');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Versioned collector evidence archive', () => {
  function collection() {
    const { inventory, findings, readInventory, readFindings } =
      operationalEvidence();
    const store = versionedObjectStore();
    const evidenceConfig = {
      evidenceBucket: 'synthetic-operational-evidence',
      evidenceBucketOwner: '123456789013',
      maxBytes: 4096,
    };
    const source = new AwsStableCutOperationalEvidenceSource(
      store.client,
      evidenceConfig,
    );
    const collector = new AwsStableCutOperationalEvidenceArchive(
      store.client,
      evidenceConfig,
      { readInventory, readFindings },
    );
    return {
      ...store,
      inventory,
      findings,
      readInventory,
      readFindings,
      source,
      collector,
    };
  }

  it('leaves the inventory unmodified if the findings write cannot be confirmed', async () => {
    const f = collection();
    f.send.mockRejectedValueOnce(new Error('Lost findings response'));
    await expect(
      f.collector.archive(scope, config.controlsHash),
    ).rejects.toThrow('write was not confirmed');
    expect(f.objects.size).toBe(0);
    const [put, get] = f.send.mock.calls.map(([command]) => command);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(get).toBeInstanceOf(GetObjectCommand);
    expect(get.input.Key).toBe(put.input.Key);
    expect(put.input.Key).toContain('/findings/');
  });

  it('resumes when findings were saved but the inventory write was interrupted', async () => {
    const f = collection();
    f.send
      .mockImplementationOnce((command) => {
        if (!(command instanceof PutObjectCommand))
          throw new Error('Expected findings PUT');
        return Promise.resolve(f.write(command));
      })
      .mockRejectedValueOnce(new Error('Interrupted inventory write'));
    await expect(
      f.collector.archive(scope, config.controlsHash),
    ).rejects.toThrow('write was not confirmed');
    const [findingsKey] = f.objects.keys();
    const saved = f.objects.get(findingsKey);
    expect(f.objects.size).toBe(1);
    expect(findingsKey).toContain('/findings/');
    await expect(
      f.source.readInventory(scope, config.controlsHash),
    ).resolves.toBeNull();
    const archived = await f.collector.archive(scope, config.controlsHash);
    expect(archived?.findingsVersionId).toBe(saved?.versionId);
    expect(f.objects.get(findingsKey)).toBe(saved);
    expect(f.objects.size).toBe(2);
    await expect(
      new StableCutInventoryEvidenceReader(f.source).readVerifiedCoverage(
        scope,
        config.controlsHash,
      ),
    ).resolves.toMatchObject({
      writerInventoryHash: archived?.writerInventoryHash,
    });
  });

  it('does not archive either document when upstream findings reference a different inventory', async () => {
    const f = collection();
    f.readFindings.mockResolvedValueOnce(f.findings);
    await expect(
      f.collector.archive(scope, config.controlsHash),
    ).resolves.toBeNull();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects a different finding for an already archived inventory', async () => {
    const f = collection();
    const existing = await f.collector.archive(scope, config.controlsHash);
    if (!existing) throw new Error('Expected archived evidence');
    const previous = [...f.objects];
    f.readFindings.mockResolvedValueOnce({
      ...f.findings,
      writerInventoryHash: existing.writerInventoryHash,
      groups: {
        ...f.findings.groups,
        copyEffects: [
          {
            ...f.findings.groups.copyEffects[0],
            evidenceHash: archiveHash('different finding'),
          },
        ],
      },
    });
    f.send.mockClear();
    await expect(
      f.collector.archive(scope, config.controlsHash),
    ).rejects.toThrow('document is inconsistent');
    expect([...f.objects]).toEqual(previous);
    expect(
      f.send.mock.calls.every(([command]) =>
        command.input.Key?.includes('/findings/'),
      ),
    ).toBe(true);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it('preserves the earlier pair when another inventory loses the index write', async () => {
    const f = collection();
    const original = await f.collector.archive(scope, config.controlsHash);
    if (!original) throw new Error('Expected archived evidence');
    f.readInventory.mockResolvedValueOnce({
      ...f.inventory,
      groups: {
        ...f.inventory.groups,
        externalSystems: {
          ...f.inventory.groups.externalSystems,
          completenessEvidenceHash: archiveHash('different attestation'),
        },
      },
    });
    await expect(
      f.collector.archive(scope, config.controlsHash),
    ).rejects.toThrow('document is inconsistent');
    expect(f.objects.size).toBe(3);
    await expect(
      new StableCutInventoryEvidenceReader(f.source).readVerifiedCoverage(
        scope,
        config.controlsHash,
      ),
    ).resolves.toMatchObject({
      writerInventoryHash: original.writerInventoryHash,
    });
  });
});

describe('Independent inventory and writer evidence', () => {
  it('binds a complete inventory and matching findings to the signed later-period coverage', async () => {
    const { issuer, readFindings } = operationalEvidence();
    const issued = await issuer.issue(scope);
    expect(issued?.envelope.report).toMatchObject({
      scopeHash: scope.scopeHash,
      controlsHash: config.controlsHash,
      writers: {
        applicationDeployments: { disposition: 'RECONCILED_AND_CONTROLLED' },
        externalSystems: { disposition: 'ISOLATED' },
      },
      copyEffects: { disposition: 'RECONCILED_AND_CONTROLLED' },
      validFrom: report.validFrom,
      validUntil: report.validUntil,
    });
    expect(readFindings).toHaveBeenCalledWith(
      scope,
      config.controlsHash,
      issued?.envelope.report.writerInventoryHash,
    );
    const { client } = setup(issued?.envelope);
    const reader = new AwsSignedLaterPeriodStableCutCoverage(
      client,
      config,
      () => new Date(now),
    );
    await expect(reader.readCoverage(scope)).resolves.toEqual(
      issued?.envelope.report,
    );
  });

  it('produces the same signed envelope when member order changes', async () => {
    const { issuer, inventory, findings, readInventory, readFindings } =
      operationalEvidence();
    const issued = await issuer.issue(scope);
    expect(issued).not.toBeNull();
    readInventory.mockResolvedValueOnce({
      ...inventory,
      groups: {
        ...inventory.groups,
        applicationDeployments: {
          ...inventory.groups.applicationDeployments,
          identityHashes: [
            ...inventory.groups.applicationDeployments.identityHashes,
          ].reverse(),
        },
      },
    });
    readFindings.mockImplementationOnce(
      (_scope, _controls, writerInventoryHash) =>
        Promise.resolve({
          ...findings,
          writerInventoryHash,
          groups: {
            ...findings.groups,
            applicationDeployments: [
              ...findings.groups.applicationDeployments,
            ].reverse(),
          },
        }),
    );
    await expect(issuer.issue(scope)).resolves.toEqual(issued);
  });

  it('rejects findings from before a change to the completeness evidence', async () => {
    const { issuer, inventory, findings, readInventory, readFindings } =
      operationalEvidence();
    const issued = await issuer.issue(scope);
    if (!issued) throw new Error('Expected original coverage');
    const writerInventoryHash = issued.envelope.report.writerInventoryHash;
    readInventory.mockResolvedValueOnce({
      ...inventory,
      groups: {
        ...inventory.groups,
        priorCapabilities: {
          ...inventory.groups.priorCapabilities,
          completenessEvidenceHash: archiveHash('new independent census'),
        },
      },
    });
    readFindings.mockResolvedValueOnce({ ...findings, writerInventoryHash });
    await expect(issuer.issue(scope)).resolves.toBeNull();
  });

  it.each([
    ['different scope', { scopeHash: archiveHash('different scope') }],
    [
      'different generation',
      { controlsHash: archiveHash('different generation') },
    ],
    ['window ending at the horizon', { validUntil: scope.requiredThrough }],
  ])(
    'stops before reading findings for an inventory with %s',
    async (_label, change) => {
      const { issuer, inventory, readInventory, readFindings } =
        operationalEvidence();
      readInventory.mockResolvedValueOnce({ ...inventory, ...change });
      await expect(issuer.issue(scope)).resolves.toBeNull();
      expect(readFindings).not.toHaveBeenCalled();
    },
  );

  it('requires completeness evidence even for groups with no members', async () => {
    const { issuer, inventory, readInventory, readFindings } =
      operationalEvidence();
    readInventory.mockResolvedValueOnce({
      ...inventory,
      groups: {
        ...inventory.groups,
        priorCapabilities: { completenessEvidenceHash: '', identityHashes: [] },
      },
    });
    await expect(issuer.issue(scope)).resolves.toBeNull();
    expect(readFindings).not.toHaveBeenCalled();
  });

  it('rejects duplicate members in the inventory', async () => {
    const { issuer, inventory, readInventory, readFindings } =
      operationalEvidence();
    const group = inventory.groups.applicationDeployments;
    readInventory.mockResolvedValueOnce({
      ...inventory,
      groups: {
        ...inventory.groups,
        applicationDeployments: {
          ...group,
          identityHashes: [group.identityHashes[0], group.identityHashes[0]],
        },
      },
    });
    await expect(issuer.issue(scope)).resolves.toBeNull();
    expect(readFindings).not.toHaveBeenCalled();
  });

  it.each([
    ['different scope', { scopeHash: archiveHash('stale scope') }],
    ['different generation', { controlsHash: archiveHash('stale generation') }],
    ['window ending at the horizon', { validUntil: scope.requiredThrough }],
  ])('rejects findings with %s', async (_label, change) => {
    const { issuer, findings, readFindings } = operationalEvidence();
    readFindings.mockImplementationOnce(
      (_scope, _controls, writerInventoryHash) =>
        Promise.resolve({
          ...findings,
          ...change,
          writerInventoryHash,
        }),
    );
    await expect(issuer.issue(scope)).resolves.toBeNull();
  });

  it.each(['missing', 'duplicate', 'unexpected', 'unresolved'] as const)(
    'declines a %s finding for a writer or copy effect',
    async (change) => {
      const { issuer, findings, readFindings } = operationalEvidence();
      const [first, second] = findings.groups.applicationDeployments;
      const copy = findings.groups.copyEffects[0];
      const groups = {
        missing: { ...findings.groups, copyEffects: [] },
        duplicate: {
          ...findings.groups,
          applicationDeployments: [first, first],
        },
        unexpected: {
          ...findings.groups,
          applicationDeployments: [
            first,
            { ...second, identityHash: copy.identityHash },
          ],
        },
        unresolved: {
          ...findings.groups,
          copyEffects: [
            { ...copy, disposition: 'MAY_RUN' as typeof copy.disposition },
          ],
        },
      };
      readFindings.mockImplementationOnce(
        (_scope, _controls, writerInventoryHash) =>
          Promise.resolve({
            ...findings,
            writerInventoryHash,
            groups: groups[change],
          }),
      );
      await expect(issuer.issue(scope)).resolves.toBeNull();
    },
  );
});
