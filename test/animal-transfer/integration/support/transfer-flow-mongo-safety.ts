import { randomUUID } from 'node:crypto';
import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
  WRITE_TEST_MARKER,
  WriteTestNamespace,
} from './local-mongo-test-safety';

export const FLOW_DB_PREFIX = 'animalrecord_flow_test_';
export const FLOW_COLLECTIONS = [
  WRITE_TEST_MARKER,
  'users',
  'animals',
  'animal_ownership_controls',
  'animal_transfer_reasons',
  'animal_transfer_otp',
  'animal_transfers',
  'animal_transfer_items',
  'animal_transfer_active_items',
  'notifications',
  'notification_outbox',
  'animal_transfer_events',
  'notification_devices',
  'notification_device_tokens',
  'notification_push_deliveries',
  'notification_push_attempts',
] as const;
export function readTransferFlowMongoSettings(
  env: NodeJS.ProcessEnv,
): LocalMongoTestSettings {
  if (env.TRANSFER_FLOW_MONGO_TESTS !== '1')
    throw new Error(
      'Transfer flow integration is opt-in: TRANSFER_FLOW_MONGO_TESTS=1 is required',
    );
  return readLocalMongoTestSettings({
    ANIMAL_WRITE_MONGO_TESTS: '1',
    ANIMAL_WRITE_MONGO_TEST_URI: env.TRANSFER_FLOW_MONGO_TEST_URI,
  });
}
export function createFlowNamespace(): WriteTestNamespace {
  const runId = randomUUID();
  return Object.freeze({
    runId,
    databaseName: FLOW_DB_PREFIX + runId.replace(/-/g, ''),
  });
}
export function assertOwnedFlowDatabase(
  namespace: WriteTestNamespace,
  databaseName: string,
  marker: unknown,
  collections: string[],
): void {
  if (
    !/^animalrecord_flow_test_[a-f0-9]{32}$/.test(namespace.databaseName) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      namespace.runId,
    ) ||
    namespace.databaseName !==
      FLOW_DB_PREFIX + namespace.runId.replace(/-/g, '') ||
    databaseName !== namespace.databaseName ||
    marker !== namespace.runId ||
    !collections.includes(WRITE_TEST_MARKER) ||
    collections.some(
      (c) => !(FLOW_COLLECTIONS as readonly string[]).includes(c),
    )
  )
    throw new Error(
      'Disposable flow database ownership could not be verified; cleanup refused',
    );
}
