import {
  GetObjectCommand,
  NoSuchKey,
  type GetObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
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
  buildItemStableCutScope,
  LATER_PERIOD_STABLE_CUT_SCOPE_PROTOCOL,
  type LaterPeriodStableCutScope,
} from '../../../src/context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import {
  AwsSignedItemStableCutCoverage,
  AwsSignedLaterPeriodStableCutCoverage,
  ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
  LATER_PERIOD_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
} from '../../../src/context/animal-transfer/infrastructure/storage/aws-signed-stable-cut-coverage';
import { AwsStableCutOperationalEvidenceSource } from '../../../src/context/animal-transfer/infrastructure/storage/aws-stable-cut-operational-evidence-source';
import { StableCutWriterCoverageIssuer } from '../../../src/context/animal-transfer/infrastructure/storage/signed-stable-cut-coverage';
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
  retainedFileCount: 1,
  liveManifest: {
    entryCount: 1,
    fileCount: 1,
    entriesDigest: archiveHash('entries'),
    filesDigest: archiveHash('files'),
  },
  liveProjectionHash: archiveHash('current projection'),
  liveMediaDigest: archiveHash('media'),
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
  const bytes = Buffer.from(JSON.stringify(candidate));
  const body = Readable.from([bytes.subarray(0, 13), bytes.subarray(13)]);
  const response: GetObjectCommandOutput = {
    $metadata: { httpStatusCode: 200 },
    Body: body as NonNullable<GetObjectCommandOutput['Body']>,
    ContentLength: bytes.length,
    VersionId: 'synthetic-object-version',
  };
  return { response, body };
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

function archivedOperationalEvidence(scopeHash = scope.scopeHash) {
  const { inventory, findings: unbound } = operationalEvidence(scopeHash);
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
    maxBytes: config.maxBytes,
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

describe('Independent stable-cut writer coverage issuance', () => {
  it('issues an initial-period envelope readable with the configured public key', async () => {
    const decision = '123e4567-e89b-42d3-a456-426614174003';
    const initial = buildItemStableCutScope(
      {
        selector: {
          actorId: config.issuerId,
          transferId: decision,
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
      {
        gate: null,
        attemptCount: 0,
        permissionCount: 0,
        attemptsDigest: archiveHash('empty attempt inventory'),
      },
      {
        fileCount: 0,
        versionsDigest: archiveHash('empty version inventory'),
        conservationControlsHashes: [],
      },
    );
    const { issuer } = archivedOperationalEvidence(initial.scopeHash);
    const issued = await issuer.issue(initial);
    expect(issued?.envelope.protocol).toBe(
      ITEM_WRITER_COVERAGE_SIGNATURE_PROTOCOL,
    );
    const { client } = setup(issued?.envelope);
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
