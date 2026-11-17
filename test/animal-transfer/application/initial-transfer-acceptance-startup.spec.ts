import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InitialTransferAcceptanceModule } from '../../../src/app/animal-transfer/initial-transfer-acceptance.module';
import { loadInitialTransferAcceptance } from '../../../src/app/animal-transfer/initial-transfer-acceptance-startup';

jest.mock(
  '../../../src/app/animal-transfer/initial-transfer-acceptance.module',
  () => ({
    InitialTransferAcceptanceModule: { forApplication: jest.fn() },
  }),
);
const forApplication = jest.spyOn(
  InitialTransferAcceptanceModule,
  'forApplication',
);

async function withConfigurationFile(
  text: string,
  use: (filename: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'animalrecord-transfer-startup-'));
  const filename = join(dir, 'acceptance.cjs');
  try {
    await writeFile(filename, text, { flag: 'wx' });
    await use(filename);
  } finally {
    await unlink(filename).catch(() => undefined);
    await rmdir(dir);
  }
}

it('uses the regular startup when the transfer configuration was omitted', async () => {
  await expect(
    loadInitialTransferAcceptance(undefined),
  ).resolves.toBeUndefined();
  expect(forApplication).not.toHaveBeenCalled();
});

it('loads an explicit local configuration through the application composition', async () => {
  class ConfiguredRuntime {}
  const runtime = { module: ConfiguredRuntime };
  forApplication.mockReturnValueOnce(runtime);
  await withConfigurationFile(
    'exports.createInitialTransferAcceptanceOptions = async () => ({ sample: "configured" });',
    async (file) => {
      await expect(loadInitialTransferAcceptance(file)).resolves.toBe(runtime);
      expect(forApplication).toHaveBeenCalledWith({ sample: 'configured' });
    },
  );
});

it('rejects an invalid opt-in without exposing errors from the configuration file', async () => {
  await expect(
    loadInitialTransferAcceptance('./acceptance.cjs'),
  ).rejects.toThrow('must be an absolute path');
  await withConfigurationFile(
    'exports.createInitialTransferAcceptanceOptions = () => { throw new Error("private details"); };',
    async (file) => {
      await expect(loadInitialTransferAcceptance(file)).rejects.toThrow(
        'The transfer acceptance configuration could not be initialized',
      );
    },
  );
});
