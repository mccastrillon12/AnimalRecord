import { InitialTransferAcceptanceResumer } from '../../../src/app/animal-transfer/initial-transfer-acceptance-resumer';

it('continues past an unavailable item, advances the cursor, wraps, and stops on shutdown', async () => {
  jest.useFakeTimers();
  const item = {
    actorId: 'recipient',
    transferId: 'transfer',
    itemId: 'item-one',
  };
  const next = { ...item, itemId: 'item-two' };
  const listInitialProcessingItems = jest
    .fn()
    .mockResolvedValueOnce({ after: next.itemId, items: [item, next] })
    .mockResolvedValue({ after: undefined, items: [] });
  const resume = jest
    .fn()
    .mockRejectedValueOnce(new Error('evidence delayed'))
    .mockResolvedValue(undefined);
  const resumer = new InitialTransferAcceptanceResumer(
    { listInitialProcessingItems },
    { resume },
  );
  try {
    resumer.onModuleInit();
    for (let tick = 0; tick < 3; tick++)
      await jest.advanceTimersByTimeAsync(5_000);
    expect(listInitialProcessingItems.mock.calls).toEqual([
      [undefined],
      [next.itemId],
      [undefined],
    ]);
    expect(resume.mock.calls).toEqual([[item], [next]]);
    await resumer.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(listInitialProcessingItems).toHaveBeenCalledTimes(3);
  } finally {
    await resumer.onModuleDestroy();
    jest.useRealTimers();
  }
});
