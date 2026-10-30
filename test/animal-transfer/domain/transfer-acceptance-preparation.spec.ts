import {
  acceptanceSelection,
  buildAcceptanceCandidate,
} from '../../../src/context/animal-transfer/domain/transfer-acceptance-preparation';
import {
  acceptanceAt,
  acceptanceFixture,
} from '../fixtures/transfer-acceptance-preparation.fixture';
describe('Acceptance candidates are internal observations, not reservations or decisions', () => {
  it('binds complete pending selection/claims to initial-period definitions while leaving all inputs unchanged', () => {
    const f = acceptanceFixture(),
      before = structuredClone(f.snapshot);
    const result = buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt);
    expect(result).toMatchObject({
      transferId: f.input.transferId,
      actorId: f.recipientId,
      senderId: f.actorId,
      requestVersion: 1,
      decision: 'NOT_RECORDED',
      reservation: 'NOT_ACQUIRED',
      capturePreflight: 'NOT_RUN',
      stableCut: 'NOT_ASSESSED',
      businessCommit: 'NOT_AUTHORIZED',
    });
    expect(result.selected).toHaveLength(1);
    expect(result.rejectedItemIds).toEqual([f.snapshot.items[1]._id]);
    expect(result.selected[0]).toMatchObject({
      itemId: f.snapshot.items[0]._id,
      proposedReservationEpoch: 1,
      definition: {
        animalId: f.id(100),
        ownerId: f.actorId,
        recipientId: f.recipientId,
        periodId: f.id(200),
        transferId: f.input.transferId,
        ownershipVersion: 1,
      },
    });
    expect(f.snapshot).toEqual(before);
    expect(Object.isFrozen(result.selected[0].definition)).toBe(true);
    expect(result.selectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(
      /nameHistory|password|proof|token|name|code|medical/i,
    );
  });
  it('has stable identities/hash across observation times but no persisted idempotency receipt', () => {
    const f = acceptanceFixture();
    const first = buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt);
    const second = buildAcceptanceCandidate(
      f.input,
      f.snapshot,
      '2026-10-29T12:01:00.000Z',
    );
    expect(first.candidateId).toBe(second.candidateId);
    expect(first.selectionHash).toBe(second.selectionHash);
    expect(first.observedAt).not.toBe(second.observedAt);
    const changed = buildAcceptanceCandidate(
      { ...f.input, operationId: f.id(9) },
      f.snapshot,
      acceptanceAt,
    );
    expect(changed.candidateId).not.toBe(first.candidateId);
    expect(changed.selected[0].definition.id).not.toBe(
      first.selected[0].definition.id,
    );
  });
  it('does not treat an operation ID as a receipt for changed selections under the same candidate identity', () => {
    const f = acceptanceFixture(),
      first = buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt);
    const next = structuredClone(f.snapshot);
    next.animals[0].id = f.id(101);
    next.controls[0].animalId = f.id(101);
    next.periods[0] = {
      ...next.periods[0],
      animalId: f.id(101),
      id: f.id(201),
    };
    const other = buildAcceptanceCandidate(
      { ...f.input, acceptedAnimalIds: [f.id(101)] },
      next,
      acceptanceAt,
    );
    expect(other.candidateId).toBe(first.candidateId);
    expect(other.selectionHash).not.toBe(first.selectionHash);
    expect(other.decision).toBe('NOT_RECORDED');
    expect(other.reservation).toBe('NOT_ACQUIRED');
  });
  it('does not require acceptance eligibility on the unselected item merely to propose its rejection', () => {
    const f = acceptanceFixture();
    f.snapshot.items[1].expectedOwnershipVersion = 2;
    const result = buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt);
    expect(result.selected[0].definition.ownershipVersion).toBe(1);
    expect(result.rejectedItemIds).toEqual([f.snapshot.items[1]._id]);
  });
  it.each([
    'missing',
    'sender',
    'outsider',
    'version',
    'rejected',
    'dangling-decision',
  ] as const)('denies %s request state', (kind) => {
    const f = acceptanceFixture();
    if (kind === 'missing') f.snapshot.request = null;
    if (kind === 'sender') f.snapshot.request!.recipientId = f.actorId;
    if (kind === 'outsider') f.snapshot.request!.recipientId = f.id(90);
    if (kind === 'version') f.snapshot.request!.version = 2;
    if (kind === 'rejected') f.snapshot.request!.status = 'REJECTED';
    if (kind === 'dangling-decision')
      f.snapshot.request!.decisionExpectedVersion = 1;
    expect(() =>
      buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt),
    ).toThrow();
  });
  it.each([
    'missing-item',
    'duplicate-item',
    'foreign-item',
    'nonpending',
    'missing-claim',
    'extra-claim',
    'foreign-claim',
    'wrong-selection',
  ] as const)('refuses %s instead of deciding a partial stored set', (kind) => {
    const f = acceptanceFixture();
    if (kind === 'missing-item') f.snapshot.items.pop();
    if (kind === 'duplicate-item')
      f.snapshot.items[1] = structuredClone(f.snapshot.items[0]);
    if (kind === 'foreign-item') f.snapshot.items[0].expectedOwnerId = f.id(90);
    if (kind === 'nonpending') f.snapshot.items[1].status = 'REJECTED';
    if (kind === 'missing-claim') f.snapshot.claims.pop();
    if (kind === 'extra-claim')
      f.snapshot.claims.push({
        _id: f.id(900),
        transferId: f.input.transferId,
      });
    if (kind === 'foreign-claim') f.snapshot.claims[0].transferId = f.id(900);
    if (kind === 'wrong-selection')
      Object.assign(f.input, { acceptedAnimalIds: [f.id(900)] });
    expect(() =>
      buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt),
    ).toThrow();
  });
  it.each([
    'inactive',
    'owner',
    'version',
    'lock',
    'writers',
    'upload',
    'epoch',
  ] as const)('requires consistent observed eligibility: %s', (kind) => {
    const f = acceptanceFixture();
    if (kind === 'inactive') f.snapshot.animals[0].isActive = false;
    if (kind === 'owner') f.snapshot.animals[0].ownerId = f.id(90);
    if (kind === 'version') f.snapshot.controls[0].ownershipVersion = 2;
    if (kind === 'lock') f.snapshot.controls[0].lockPresent = true;
    if (kind === 'writers') f.snapshot.controls[0].writersPresent = true;
    if (kind === 'upload')
      f.snapshot.controls[0].uploadsValidUntil = '2026-10-29T12:00:00.001Z';
    if (kind === 'epoch')
      f.snapshot.controls[0].reservationEpoch = Number.MAX_SAFE_INTEGER;
    expect(() =>
      buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt),
    ).toThrow();
  });
  it.each([
    'missing',
    'later-version',
    'closed',
    'duplicate',
    'owner',
    'unknown',
  ] as const)('preserves initial-period capture guard for %s', (kind) => {
    const f = acceptanceFixture();
    if (kind === 'missing') f.snapshot.periods = [];
    if (kind === 'later-version') {
      f.snapshot.items[0].expectedOwnershipVersion = 2;
      f.snapshot.controls[0].ownershipVersion = 2;
      f.snapshot.periods[0].ownershipVersion = 2;
    }
    if (kind === 'closed')
      f.snapshot.periods.push({
        ...f.snapshot.periods[0],
        id: f.id(201),
        status: 'CLOSED',
      });
    if (kind === 'duplicate')
      f.snapshot.periods.push({ ...f.snapshot.periods[0], id: f.id(201) });
    if (kind === 'owner') f.snapshot.periods[0].ownerId = f.id(90);
    if (kind === 'unknown') f.snapshot.periods[0].status = 'UNKNOWN';
    expect(() =>
      buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt),
    ).toThrow('Initial active');
  });
  it('does not ignore pending medical work or interpret discard/FAILED as remote cancellation evidence', () => {
    const f = acceptanceFixture();
    f.snapshot.pendingMedicalAnimalIds = [f.id(100)];
    expect(() =>
      buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt),
    ).toThrow('owner must finish or discard');
    f.snapshot.pendingMedicalAnimalIds = [];
    expect(
      buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt).stableCut,
    ).toBe('NOT_ASSESSED');
  });
  it('distinguishes absent epoch from persisted zero and accepts legacy-active animals without mutating them', () => {
    const f = acceptanceFixture();
    delete f.snapshot.animals[0].isActive;
    const missing = buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt);
    f.snapshot.controls[0].reservationEpoch = 0;
    const zero = buildAcceptanceCandidate(f.input, f.snapshot, acceptanceAt);
    expect(zero.selected[0].expectedReservationEpoch).toBe(0);
    expect(zero.selected[0].proposedReservationEpoch).toBe(1);
    expect(zero.selectionHash).not.toBe(missing.selectionHash);
  });
  it('can prepare all selected definitions independent of input order, without applying rejected items', () => {
    const f = acceptanceFixture();
    const all = { ...f.input, acceptedAnimalIds: [f.id(101), f.id(100)] };
    f.snapshot.animals.push({ ...f.snapshot.animals[0], id: f.id(101) });
    f.snapshot.controls.push({
      ...f.snapshot.controls[0],
      animalId: f.id(101),
    });
    f.snapshot.periods.push({
      ...f.snapshot.periods[0],
      id: f.id(201),
      animalId: f.id(101),
    });
    const result = buildAcceptanceCandidate(all, f.snapshot, acceptanceAt);
    expect(result.selected.map((s) => s.animalId)).toEqual([
      f.id(100),
      f.id(101),
    ]);
    expect(result.rejectedItemIds).toEqual([]);
    expect(
      buildAcceptanceCandidate(
        { ...all, acceptedAnimalIds: [...all.acceptedAnimalIds].reverse() },
        f.snapshot,
        acceptanceAt,
      ).selectionHash,
    ).toBe(result.selectionHash);
  });
  it.each(
    [[], ['invalid'], ['duplicate', 'duplicate']].map((ids) => ({ ids })),
  )('refuses empty or malformed selections %j', ({ ids }) => {
    const f = acceptanceFixture();
    expect(() =>
      acceptanceSelection({ ...f.input, acceptedAnimalIds: ids }),
    ).toThrow('Invalid');
  });
});
