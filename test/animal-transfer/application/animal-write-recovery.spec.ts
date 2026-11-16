import { AnimalWriteRecovery } from '../../../src/context/animal-transfer/application/animal-write-recovery';
import { AnimalOwnershipRepository } from '../../../src/context/animal-transfer/domain/animal-ownership';
import { AnimalWriteRecoveryRequest } from '../../../src/context/animal-transfer/domain/animal-write-journal';

const input: AnimalWriteRecoveryRequest = {
  operationId: '123e4567-e89b-42d3-a456-426614174001',
  instanceId: '123e4567-e89b-42d3-a456-426614174002',
  requestId: '123e4567-e89b-42d3-a456-426614174003',
  operatorId: '123e4567-e89b-42d3-a456-426614174004',
  reason: 'OPERATOR_INTERVENTION',
  evidenceRef: 'incident-42',
};
describe('Explicit write recovery input', () => {
  const setup = () => {
    const recoverWriteBeforeCallback = jest
      .fn()
      .mockResolvedValue({ id: input.operationId });
    return {
      recoverWriteBeforeCallback,
      service: new AnimalWriteRecovery({
        recoverWriteBeforeCallback,
      } as unknown as AnimalOwnershipRepository),
    };
  };
  it('delegates the explicit operator request without inferring death or triggering a callback', async () => {
    const ctx = setup();
    await expect(ctx.service.recoverBeforeCallback(input)).resolves.toEqual({
      id: input.operationId,
    });
    expect(ctx.recoverWriteBeforeCallback).toHaveBeenCalledWith(input);
  });
  it.each([
    { operationId: 'invalid' },
    { instanceId: '' },
    { requestId: 'invalid' },
    { operatorId: '' },
    { reason: 'OLD_TOKEN' },
    { evidenceRef: '' },
    { evidenceRef: ' padded ' },
    { evidenceRef: 'line\n' },
    { evidenceRef: 'x'.repeat(201) },
    { evidenceRef: 'https://storage.example/object?signature=secret' },
    { evidenceRef: 'signed-url?signature=secret' },
    { evidenceRef: 'clinical free text' },
  ])('rejects incomplete or implicit intervention %j', async (change) => {
    const ctx = setup();
    await expect(
      ctx.service.recoverBeforeCallback({
        ...input,
        ...change,
      } as AnimalWriteRecoveryRequest),
    ).rejects.toThrow('Invalid explicit');
    expect(ctx.recoverWriteBeforeCallback).not.toHaveBeenCalled();
  });
});
