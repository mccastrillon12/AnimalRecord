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

function setup(candidate: unknown = signedReport(report)) {
  const bytes = Buffer.from(JSON.stringify(candidate));
  const body = Readable.from([bytes.subarray(0, 13), bytes.subarray(13)]);
  const response: GetObjectCommandOutput = {
    $metadata: { httpStatusCode: 200 },
    Body: body as NonNullable<GetObjectCommandOutput['Body']>,
    ContentLength: bytes.length,
    VersionId: 'signed-report-version',
  };
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
    const evidence = verifiedEvidence(initial.scopeHash);
    const { issuer } = issuerFor(evidence);
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
    await expect(reader.readCoverage(initial)).resolves.toEqual({
      ...evidence,
      issuerId: config.issuerId,
    });
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
