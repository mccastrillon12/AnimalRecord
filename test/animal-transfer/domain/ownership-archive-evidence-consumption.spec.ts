import {
  archiveEvidenceHash,
  assertArchivePipelineFence,
  buildArchivePipelineFence,
  validateEvidenceConsumptionRequest,
} from '../../../src/context/animal-transfer/domain/ownership-archive-evidence-consumption';
import {
  advanceS3Observation,
  s3ObservationMetadataHash,
} from '../../../src/context/animal-transfer/domain/ownership-archive-s3-observation';
import { s3ObservationFixture } from '../fixtures/ownership-archive-s3-observation.fixture';
import { historyUuid } from '../fixtures/ownership-archive-history.fixture';

const complete = () => {
  const s = s3ObservationFixture();
  s.run.reservationEpoch = 1;
  s.run.pipelineFence = buildArchivePipelineFence(undefined, 2);
  // Explicit construction of new evidence, never a production retrofit.
  s.run.s3Observation!.metadataHash = s3ObservationMetadataHash(s.run);
  s.run.s3Observation = advanceS3Observation(s.run, s.items, s.receipts, 20);
  return s;
};
describe('Evidence comparison digest and pipeline pin', () => {
  it('hashes stable observations and excludes Mongo implementation fields', () => {
    const s = complete();
    const original = archiveEvidenceHash(s.run);
    Object.assign(s.run, { _id: 'mongo', __v: 4 });
    expect(archiveEvidenceHash(s.run)).toBe(original);
    s.run.revision++;
    expect(archiveEvidenceHash(s.run)).not.toBe(original);
    Object.assign(s.run, { consumption: {} });
    expect(() => archiveEvidenceHash(s.run)).toThrow();
  });
  it('compares explicit observed data rather than Mongo fields or permissions', () => {
    const s = s3ObservationFixture();
    s.run.s3Observation = advanceS3Observation(s.run, s.items, s.receipts, 20);
    s.run.pipelineFence = buildArchivePipelineFence(undefined, 2);
    // Fixture rebuild preserves S3 binding for the now explicit epoch.
    s.run.reservationEpoch = 1;
    expect(() => archiveEvidenceHash(s.run)).toThrow(); // A newly supplied epoch cannot adopt an old S3 hash.
  });
  it.each([NaN, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid pin %s',
    (value) => {
      expect(() => buildArchivePipelineFence(value, undefined)).toThrow();
    },
  );
  it('distinguishes missing from zero and rejects extra or foreign protocol metadata', () => {
    expect(buildArchivePipelineFence(undefined, undefined)).not.toEqual(
      buildArchivePipelineFence(0, 0),
    );
    const pin = buildArchivePipelineFence(1, 2);
    expect(() => assertArchivePipelineFence(pin)).not.toThrow();
    expect(() =>
      assertArchivePipelineFence({ ...pin, protocol: 'wrong' } as never),
    ).toThrow();
    expect(() =>
      assertArchivePipelineFence({ ...pin, unexpected: true } as never),
    ).toThrow();
  });
  it('validates IDs, revision and strict digest before persistence', () => {
    const request = {
      id: historyUuid(1),
      runId: historyUuid(2),
      archiveId: historyUuid(3),
      expectedRunRevision: 4,
      expectedEvidenceHash: 'a'.repeat(64),
    };
    expect(() => validateEvidenceConsumptionRequest(request)).not.toThrow();
    expect(() =>
      validateEvidenceConsumptionRequest({
        ...request,
        expectedEvidenceHash: request.expectedEvidenceHash + '\n',
      }),
    ).toThrow();
    expect(() =>
      validateEvidenceConsumptionRequest({
        ...request,
        expectedRunRevision: -1,
      }),
    ).toThrow();
    expect(() =>
      validateEvidenceConsumptionRequest({ ...request, id: 'bad' }),
    ).toThrow();
  });
});
