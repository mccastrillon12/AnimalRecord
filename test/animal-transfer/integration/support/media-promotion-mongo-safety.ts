import { randomUUID } from 'node:crypto';
import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
  WriteTestNamespace,
  WRITE_TEST_MARKER,
} from './local-mongo-test-safety';

export const PROMOTION_TEST_DB_PREFIX = 'animalrecord_promotion_test_';
export const PROMOTION_TEST_COLLECTIONS = [
  WRITE_TEST_MARKER,
  'animal_ownership_controls',
  'animal_write_journals',
  'animal_media_uploads',
  'animal_media_promotion_records',
] as const;

export function readMediaPromotionMongoSettings(
  env: NodeJS.ProcessEnv,
): LocalMongoTestSettings {
  if (env.MEDIA_PROMOTION_MONGO_TESTS !== '1')
    throw new Error(
      'Media promotion integration is opt-in: MEDIA_PROMOTION_MONGO_TESTS=1 is required',
    );
  return readLocalMongoTestSettings({
    ANIMAL_WRITE_MONGO_TESTS: '1',
    ANIMAL_WRITE_MONGO_TEST_URI: env.MEDIA_PROMOTION_MONGO_TEST_URI,
  });
}

export function createPromotionTestNamespace(): WriteTestNamespace {
  const runId = randomUUID();
  return Object.freeze({
    runId,
    databaseName: PROMOTION_TEST_DB_PREFIX + runId.replace(/-/g, ''),
  });
}

export function assertOwnedPromotionTestDatabase(
  namespace: WriteTestNamespace,
  databaseName: string,
  markerRunId: unknown,
  collections: string[],
): void {
  if (
    !/^animalrecord_promotion_test_[a-f0-9]{32}$/.test(
      namespace.databaseName,
    ) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      namespace.runId,
    ) ||
    namespace.databaseName !==
      PROMOTION_TEST_DB_PREFIX + namespace.runId.replace(/-/g, '') ||
    databaseName !== namespace.databaseName ||
    markerRunId !== namespace.runId ||
    !collections.includes(WRITE_TEST_MARKER) ||
    collections.some(
      (name) =>
        !(PROMOTION_TEST_COLLECTIONS as readonly string[]).includes(name),
    )
  )
    throw new Error(
      'Disposable promotion database ownership could not be verified; cleanup refused',
    );
}
