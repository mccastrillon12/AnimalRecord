import { S3Client } from '@aws-sdk/client-s3';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { StableCutWriterCensusCompleteness } from '../context/animal-transfer/application/stable-cut-writer-census';
import { StableCutInventoryEvidenceReader } from '../context/animal-transfer/application/stable-cut-writer-evidence';
import {
  profileIdValid,
  sourceHashValid,
} from '../context/animal-transfer/domain/transfer-item-historical-observation';
import {
  AwsStableCutOperationalEvidenceSource,
  AwsStableCutWriterCompletenessPublisher,
  StableCutWriterCompletenessIssuer,
} from '../context/animal-transfer/infrastructure/storage/aws-stable-cut-operational-evidence-source';
import { AwsStableCutWriterCensusReader } from '../context/animal-transfer/infrastructure/storage/aws-stable-cut-writer-census-reader';
import { AwsStableCutWriterCoveragePublisher } from '../context/animal-transfer/infrastructure/storage/aws-stable-cut-writer-coverage-publisher';
import {
  stableCutCoverageSelection,
  StableCutWriterCoverageIssuer,
  type CutScope,
} from '../context/animal-transfer/infrastructure/storage/signed-stable-cut-coverage';

const maxScopeBytes = 1024 * 1024;
const maxKeyBytes = 16384;
const version = 'STABLE_CUT_COVERAGE_OPERATION_V1';

type OperationPorts = Readonly<{
  readFile(path: string, maxBytes: number): Promise<Buffer>;
  createClient(region: string): Pick<S3Client, 'send' | 'destroy'>;
  now(): Date;
}>;

function localPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    !!path.trim() &&
    !/[\0\r\n]/.test(path) &&
    !path.startsWith('--') &&
    !path.startsWith('\\\\') &&
    !path.startsWith('//') &&
    !path.includes('://')
  );
}

function operationConfig(
  env: NodeJS.ProcessEnv,
  command: 'publish' | 'publish-completeness',
) {
  const {
    STABLE_CUT_REGION: region,
    STABLE_CUT_ISSUER_ID: issuerId,
    STABLE_CUT_CONTROLS_HASH: controlsHash,
    STABLE_CUT_PRIVATE_KEY_FILE: keyFile,
    STABLE_CUT_PUBLIC_KEY_SHA256: publicKeySha256,
    STABLE_CUT_EVIDENCE_BUCKET: evidenceBucket,
    STABLE_CUT_EVIDENCE_BUCKET_OWNER: evidenceBucketOwner,
    STABLE_CUT_EVIDENCE_MAX_BYTES: rawEvidenceMaxBytes = '1048576',
  } = env;
  const completeness = command === 'publish-completeness';
  const bucket = completeness
    ? env.STABLE_CUT_COMPLETENESS_BUCKET
    : env.STABLE_CUT_COVERAGE_BUCKET;
  const bucketOwner = completeness
    ? env.STABLE_CUT_COMPLETENESS_BUCKET_OWNER
    : env.STABLE_CUT_COVERAGE_BUCKET_OWNER;
  const censusHash = completeness ? env.STABLE_CUT_CENSUS_SHA256 : undefined;
  const evidenceMaxBytes = Number(rawEvidenceMaxBytes);
  if (
    !region ||
    !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region) ||
    !profileIdValid(issuerId) ||
    !sourceHashValid(controlsHash) ||
    !sourceHashValid(publicKeySha256) ||
    !localPath(keyFile) ||
    !isAbsolute(keyFile) ||
    !evidenceBucket ||
    !evidenceBucketOwner ||
    !bucket ||
    !bucketOwner ||
    (completeness && !sourceHashValid(censusHash)) ||
    !/^[1-9]\d*$/.test(rawEvidenceMaxBytes) ||
    !Number.isSafeInteger(evidenceMaxBytes) ||
    ![evidenceBucket, bucket].every((value) =>
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value),
    ) ||
    ![evidenceBucketOwner, bucketOwner].every((value) => /^\d{12}$/.test(value))
  )
    throw new Error('Invalid configuration');
  return {
    region,
    issuerId,
    controlsHash,
    keyFile,
    publicKeySha256,
    evidenceBucket,
    evidenceBucketOwner,
    evidenceMaxBytes,
    bucket,
    bucketOwner,
    censusHash,
  };
}

async function readBoundedFile(path: string, maxBytes: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  let bytes: Buffer | undefined;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes)
      throw new Error('Unexpected file');
    bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error('File size changed');
    return bytes.subarray(0, length);
  } catch (error) {
    bytes?.fill(0);
    throw error;
  } finally {
    await file.close();
  }
}

async function readPrivateKey(
  ports: OperationPorts,
  path: string,
  expectedFingerprint: string,
) {
  const bytes = await ports.readFile(path, maxKeyBytes);
  try {
    if (!bytes.length || bytes.length > maxKeyBytes)
      throw new Error('Invalid key bytes');
    const key = createPrivateKey({ key: bytes, format: 'pem' });
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('Invalid key type');
    const der = createPublicKey(key).export({ type: 'spki', format: 'der' });
    if (createHash('sha256').update(der).digest('hex') !== expectedFingerprint)
      throw new Error('Unexpected signing key');
    return key;
  } finally {
    bytes.fill(0);
  }
}

export async function runStableCutCoverageOperation(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  ports: OperationPorts,
) {
  if (args.length === 1 && args[0] === '--help')
    return {
      exitCode: 0,
      output: {
        version,
        status: 'HELP',
        usage: '(publish | publish-completeness) --scope-file FILE',
      },
    };

  let stage: 'INPUT' | 'SCOPE' | 'KEY' | 'PUBLICATION' = 'INPUT';
  try {
    const [command, option, scopeFile] = args;
    if (
      args.length !== 3 ||
      (command !== 'publish' && command !== 'publish-completeness') ||
      option !== '--scope-file' ||
      !localPath(scopeFile)
    )
      throw new Error('Invalid arguments');
    const config = operationConfig(env, command);

    stage = 'SCOPE';
    const bytes = await ports.readFile(scopeFile, maxScopeBytes);
    if (!bytes.length || bytes.length > maxScopeBytes)
      throw new Error('Invalid scope bytes');
    const scope = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as CutScope;
    const { horizon } = stableCutCoverageSelection(scope);
    const now = ports.now();
    if (!Number.isFinite(now.getTime()) || now.getTime() > horizon)
      throw new Error('Invalid scope horizon');

    stage = 'KEY';
    const privateKey = await readPrivateKey(
      ports,
      config.keyFile,
      config.publicKeySha256,
    );

    stage = 'PUBLICATION';
    const client = ports.createClient(config.region);
    try {
      const evidenceConfig = {
        evidenceBucket: config.evidenceBucket,
        evidenceBucketOwner: config.evidenceBucketOwner,
        maxBytes: config.evidenceMaxBytes,
      };
      const issuerConfig = {
        issuerId: config.issuerId,
        controlsHash: config.controlsHash,
        privateKey,
      };
      const clock = () => ports.now();
      const publisher = config.censusHash
        ? new AwsStableCutWriterCompletenessPublisher(
            client,
            {
              evidenceBucket: config.bucket,
              evidenceBucketOwner: config.bucketOwner,
              maxBytes: config.evidenceMaxBytes,
            },
            new StableCutWriterCompletenessIssuer(
              new StableCutWriterCensusCompleteness(
                new AwsStableCutWriterCensusReader(client, {
                  ...evidenceConfig,
                  censusHash: config.censusHash,
                }),
              ),
              issuerConfig,
              clock,
            ),
          )
        : new AwsStableCutWriterCoveragePublisher(
            client,
            {
              bucket: config.bucket,
              bucketOwner: config.bucketOwner,
              maxBytes: 4096,
            },
            new StableCutWriterCoverageIssuer(
              new StableCutInventoryEvidenceReader(
                new AwsStableCutOperationalEvidenceSource(
                  client,
                  evidenceConfig,
                ),
              ),
              issuerConfig,
              clock,
            ),
          );
      const receipt = await publisher.publish(scope);
      return receipt
        ? { exitCode: 0, output: { version, status: 'PUBLISHED', ...receipt } }
        : { exitCode: 2, output: { version, status: 'EVIDENCE_UNAVAILABLE' } };
    } finally {
      client.destroy();
    }
  } catch {
    return { exitCode: 1, output: { version, status: 'ERROR', stage } };
  }
}

/** Standalone entry; import performs no file or network operation. */
export async function stableCutCoverageMain(): Promise<void> {
  const result = await runStableCutCoverageOperation(
    process.argv.slice(2),
    process.env,
    {
      readFile: readBoundedFile,
      createClient: (region) => new S3Client({ region }),
      now: () => new Date(),
    },
  );
  process.stdout.write(JSON.stringify(result.output) + '\n');
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  void stableCutCoverageMain().catch(() => {
    process.stderr.write(
      JSON.stringify({ version, status: 'ERROR', stage: 'ENTRY' }) + '\n',
    );
    process.exitCode = 1;
  });
}
