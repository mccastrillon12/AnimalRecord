import { archiveHash } from '../../../src/context/animal-transfer/domain/ownership-archive';
import {
  archiveDefinitionOnly,
  archiveReservationEpoch,
  buildArchiveReservation,
} from '../../../src/context/animal-transfer/domain/ownership-archive-reservation';
import {
  historyArchive,
  historyClone as clone,
} from '../fixtures/ownership-archive-history.fixture';

describe('Immutable archive reservation binding', () => {
  it('adds operational identity without changing original definition/payload/file hashes', () => {
    const archive = historyArchive(1);
    expect(archive.definitionHash).toBe(
      archiveHash(archiveDefinitionOnly(archive)),
    );
    expect(archiveReservationEpoch(archive)).toBe(1);
    const next = buildArchiveReservation(archive, 3);
    expect(next.bindingHash).not.toBe(archive.reservation!.bindingHash);
    expect(archive.definitionHash).toBe(
      archiveHash(archiveDefinitionOnly(archive)),
    );
    expect(next).not.toHaveProperty('lockedAt');
  });
  it.each([
    'missing',
    'epoch',
    'protocol',
    'hash',
    'scope',
    'definition',
    'extra',
  ])('rejects %s rather than adopting current control metadata', (problem) => {
    const archive = clone(historyArchive(1));
    if (problem === 'missing') delete archive.reservation;
    if (problem === 'epoch') archive.reservation!.epoch = 3;
    if (problem === 'protocol')
      Object.assign(archive.reservation!, { protocol: 'unknown' });
    if (problem === 'hash') archive.reservation!.bindingHash = 'c'.repeat(64);
    if (problem === 'scope')
      archive.recipientId = historyArchive(2).recipientId;
    if (problem === 'definition') archive.definitionHash = 'c'.repeat(64);
    if (problem === 'extra')
      Object.assign(archive.reservation!, { permitted: true });
    expect(() => archiveReservationEpoch(archive)).toThrow();
  });
  it.each([undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'requires explicit supported acquired epoch %s',
    (epoch) => {
      expect(() =>
        buildArchiveReservation(historyArchive(1), epoch as number),
      ).toThrow();
    },
  );
});
