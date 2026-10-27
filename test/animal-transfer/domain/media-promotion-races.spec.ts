import { ConflictError } from '../../../src/context/shared/domain/errors/ConflictError';
import { InvalidArgumentError } from '../../../src/context/shared/domain/errors/InvalidArgumentError';
import {
  MediaPromotionCommand,
  MediaPromotionModel,
  advanceMediaPromotion,
  summarizeMediaPromotion,
} from '../../../src/context/animal-media/domain/media-promotion-machine';
import { promotionFixture } from '../fixtures/media-promotion.fixture';

/** In-memory linearization specification, not a persistence/transport adapter. */
class ModelStore {
  constructor(public current: MediaPromotionModel) {}
  commit(snapshot: MediaPromotionModel, command: MediaPromotionCommand) {
    this.current = advanceMediaPromotion(
      this.current,
      snapshot.revision,
      command,
    );
    return structuredClone(this.current);
  }
}

function* permutations<T>(values: T[]): Generator<T[]> {
  if (!values.length) {
    yield [];
    return;
  }
  for (let i = 0; i < values.length; i++)
    for (const tail of permutations(
      values.filter((_value, index) => index !== i),
    ))
      yield [values[i], ...tail];
}

describe('Promotion authorization and revocation race model', () => {
  const schedules = [
    ...permutations(['read-authorizer', 'authorize', 'read-revoker', 'revoke']),
  ].filter(
    (s) =>
      s.indexOf('read-authorizer') < s.indexOf('authorize') &&
      s.indexOf('read-revoker') < s.indexOf('revoke'),
  );
  it.each(schedules.map((s) => [s.join(' / '), s] as const))(
    'linearizes both contenders: %s',
    (_name, schedule) => {
      const s = promotionFixture();
      const store = new ModelStore(s.intended);
      let writer = s.initial,
        revoker = s.initial,
        grantAcknowledged = false;
      const conflicts: string[] = [];
      for (const action of schedule) {
        if (action === 'read-authorizer')
          writer = structuredClone(store.current);
        if (action === 'read-revoker') revoker = structuredClone(store.current);
        if (action === 'authorize' || action === 'revoke') {
          try {
            store.commit(
              action === 'authorize' ? writer : revoker,
              action === 'authorize' ? s.authorize : s.revoke,
            );
            if (action === 'authorize') grantAcknowledged = true;
          } catch (error) {
            expect(error).toBeInstanceOf(ConflictError);
            conflicts.push(action);
          }
        }
      }
      // A stale revoker may retry only by rereading, retaining any grant that won.
      if (conflicts.includes('revoke'))
        store.commit(structuredClone(store.current), s.revoke);
      expect(store.current.gate.state).toBe('REVOKED');
      const summary = summarizeMediaPromotion(store.current);
      expect(summary.authorizedAttemptIds).toEqual(
        grantAcknowledged ? [s.attemptId] : [],
      );
      expect(summary.dispatchPrecludedAttemptIds).toEqual(
        grantAcknowledged ? [] : [s.attemptId],
      );
      expect(() =>
        store.commit(structuredClone(store.current), s.authorize),
      ).toThrow(ConflictError);
      expect(() =>
        store.commit(structuredClone(store.current), s.intention),
      ).toThrow(ConflictError);
      expect(() =>
        store.commit(structuredClone(store.current), {
          ...s.declaration,
          effectId: s.id(50),
        }),
      ).toThrow(ConflictError);
    },
  );

  it('allows only one grant when two instances authorize the same intent from one snapshot', () => {
    const s = promotionFixture();
    const store = new ModelStore(s.intended),
      snapshot = structuredClone(store.current);
    store.commit(snapshot, s.authorize);
    expect(() =>
      store.commit(snapshot, { ...s.authorize, authorizationId: s.id(20) }),
    ).toThrow();
    expect(() =>
      store.commit(structuredClone(store.current), {
        ...s.authorize,
        authorizationId: s.id(20),
      }),
    ).toThrow();
    expect(summarizeMediaPromotion(store.current).authorizedAttemptIds).toEqual(
      [s.attemptId],
    );
  });

  it('retains a grant whose commit reply was lost, even without dispatch or subsequent evidence', () => {
    const s = promotionFixture(),
      store = new ModelStore(s.intended);
    const dispatch = jest.fn();
    const snapshot = structuredClone(store.current);
    const authorizeWithLostReply = () => {
      store.commit(snapshot, s.authorize);
      throw new Error('application reply lost');
    };
    expect(authorizeWithLostReply).toThrow('application reply lost');
    // No recognized NEW grant, so this conforming simulated caller does not send.
    expect(dispatch).not.toHaveBeenCalled();
    store.commit(structuredClone(store.current), s.revoke);
    expect(summarizeMediaPromotion(store.current).authorizedAttemptIds).toEqual(
      [s.attemptId],
    );
    expect(store.current.effects[0].attempts[0].responses).toEqual([]);
    expect(() => store.commit(snapshot, s.authorize)).toThrow();
    expect(() =>
      store.commit(structuredClone(store.current), s.authorize),
    ).toThrow();
  });

  it('exposes the unavoidable granted-before-revoke/send-after-revoke gap without claiming remote closure', () => {
    const s = promotionFixture(),
      store = new ModelStore(s.intended);
    const grant = store.commit(structuredClone(store.current), s.authorize);
    store.commit(structuredClone(store.current), s.revoke);
    // A paused dispatcher already has a recognized grant. No Mongo flag fences AWS.
    const possibleLateSend =
      grant.effects[0].attempts[0].authorizationId !== undefined;
    expect(possibleLateSend).toBe(true);
    expect(summarizeMediaPromotion(store.current)).toMatchObject({
      authorizedAttemptIds: [s.attemptId],
      dispatchPrecludedAttemptIds: [],
      remoteEffects: 'NOT_ASSESSED',
    });
  });

  it('a lost revocation reply does not reopen the gate or allow an SDK retry', () => {
    const s = promotionFixture(),
      store = new ModelStore(s.intended);
    const snapshot = structuredClone(store.current);
    store.commit(snapshot, s.revoke); // Reply is discarded by the simulated caller.
    expect(() => store.commit(snapshot, s.authorize)).toThrow();
    expect(() =>
      store.commit(structuredClone(store.current), {
        ...s.intention,
        attemptId: s.id(20),
        origin: 'SDK_RETRY',
        previousAttemptId: s.attemptId,
      }),
    ).toThrow();
    expect(() =>
      store.commit(structuredClone(store.current), s.revoke),
    ).toThrow();
    expect(
      summarizeMediaPromotion(store.current).dispatchPrecludedAttemptIds,
    ).toEqual([s.attemptId]);
  });

  it('enumerates 5040 orders across two effects, SDK retry, revocation and late evidence', () => {
    const s = promotionFixture('ATTACHMENT_CONFIRM');
    let base = structuredClone(s.intended);
    const uploadB = structuredClone(s.upload);
    uploadB.id = s.id(50);
    uploadB.stagingKey = uploadB.stagingKey.replace(s.upload.id, uploadB.id);
    uploadB.finalKey = uploadB.finalKey.replace(s.id(9), s.id(51));
    base = advanceMediaPromotion(base, base.revision, {
      type: 'DECLARE_EFFECT',
      bucket: 'animalrecord-test-media',
      effectId: s.id(52),
      upload: uploadB,
    });
    base = advanceMediaPromotion(base, base.revision, {
      ...s.intention,
      effectId: s.id(52),
      attemptId: s.id(53),
    });
    const commands: MediaPromotionCommand[] = [
      s.authorize,
      {
        ...s.authorize,
        effectId: s.id(52),
        attemptId: s.id(53),
        authorizationId: s.id(54),
      },
      s.revoke,
      {
        ...s.intention,
        attemptId: s.id(55),
        origin: 'SDK_RETRY',
        previousAttemptId: s.attemptId,
      },
      { ...s.authorize, attemptId: s.id(55), authorizationId: s.id(56) },
      {
        type: 'RECORD_RESPONSE',
        effectId: s.effectId,
        attemptId: s.attemptId,
        responseId: s.id(57),
        outcome: 'UNKNOWN',
        evidenceRef: 'response:lost',
      },
      {
        type: 'OBSERVE_DESTINATION',
        effectId: s.effectId,
        observation: {
          id: s.id(58),
          finding: 'ABSENT',
          evidenceRef: 'read:absent',
        },
      },
    ];
    let explored = 0,
      grantedRetry = 0,
      blockedRetry = 0,
      lateEvidence = 0;
    for (const schedule of permutations(commands)) {
      let model = structuredClone(base);
      const granted = new Set<string>();
      let revoked = false;
      for (const command of schedule) {
        const before = structuredClone(model);
        try {
          model = advanceMediaPromotion(model, model.revision, command);
          if (command.type === 'AUTHORIZE_ATTEMPT') {
            expect(revoked).toBe(false);
            granted.add(command.attemptId);
            if (command.attemptId === s.id(55)) grantedRetry++;
          }
          if (revoked) lateEvidence++;
          if (command.type === 'REVOKE') revoked = true;
        } catch (error) {
          expect(
            error instanceof ConflictError ||
              error instanceof InvalidArgumentError,
          ).toBe(true);
          if (
            command.type === 'AUTHORIZE_ATTEMPT' &&
            command.attemptId === s.id(55)
          )
            blockedRetry++;
          expect(model).toEqual(before);
        }
        expect(
          new Set(summarizeMediaPromotion(model).authorizedAttemptIds),
        ).toEqual(granted);
      }
      expect(model.gate.state).toBe('REVOKED');
      expect(summarizeMediaPromotion(model).remoteEffects).toBe('NOT_ASSESSED');
      explored++;
    }
    expect(explored).toBe(5040);
    expect(grantedRetry).toBeGreaterThan(0);
    expect(blockedRetry).toBeGreaterThan(0);
    expect(lateEvidence).toBeGreaterThan(0);
    expect(
      base.effects.every((effect) =>
        effect.attempts.every((attempt) => !attempt.authorizationId),
      ),
    ).toBe(true);
  }, 30000);
});
