import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { buildItemCopyAttemptIntent } from '../../../src/context/animal-transfer/domain/transfer-item-copy-attempt';
import { buildItemHistoricalSourceAnchor } from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  buildItemFixedSourceObservation,
  buildItemSourceProfileObservation,
  buildItemSourceStorageObservation,
  buildItemSourceDelegationBound,
  evaluateItemSourceReadWindow,
  matchItemSourceDelegationBound,
  sourceRetentionSelectorHash,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

const at = (time: string) => `2026-11-08T${time}:00.000Z`;
type Input = Parameters<typeof evaluateItemSourceReadWindow>[0];

async function setup({
  fixedUntil = at('16:00'),
  profileUntil = at('15:00'),
  accreditedUntil = at('14:00'),
  storageClass = 'OMITTED',
} = {}) {
  const f = await historicalCopyPreparationFixture();
  await f.service.prepareHistoricalCopy(f.input);
  const context = await f.store.readHistoricalCopy(f.input);
  const intent = context.file.historicalCopyIntent!;
  const attempt = buildItemCopyAttemptIntent(context, 'HISTORICAL', {
    attemptId: f.id(901),
    dispatcherInstanceId: f.id(902),
    origin: 'INITIAL',
  });
  const expectedBucketOwner = '123456789012';
  const material = {
    binding: intent.binding,
    manifestHash: 'a'.repeat(64),
    intentId: intent.id,
    intentDefinitionHash: intent.definitionHash,
    sourceObservationHash: 'b'.repeat(64),
    source: { bucket: intent.bucket, ...intent.source },
  };
  const selectorHash = sourceRetentionSelectorHash(
    material.source,
    expectedBucketOwner,
  );
  const definition = {
    protocol: 'ITEM_HISTORICAL_SOURCE_PROFILE_V1',
    id: f.id(904),
    revision: 3,
    issuerId: f.id(905),
    selectorHash,
    signerContextHash: 'c'.repeat(64),
    controlsHash: 'd'.repeat(64),
    validFrom: at('12:00'),
    validUntil: profileUntil,
  } as const;
  const currentProfile = {
    ...definition,
    state: 'ACTIVE',
    definitionHash: archiveHash(definition),
  } as const;
  const { id, revision, definitionHash } = currentProfile;
  const fixedSource = buildItemFixedSourceObservation({
    anchorHash: buildItemHistoricalSourceAnchor(material).anchorHash,
    selectorHash,
    mode: 'COMPLIANCE',
    eventHold: 'OFF',
    observedAt: at('12:15'),
    fixedRetainUntil: fixedUntil,
  });
  const storageObservation = buildItemSourceStorageObservation(
    fixedSource.observationHash,
    {
      encryption: 'SSE_S3',
      storageClass: storageClass === 'STANDARD' ? 'STANDARD' : 'OMITTED',
      restoreOrArchiveReported: false,
    },
  );
  const profileObservation = buildItemSourceProfileObservation(
    { id, revision, definitionHash },
    fixedSource,
    storageObservation,
  );
  return {
    material,
    expectedBucketOwner,
    observation: { fixedSource, storageObservation, profileObservation },
    currentProfile,
    attempt,
    accreditation: {
      profileDefinitionHash: definitionHash,
      endpoint: 'DIRECT_S3',
      evidenceHash: 'e'.repeat(64),
      validFrom: at('12:45'),
      validUntil: accreditedUntil,
    },
    readBound: {
      basis: 'ACCREDITED_LAST_SOURCE_READ',
      attemptDefinitionHash: attempt.definitionHash,
      signerContextHash: currentProfile.signerContextHash,
      evidenceHash: 'f'.repeat(64),
      lastReadAt: at('13:30'),
      marginMs: 60_000,
    },
    evaluatedAt: at('13:00'),
  } satisfies Input;
}

describe('Historical source read window', () => {
  it.each(['OMITTED', 'STANDARD'])(
    'assesses a window for %s storage with direct S3 accreditation and grants no permission',
    async (storageClass) => {
      const input = await setup({ storageClass });
      const before = structuredClone(input);
      const result = evaluateItemSourceReadWindow(input);
      const { assessmentHash, ...definition } = result;
      expect(definition).toMatchObject({
        assessment: 'WINDOW_FITS',
        profileObservationHash:
          input.observation.profileObservation.observationHash,
        attemptDefinitionHash: input.attempt.definitionHash,
        accreditationEvidenceHash: input.accreditation.evidenceHash,
        readBoundEvidenceHash: input.readBound.evidenceHash,
        limitAt: input.accreditation.validUntil,
        reservation: 'OBSERVED_ONLY',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      expect(assessmentHash).toBe(archiveHash(definition));
      expect(Object.isFrozen(result)).toBe(true);
      expect(input).toEqual(before);
    },
  );

  it.each(['fixedUntil', 'profileUntil', 'accreditedUntil'] as const)(
    'uses %s when it is earliest and requires strict margin before the limit',
    async (key) => {
      const limitAt = at('13:31');
      const input = await setup({
        fixedUntil: at('16:00'),
        profileUntil: at('16:00'),
        accreditedUntil: at('16:00'),
        [key]: limitAt,
      });
      expect(() => evaluateItemSourceReadWindow(input)).toThrow();
      expect(
        evaluateItemSourceReadWindow({
          ...input,
          readBound: { ...input.readBound, marginMs: 59_999 },
        }).limitAt,
      ).toBe(limitAt);
    },
  );

  it.each([
    ['missing accreditation', { accreditation: undefined }],
    ['missing last-read bound', { readBound: undefined }],
    ['missing current profile', { currentProfile: null }],
    ['another bucket owner', { expectedBucketOwner: '000000000001' }],
    ['clock before observation', { evaluatedAt: at('12:00') }],
    ['clock before accreditation', { evaluatedAt: at('12:30') }],
    ['clock at last read', { evaluatedAt: at('13:30') }],
    ['noncanonical clock', { evaluatedAt: '2026-11-08T13:00:00Z' }],
  ] as const)('blocks %s', async (_, patch) => {
    const input = await setup();
    expect(() =>
      evaluateItemSourceReadWindow({ ...input, ...patch }),
    ).toThrow();
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER])(
    'blocks a missing, invalid or oversized margin of %s ms',
    async (marginMs) => {
      const input = await setup();
      expect(() =>
        evaluateItemSourceReadWindow({
          ...input,
          readBound: { ...input.readBound, marginMs },
        }),
      ).toThrow();
    },
  );

  it('rejects stale profile state, a mismatched accreditation and a bound for another attempt or signer', async () => {
    const input = await setup();
    const changes: Partial<Input>[] = [
      { currentProfile: { ...input.currentProfile, state: 'INVALIDATED' } },
      {
        accreditation: {
          ...input.accreditation,
          profileDefinitionHash: '0'.repeat(64),
        },
      },
      {
        readBound: {
          ...input.readBound,
          attemptDefinitionHash: '0'.repeat(64),
        },
      },
      { readBound: { ...input.readBound, signerContextHash: '0'.repeat(64) } },
      { readBound: { ...input.readBound, lastReadAt: '' } },
      { accreditation: { ...input.accreditation, validUntil: '' } },
    ];
    for (const change of changes)
      expect(() =>
        evaluateItemSourceReadWindow({ ...input, ...change }),
      ).toThrow();
  });

  it('rejects a coherently hashed bound to staging or a different intent', async () => {
    const input = await setup();
    const { definitionHash: oldHash, ...definition } = input.attempt;
    for (const change of [
      { kind: 'RECIPIENT_STAGING' as const },
      { copyIntentId: '00000000-0000-4000-8000-000000000002' },
    ]) {
      const replacement = { ...definition, ...change };
      const definitionHash = archiveHash(replacement);
      expect(definitionHash).not.toBe(oldHash);
      expect(() =>
        evaluateItemSourceReadWindow({
          ...input,
          attempt: { ...replacement, definitionHash },
          readBound: {
            ...input.readBound,
            attemptDefinitionHash: definitionHash,
          },
        }),
      ).toThrow();
    }
  });
});

describe('Historical source delegation bound', () => {
  async function boundSetup() {
    const input = await setup();
    const facts = { ...input.readBound, delegateBefore: at('13:20') };
    const { attempt, currentProfile } = input;
    const signer = currentProfile.signerContextHash;
    return {
      facts,
      attempt,
      signer,
      bound: buildItemSourceDelegationBound(facts, attempt, signer),
    };
  }

  it('reconstructs the same frozen identity independently of evaluation time', async () => {
    const { facts, attempt, signer, bound } = await boundSetup();
    const { boundHash, ...definition } = bound;
    expect(definition).toEqual({
      protocol: 'ITEM_HISTORICAL_SOURCE_DELEGATION_BOUND_V1',
      ...facts,
    });
    expect(boundHash).toBe(archiveHash(definition));
    expect(Object.isFrozen(bound)).toBe(true);
    expect(
      matchItemSourceDelegationBound(
        structuredClone(bound),
        attempt,
        signer,
        boundHash,
      ),
    ).toEqual(bound);
  });

  it.each([
    { delegateBefore: at('13:19') },
    { lastReadAt: at('13:29') },
    { marginMs: 1 },
    { evidenceHash: 'b'.repeat(64) },
  ])('assigns a different identity when facts change (%j)', async (change) => {
    const { facts, attempt, signer, bound } = await boundSetup();
    const different = buildItemSourceDelegationBound(
      { ...facts, ...change },
      attempt,
      signer,
    );
    expect(different.boundHash).not.toBe(bound.boundHash);
    expect(() =>
      matchItemSourceDelegationBound(
        different,
        attempt,
        signer,
        bound.boundHash,
      ),
    ).toThrow();
  });

  it.each([
    { delegateBefore: at('13:30') },
    { delegateBefore: at('13:31') },
    { delegateBefore: '2026-11-08T13:20:00Z' },
    { lastReadAt: '2026-11-08T13:30:00Z' },
    { marginMs: 0 },
    { attemptDefinitionHash: '0'.repeat(64) },
    { signerContextHash: '0'.repeat(64) },
  ])('rejects inconsistent delegation facts (%j)', async (change) => {
    const { facts, attempt, signer } = await boundSetup();
    expect(() =>
      buildItemSourceDelegationBound({ ...facts, ...change }, attempt, signer),
    ).toThrow();
  });

  it('rejects staging and retry attempts even with recomputed definition hashes', async () => {
    const { facts, attempt, signer } = await boundSetup();
    for (const change of [
      { kind: 'RECIPIENT_STAGING' as const },
      { origin: 'SDK_RETRY' as const, ordinal: 2 },
    ]) {
      const { definitionHash: oldHash, ...definition } = attempt;
      const changed = { ...definition, ...change };
      const definitionHash = archiveHash(changed);
      expect(definitionHash).not.toBe(oldHash);
      expect(() =>
        buildItemSourceDelegationBound(
          { ...facts, attemptDefinitionHash: definitionHash },
          { ...changed, definitionHash },
          signer,
        ),
      ).toThrow();
    }
  });

  it('rejects a tampered hash or unrecognized field on the stored record', async () => {
    const { attempt, signer, bound } = await boundSetup();
    for (const row of [
      { ...bound, boundHash: '0'.repeat(64) },
      { ...bound, extra: undefined },
      { ...bound, delegateBefore: at('13:21') },
    ])
      expect(() =>
        matchItemSourceDelegationBound(row, attempt, signer, bound.boundHash),
      ).toThrow();
  });
});
