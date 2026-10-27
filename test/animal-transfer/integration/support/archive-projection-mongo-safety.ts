import {
  LocalMongoTestSettings,
  readLocalMongoTestSettings,
} from './local-mongo-test-safety';

/** A new opt-in is required; neither app nor older harness settings authorize it. */
export function readArchiveProjectionMongoSettings(
  env: NodeJS.ProcessEnv,
): LocalMongoTestSettings {
  if (env.ARCHIVE_PROJECTION_MONGO_TESTS !== '1')
    throw new Error(
      'Archive projection integration is opt-in: ARCHIVE_PROJECTION_MONGO_TESTS=1 is required',
    );
  return readLocalMongoTestSettings({
    ANIMAL_WRITE_MONGO_TESTS: '1',
    ANIMAL_WRITE_MONGO_TEST_URI: env.ARCHIVE_PROJECTION_MONGO_TEST_URI,
  });
}
