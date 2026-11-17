import type { DynamicModule } from '@nestjs/common';
import { createRequire } from 'node:module';
import { extname, isAbsolute } from 'node:path';
import {
  type InitialTransferAcceptanceConfiguration,
  InitialTransferAcceptanceModule,
} from './initial-transfer-acceptance.module';

export type CreateInitialTransferAcceptanceOptions = () =>
  | InitialTransferAcceptanceConfiguration
  | Promise<InitialTransferAcceptanceConfiguration>;

/** Only a trusted deployment operator supplies this local CommonJS module. */
export async function loadInitialTransferAcceptance(
  filename: string | undefined,
): Promise<DynamicModule | undefined> {
  if (filename === undefined || filename === '') return undefined;
  if (!isAbsolute(filename) || !['.js', '.cjs'].includes(extname(filename)))
    throw new Error(
      'TRANSFER_ACCEPTANCE_CONFIG_MODULE must be an absolute path to a CommonJS file',
    );

  let entry: unknown;
  try {
    entry = createRequire(__filename)(filename);
  } catch {
    throw new Error(
      'The transfer acceptance configuration module could not be loaded',
    );
  }
  if (
    !entry ||
    typeof entry !== 'object' ||
    !('createInitialTransferAcceptanceOptions' in entry) ||
    typeof entry.createInitialTransferAcceptanceOptions !== 'function'
  )
    throw new Error(
      'The transfer acceptance configuration must export createInitialTransferAcceptanceOptions',
    );

  try {
    const createOptions =
      entry.createInitialTransferAcceptanceOptions as CreateInitialTransferAcceptanceOptions;
    return InitialTransferAcceptanceModule.forApplication(
      await createOptions(),
    );
  } catch {
    throw new Error(
      'The transfer acceptance configuration could not be initialized',
    );
  }
}
