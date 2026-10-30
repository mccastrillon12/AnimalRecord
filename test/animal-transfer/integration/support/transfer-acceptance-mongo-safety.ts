import { randomUUID } from 'node:crypto';
import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
  WRITE_TEST_MARKER,
  WriteTestNamespace,
} from './local-mongo-test-safety';

export const ACCEPTANCE_DB_PREFIX = 'animalrecord_acceptance_test_';
export const ACCEPTANCE_COLLECTIONS = [
  WRITE_TEST_MARKER,
  'users',
  'animals',
  'animal_ownership_controls',
  'animal_ownership_periods',
  'animal_transfers',
  'animal_transfer_items',
  'animal_transfer_active_items',
  'animal_transfer_events',
  'diary_entries',
  'medical_documents',
  'animal_media_uploads',
  'animal_ownership_archives',
  'animal_ownership_archive_entries',
  'animal_ownership_archive_files',
  'animal_write_journals',
  'animal_transfer_reasons',
  'notifications',
  'notification_outbox',
] as const;
export function readAcceptanceMongoSettings(
  env: NodeJS.ProcessEnv,
): LocalMongoTestSettings {
  if (env.TRANSFER_ACCEPTANCE_MONGO_TESTS !== '1')
    throw new Error(
      'Acceptance integration is opt-in: TRANSFER_ACCEPTANCE_MONGO_TESTS=1 is required',
    );
  return readLocalMongoTestSettings({
    ANIMAL_WRITE_MONGO_TESTS: '1',
    ANIMAL_WRITE_MONGO_TEST_URI: env.TRANSFER_ACCEPTANCE_MONGO_TEST_URI,
  });
}
export function createAcceptanceNamespace(): WriteTestNamespace {
  const runId = randomUUID();
  return Object.freeze({
    runId,
    databaseName: ACCEPTANCE_DB_PREFIX + runId.replace(/-/g, ''),
  });
}
export function assertOwnedAcceptanceDatabase(
  namespace: WriteTestNamespace,
  name: string,
  marker: unknown,
  collections: string[],
) {
  if (
    !/^animalrecord_acceptance_test_[a-f0-9]{32}$/.test(
      namespace.databaseName,
    ) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      namespace.runId,
    ) ||
    namespace.databaseName !==
      ACCEPTANCE_DB_PREFIX + namespace.runId.replace(/-/g, '') ||
    name !== namespace.databaseName ||
    marker !== namespace.runId ||
    !collections.includes(WRITE_TEST_MARKER) ||
    collections.some(
      (c) => !(ACCEPTANCE_COLLECTIONS as readonly string[]).includes(c),
    )
  )
    throw new Error(
      'Disposable acceptance database ownership could not be verified; cleanup refused',
    );
}
