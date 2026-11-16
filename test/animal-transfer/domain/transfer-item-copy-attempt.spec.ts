import {
  buildItemCopyAttemptIntent,
  ItemCopyAttemptIntent,
  ItemCopyAttemptInput,
} from '../../../src/context/animal-transfer/domain/transfer-item-copy-attempt';
import { ItemArchiveCopyIntent } from '../../../src/context/animal-transfer/domain/transfer-item-copy-intent';
import {
  buildStagingCopyPreparation,
  ItemHistoricalByteObservation,
} from '../../../src/context/animal-transfer/domain/transfer-item-historical-observation';
import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import { historicalCopyPreparationFixture } from '../fixtures/historical-copy-preparation.fixture';

async function fixture() {
  const f = await historicalCopyPreparationFixture();
  await f.service.prepareHistoricalCopy(f.input);
  const context = await f.store.readHistoricalCopy(f.input),
    historical = context.file.historicalCopyIntent!;
  // Synthetic supplied metadata for a pure contract, not durable byte/authentication evidence.
  const payload = {
    intentId: historical.id,
    intentDefinitionHash: historical.definitionHash,
    bucket: historical.bucket,
    key: historical.destination.key,
    revision: { etag: 'historical', size: 12, versionId: 'historical-v1' },
    sha256: context.sourceSha256,
  };
  const observed: ItemHistoricalByteObservation = {
    protocol: 'ITEM_HISTORICAL_BYTE_OBSERVATION_V1',
    binding: historical.binding,
    observation: payload,
    observationHash: archiveHash(payload),
    bytes: 'MATCH',
    reservation: 'OBSERVED_ONLY',
    provenance: 'NOT_ASSESSED',
    stableCut: 'NOT_ASSESSED',
    retention: 'NOT_ASSESSED',
    copyDispatch: 'NOT_AUTHORIZED',
    businessCommit: 'NOT_AUTHORIZED',
  };
  const pair = buildStagingCopyPreparation(context, observed);
  context.file.historicalByteObservation = pair.observation;
  context.file.stagingCopyIntent = pair.intent;
  const initial: ItemCopyAttemptInput = {
    attemptId: f.id(900),
    dispatcherInstanceId: f.id(901),
    origin: 'INITIAL',
  };
  const prior = buildItemCopyAttemptIntent(context, 'HISTORICAL', initial);
  const retry: ItemCopyAttemptInput = {
    attemptId: f.id(902),
    dispatcherInstanceId: f.id(901),
    origin: 'SDK_RETRY',
    previous: {
      attempt: prior,
      authorization: {
        attemptId: prior.id,
        attemptDefinitionHash: prior.definitionHash,
        authorizationId: f.id(903),
      },
    },
  };
  return { ...f, context, historical, initial, prior, retry };
}
function rehash(raw: ItemCopyAttemptIntent) {
  const { definitionHash, ...definition } = raw;
  void definitionHash;
  (raw as unknown as { definitionHash: string }).definitionHash =
    archiveHash(definition);
}

describe('Physical copy attempt definitions only, no store, grant, SDK or I/O', () => {
  it.each(['HISTORICAL', 'RECIPIENT_STAGING'] as const)(
    'binds a fresh %s attempt to the original logical definition without granting dispatch',
    async (kind) => {
      const f = await fixture(),
        before = structuredClone(f.context),
        writes = f.state.writes;
      const result = buildItemCopyAttemptIntent(f.context, kind, f.initial);
      const logical =
        kind === 'HISTORICAL'
          ? f.historical
          : f.context.file.stagingCopyIntent!;
      expect(result).toMatchObject({
        protocol: 'ITEM_COPY_ATTEMPT_INTENT_V1',
        id: f.initial.attemptId,
        ordinal: 1,
        origin: 'INITIAL',
        dispatcherInstanceId: f.initial.dispatcherInstanceId,
        copyIntentId: logical.id,
        copyIntentDefinitionHash: logical.definitionHash,
        kind,
        binding: logical.binding,
        reservation: 'OBSERVED_ONLY',
        stableCut: 'NOT_ASSESSED',
        retention: 'NOT_ASSESSED',
        copyDispatch: 'NOT_AUTHORIZED',
        businessCommit: 'NOT_AUTHORIZED',
      });
      const { definitionHash, ...definition } = result;
      expect(definitionHash).toBe(archiveHash(definition));
      expect(result.previous).toBeUndefined();
      expect(buildItemCopyAttemptIntent(f.context, kind, f.initial)).toEqual(
        result,
      );
      expect(f.context).toEqual(before);
      expect(f.state.writes).toBe(writes);
      expect(Object.isFrozen(result.binding.observedSeal)).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(result).not.toHaveProperty('authorizationId');
    },
  );
  it.each(['SDK_RETRY', 'APPLICATION_RETRY'] as const)(
    'gives %s a fresh identity and a declared predecessor reference only',
    async (origin) => {
      const f = await fixture();
      const result = buildItemCopyAttemptIntent(f.context, 'HISTORICAL', {
        ...f.retry,
        origin,
      });
      expect(result).toMatchObject({
        id: f.retry.attemptId,
        ordinal: 2,
        origin,
        previous: f.retry.previous!.authorization,
        copyDispatch: 'NOT_AUTHORIZED',
      });
      expect(result.definitionHash).not.toBe(f.prior.definitionHash);
      expect(Object.isFrozen(result.previous)).toBe(true);
      const third = buildItemCopyAttemptIntent(f.context, 'HISTORICAL', {
        attemptId: f.id(904),
        dispatcherInstanceId: f.id(905),
        origin: 'APPLICATION_RETRY',
        previous: {
          attempt: result,
          authorization: {
            attemptId: result.id,
            attemptDefinitionHash: result.definitionHash,
            authorizationId: f.id(906),
          },
        },
      });
      expect(third.ordinal).toBe(3);
      expect(third.copyDispatch).toBe('NOT_AUTHORIZED');
      expect(third.previous).not.toHaveProperty('attempt'); // Flat references, not a recursively growing aggregate.
    },
  );
  it.each([
    'attemptUuid',
    'dispatcherUuid',
    'uppercase',
    'origin',
    'kind',
    'extra',
    'ordinal',
    'initialWithPrevious',
    'retryWithoutPrevious',
  ])(
    'rejects malformed %s input before producing a descriptor',
    async (kind) => {
      const f = await fixture(),
        input = { ...f.initial } as unknown as Record<string, unknown>;
      if (kind === 'attemptUuid') input.attemptId = 'not-uuid';
      if (kind === 'dispatcherUuid') input.dispatcherInstanceId = 'not-uuid';
      if (kind === 'uppercase')
        input.attemptId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
      if (kind === 'origin') input.origin = 'TIMEOUT_RETRY';
      if (kind === 'extra') input.copyDispatch = 'AUTHORIZED';
      if (kind === 'ordinal') input.ordinal = 4;
      if (kind === 'initialWithPrevious') input.previous = f.retry.previous;
      if (kind === 'retryWithoutPrevious') input.origin = 'SDK_RETRY';
      expect(() =>
        buildItemCopyAttemptIntent(
          f.context,
          kind === 'kind' ? ('FINAL' as never) : 'HISTORICAL',
          input as unknown as ItemCopyAttemptInput,
        ),
      ).toThrow();
    },
  );
  it.each([
    'id',
    'hash',
    'binding',
    'protocol',
    'permission',
    'ordinal',
    'extra',
  ])(
    'rejects a changed previous %s even with a recomputed descriptor hash',
    async (kind) => {
      const f = await fixture(),
        input = structuredClone(f.retry),
        attempt = input.previous!.attempt;
      const raw = attempt as unknown as Record<string, unknown>;
      if (kind === 'id') raw.copyIntentId = 'b'.repeat(64);
      if (kind === 'hash') raw.copyIntentDefinitionHash = 'b'.repeat(64);
      if (kind === 'binding')
        (raw.binding as Record<string, unknown>).itemId = f.id(90);
      if (kind === 'protocol') raw.protocol = 'MEDIA_PROMOTION_EFFECT_MODEL_V1';
      if (kind === 'permission') raw.copyDispatch = 'AUTHORIZED';
      if (kind === 'ordinal') raw.ordinal = 2;
      if (kind === 'extra') raw.remoteClosed = true;
      rehash(attempt);
      (
        input.previous!.authorization as { attemptDefinitionHash: string }
      ).attemptDefinitionHash = attempt.definitionHash;
      expect(() =>
        buildItemCopyAttemptIntent(f.context, 'HISTORICAL', input),
      ).toThrow();
    },
  );
  it.each([
    'attempt',
    'hash',
    'authorizationUuid',
    'authorizationAlias',
    'duplicateAttempt',
    'reuseAuthorization',
    'extra',
  ])('rejects an inconsistent %s predecessor reference', async (kind) => {
    const f = await fixture(),
      input = structuredClone(f.retry),
      raw = input as unknown as Record<string, unknown>;
    const auth = input.previous!.authorization as unknown as Record<
      string,
      unknown
    >;
    if (kind === 'attempt') auth.attemptId = f.id(910);
    if (kind === 'hash') auth.attemptDefinitionHash = 'b'.repeat(64);
    if (kind === 'authorizationUuid') auth.authorizationId = 'invalid';
    if (kind === 'authorizationAlias') auth.authorizationId = auth.attemptId;
    if (kind === 'duplicateAttempt') raw.attemptId = f.prior.id;
    if (kind === 'reuseAuthorization') raw.attemptId = auth.authorizationId;
    if (kind === 'extra') auth.acknowledged = true;
    expect(() =>
      buildItemCopyAttemptIntent(f.context, 'HISTORICAL', input),
    ).toThrow();
  });
  it.each([
    'missingHistorical',
    'changedHistorical',
    'missingStaging',
    'changedStaging',
    'missingObservation',
  ])('does not fabricate or adopt %s logical preparation', async (kind) => {
    const f = await fixture();
    if (kind === 'missingHistorical')
      delete f.context.file.historicalCopyIntent;
    if (kind === 'changedHistorical')
      f.context.file.historicalCopyIntent = {} as ItemArchiveCopyIntent;
    if (kind === 'missingStaging') delete f.context.file.stagingCopyIntent;
    if (kind === 'changedStaging')
      f.context.file.stagingCopyIntent = {} as ItemArchiveCopyIntent;
    if (kind === 'missingObservation')
      delete f.context.file.historicalByteObservation;
    expect(() =>
      buildItemCopyAttemptIntent(f.context, 'RECIPIENT_STAGING', f.initial),
    ).toThrow();
  });
  it('refuses to retarget retries across stages or a changed bucket/digest/reservation', async () => {
    const f = await fixture();
    expect(() =>
      buildItemCopyAttemptIntent(f.context, 'RECIPIENT_STAGING', f.retry),
    ).toThrow();
    for (const key of ['bucket', 'sourceSha256'] as const) {
      const context = {
        ...structuredClone(f.context),
        [key]: key === 'bucket' ? 'other-bucket' : 'b'.repeat(64),
      };
      expect(() =>
        buildItemCopyAttemptIntent(context, 'HISTORICAL', f.retry),
      ).toThrow();
    }
    f.context.snapshot.control!.reservationEpoch = 3;
    expect(() =>
      buildItemCopyAttemptIntent(f.context, 'HISTORICAL', f.retry),
    ).toThrow();
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    'refuses an invalid/exhausted technical ordinal %s without recycling it',
    async (ordinal) => {
      const f = await fixture(),
        second = structuredClone(
          buildItemCopyAttemptIntent(f.context, 'HISTORICAL', f.retry),
        );
      (second as unknown as { ordinal: number }).ordinal = ordinal;
      rehash(second);
      expect(() =>
        buildItemCopyAttemptIntent(f.context, 'HISTORICAL', {
          attemptId: f.id(910),
          dispatcherInstanceId: f.id(901),
          origin: 'SDK_RETRY',
          previous: {
            attempt: second,
            authorization: {
              attemptId: second.id,
              attemptDefinitionHash: second.definitionHash,
              authorizationId: f.id(911),
            },
          },
        }),
      ).toThrow();
    },
  );
  it('detaches current binding and predecessor references from later caller mutations', async () => {
    const f = await fixture(),
      input = structuredClone(f.retry);
    const result = buildItemCopyAttemptIntent(f.context, 'HISTORICAL', input),
      expected = structuredClone(result);
    (
      input.previous!.authorization as { authorizationId: string }
    ).authorizationId = f.id(990);
    f.context.file.historicalCopyIntent = {} as ItemArchiveCopyIntent;
    f.context.snapshot.archive!.definitionHash = 'b'.repeat(64);
    expect(result).toEqual(expected);
  });
});
