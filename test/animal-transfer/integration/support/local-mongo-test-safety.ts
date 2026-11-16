import { randomUUID } from 'node:crypto';

export const WRITE_TEST_DB_PREFIX = 'animalrecord_write_test_';
export const WRITE_TEST_MARKER = '_animalrecord_write_test_owner';
export const WRITE_TEST_COLLECTIONS = [
  WRITE_TEST_MARKER,
  'animal_ownership_controls',
  'animal_write_journals',
] as const;

export type LocalMongoTestSettings = { uri: string; replicaSet: string };
export type WriteTestNamespace = Readonly<{
  databaseName: string;
  runId: string;
}>;

/** No .env, app URI fallback, credentials, remote hosts or caller-selected DB. */
export function readLocalMongoTestSettings(
  env: NodeJS.ProcessEnv,
): LocalMongoTestSettings {
  if (env.ANIMAL_WRITE_MONGO_TESTS !== '1')
    throw new Error(
      'Mongo write integration is opt-in: ANIMAL_WRITE_MONGO_TESTS=1 is required',
    );
  const uri = env.ANIMAL_WRITE_MONGO_TEST_URI;
  const invalid = () =>
    new Error(
      'Integration URI must name one loopback host, an explicit port and replicaSet; no database, credentials or other options',
    );
  if (!uri || uri.trim() !== uri || /[\r\n]/.test(uri)) throw invalid();
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw invalid();
  }
  const replicaSet = parsed.searchParams.get('replicaSet');
  if (
    parsed.protocol !== 'mongodb:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
    !/^\d+$/.test(parsed.port) ||
    Number(parsed.port) < 1024 ||
    Number(parsed.port) > 65535 ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !['', '/'].includes(parsed.pathname) ||
    !replicaSet ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(replicaSet) ||
    [...parsed.searchParams.keys()].some(
      (key) => !['replicaSet', 'directConnection'].includes(key),
    ) ||
    parsed.searchParams.getAll('replicaSet').length !== 1 ||
    parsed.searchParams.getAll('directConnection').length > 1 ||
    (parsed.searchParams.has('directConnection') &&
      parsed.searchParams.get('directConnection') !== 'true')
  )
    throw invalid();
  return { uri, replicaSet };
}

export function createWriteTestNamespace(): WriteTestNamespace {
  const runId = randomUUID();
  return Object.freeze({
    runId,
    databaseName: WRITE_TEST_DB_PREFIX + runId.replace(/-/g, ''),
  });
}

/** Must pass before any cleanup; never accepts an environment-supplied target. */
export function assertOwnedWriteTestDatabase(
  namespace: WriteTestNamespace,
  actualDatabaseName: string,
  markerRunId: unknown,
  collectionNames: string[],
): void {
  if (
    !/^animalrecord_write_test_[a-f0-9]{32}$/.test(namespace.databaseName) ||
    namespace.databaseName !==
      WRITE_TEST_DB_PREFIX + namespace.runId.replace(/-/g, '') ||
    actualDatabaseName !== namespace.databaseName ||
    markerRunId !== namespace.runId ||
    collectionNames.some(
      (name) => !(WRITE_TEST_COLLECTIONS as readonly string[]).includes(name),
    ) ||
    !collectionNames.includes(WRITE_TEST_MARKER)
  )
    throw new Error(
      'Disposable database ownership could not be verified; cleanup refused',
    );
}
