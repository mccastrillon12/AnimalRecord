import { InitialTransferItemProgress } from '../../../src/context/animal-transfer/application/initial-transfer-item-progress';
import type {
  InitialItemProgressPoint,
  ItemCaptureInput,
  ItemCaptureProgress,
} from '../../../src/context/animal-transfer/domain/transfer-item-capture';
import { promotionTestId as id } from '../fixtures/media-promotion.fixture';

const identity = { actorId: id(1), transferId: id(2), itemId: id(3) };

function point(revision: number, stage: ItemCaptureProgress['stage']) {
  const selector: ItemCaptureInput = {
    ...identity,
    decisionOperationId: id(4),
    expectedRequestVersion: 2,
    expectedCaptureRevision: revision,
  };
  return {
    state: 'PROCESSING',
    selector,
    progress: {
      transferId: selector.transferId,
      itemId: selector.itemId,
      requestVersion: 2,
      captureRevision: revision,
      phase: stage === 'COLLECTING' ? 'DIARY' : 'COMPLETE',
      entryCount: 1,
      stage,
      reservation: 'OBSERVED_ONLY',
      stableCut: 'NOT_ASSESSED',
      businessCommit: 'NOT_AUTHORIZED',
    },
  } as const satisfies InitialItemProgressPoint;
}

function fixture() {
  const readInitialProgress = jest.fn<Promise<InitialItemProgressPoint>, []>();
  const advance = jest.fn();
  const manifest = {
    transferId: identity.transferId,
    itemId: identity.itemId,
    archiveId: id(5),
    manifestHash: 'f'.repeat(64),
    observedSealHash: 'a'.repeat(64),
    entryCount: 1,
    fileCount: 1,
    replayed: true,
    reservation: 'FENCED_AT_PREPARATION',
    provenance: 'NOT_ASSESSED',
    stableCut: 'NOT_ASSESSED',
    retention: 'NOT_ASSESSED',
    copyDispatch: 'NOT_AUTHORIZED',
    businessCommit: 'NOT_AUTHORIZED',
  } as const;
  const prepareFromCapture = jest.fn().mockResolvedValue(manifest);
  const prepare = jest.fn().mockResolvedValue(null);
  const readStableCutScope = jest.fn();
  const prepareFromFinalVersions = jest.fn();
  const registerCut = jest.fn();
  const commit = jest.fn();
  const runner = new InitialTransferItemProgress(
    { readInitialProgress, readStableCutScope },
    { advance },
    { prepareFromCapture },
    { prepare },
    { prepareFromFinalVersions },
    registerCut,
    { readResumePoint: jest.fn(), commit },
  );
  return {
    runner,
    readInitialProgress,
    advance,
    manifest,
    prepareFromCapture,
    prepare,
    readStableCutScope,
    prepareFromFinalVersions,
    registerCut,
    commit,
  };
}

it('reloads the saved selector after each captured page and waits for copy reconciliation', async () => {
  const f = fixture();
  const original = point(0, 'COLLECTING');
  const next = point(1, 'COLLECTING');
  const sealed = point(1, 'CAPTURE_SEALED');
  f.readInitialProgress
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce(next)
    .mockResolvedValueOnce(sealed);
  f.advance
    .mockResolvedValueOnce(next.progress)
    .mockResolvedValueOnce(sealed.progress);

  await f.runner.resume(identity);

  expect(f.readInitialProgress).toHaveBeenCalledTimes(3);
  expect(f.advance.mock.calls).toEqual([[original.selector], [next.selector]]);
  expect(f.prepareFromCapture).toHaveBeenCalledWith(sealed.selector);
  expect(f.prepare).toHaveBeenCalledWith(sealed.selector, f.manifest);
  expect(f.prepareFromFinalVersions).not.toHaveBeenCalled();
  expect(f.readStableCutScope).not.toHaveBeenCalled();
  expect(f.registerCut).not.toHaveBeenCalled();
  expect(f.commit).not.toHaveBeenCalled();
});

it('returns for an unchanged capture checkpoint without spinning or preparing copies', async () => {
  const f = fixture();
  const original = point(3, 'COLLECTING');
  f.readInitialProgress.mockResolvedValue(original);
  f.advance.mockResolvedValue(original.progress);

  await f.runner.resume(identity);

  expect(f.advance).toHaveBeenCalledTimes(1);
  expect(f.prepareFromCapture).not.toHaveBeenCalled();
});
