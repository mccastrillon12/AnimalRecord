import { S3Client } from '@aws-sdk/client-s3';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { StableCutWriterCensusCompleteness } from '../context/animal-transfer/application/stable-cut-writer-census';
import { StableCutInventoryEvidenceReader } from '../context/animal-transfer/application/stable-cut-writer-evidence';
import {
  profileIdValid,
  sourceHashValid,
} from '../context/animal-transfer/domain/transfer-item-historical-observation';
import { historicalPutEvidenceTime } from '../context/animal-transfer/domain/transfer-item-historical-put-reconciliation';
import { ITEM_STABLE_CUT_SCOPE_PROTOCOL } from '../context/animal-transfer/domain/transfer-item-stable-cut-evidence';
import {
  AwsSignedItemStableCutCoverage,
  AwsSignedLaterPeriodStableCutCoverage,
} from '../context/animal-transfer/infrastructure/storage/aws-signed-stable-cut-coverage';
import {
  AwsSignedStableCutWriterCompletenessSource,
  AwsStableCutOperationalEvidenceArchive,
  AwsStableCutOperationalEvidenceSource,
  AwsStableCutWriterCompletenessPublisher,
  captureStableCutWriterFindings,
  captureStableCutWriterInventory,
  StableCutWriterCompletenessIssuer,
} from '../context/animal-transfer/infrastructure/storage/aws-stable-cut-operational-evidence-source';
import {
  AwsStableCutWriterCensusReader,
  capturePinnedStableCutWriterCensus,
} from '../context/animal-transfer/infrastructure/storage/aws-stable-cut-writer-census-reader';
import { AwsStableCutWriterCoveragePublisher } from '../context/animal-transfer/infrastructure/storage/aws-stable-cut-writer-coverage-publisher';
import {
  stableCutCoverageSelection,
  StableCutWriterCoverageIssuer,
  type CutScope,
} from '../context/animal-transfer/infrastructure/storage/signed-stable-cut-coverage';

const maxScopeBytes = 1024 * 1024;
const maxKeyBytes = 16384;
const maxCoverageBytes = 4096;
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

function archiveConfig(
  bucket: string | undefined,
  owner: string | undefined,
  maxBytes: number,
) {
  if (
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !owner ||
    !/^\d{12}$/.test(owner)
  )
    throw new Error('Invalid archive configuration');
  return { evidenceBucket: bucket, evidenceBucketOwner: owner, maxBytes };
}

function evidenceMaxBytes(raw = '1048576') {
  const limit = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(limit))
    throw new Error('Invalid evidence byte limit');
  return limit;
}

function operationConfig(
  env: NodeJS.ProcessEnv,
  command: 'publish' | 'publish-completeness' | 'collect' | 'verify',
) {
  const {
    STABLE_CUT_REGION: region,
    STABLE_CUT_CONTROLS_HASH: controlsHash,
    STABLE_CUT_EVIDENCE_BUCKET: evidenceBucket,
    STABLE_CUT_EVIDENCE_BUCKET_OWNER: evidenceBucketOwner,
  } = env;
  if (
    !region ||
    !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region) ||
    !sourceHashValid(controlsHash)
  )
    throw new Error('Invalid configuration');

  if (command === 'verify') {
    const {
      STABLE_CUT_ISSUER_ID: issuerId,
      STABLE_CUT_PUBLIC_KEY_FILE: keyFile,
      STABLE_CUT_PUBLIC_KEY_SHA256: publicKeySha256,
    } = env;
    if (
      !profileIdValid(issuerId) ||
      !localPath(keyFile) ||
      !isAbsolute(keyFile) ||
      !sourceHashValid(publicKeySha256)
    )
      throw new Error('Invalid coverage authority configuration');
    const coverage = archiveConfig(
      env.STABLE_CUT_COVERAGE_BUCKET,
      env.STABLE_CUT_COVERAGE_BUCKET_OWNER,
      maxCoverageBytes,
    );
    return {
      command,
      region,
      controlsHash,
      issuerId,
      keyFile,
      publicKeySha256,
      coverage,
    };
  }

  const maxBytes = evidenceMaxBytes(env.STABLE_CUT_EVIDENCE_MAX_BYTES);
  const evidence = archiveConfig(evidenceBucket, evidenceBucketOwner, maxBytes);
  const common = { region, controlsHash, evidence };
  if (command === 'collect') {
    const {
      STABLE_CUT_COMPLETENESS_ISSUER_ID: issuerId,
      STABLE_CUT_COMPLETENESS_PUBLIC_KEY_FILE: keyFile,
      STABLE_CUT_COMPLETENESS_PUBLIC_KEY_SHA256: publicKeySha256,
    } = env;
    if (
      !profileIdValid(issuerId) ||
      !localPath(keyFile) ||
      !isAbsolute(keyFile) ||
      !sourceHashValid(publicKeySha256)
    )
      throw new Error('Invalid completeness authority configuration');
    const input = archiveConfig(
      env.STABLE_CUT_COLLECTOR_INPUT_BUCKET,
      env.STABLE_CUT_COLLECTOR_INPUT_BUCKET_OWNER,
      maxBytes,
    );
    if (input.evidenceBucket === evidence.evidenceBucket)
      throw new Error('Collector input and output must use distinct buckets');
    const completeness = archiveConfig(
      env.STABLE_CUT_COMPLETENESS_BUCKET,
      env.STABLE_CUT_COMPLETENESS_BUCKET_OWNER,
      maxBytes,
    );
    return {
      ...common,
      command,
      issuerId,
      keyFile,
      publicKeySha256,
      input,
      completeness,
    };
  }

  const {
    STABLE_CUT_ISSUER_ID: issuerId,
    STABLE_CUT_PRIVATE_KEY_FILE: keyFile,
    STABLE_CUT_PUBLIC_KEY_SHA256: publicKeySha256,
  } = env;
  const completeness = command === 'publish-completeness';
  const bucket = completeness
    ? env.STABLE_CUT_COMPLETENESS_BUCKET
    : env.STABLE_CUT_COVERAGE_BUCKET;
  const bucketOwner = completeness
    ? env.STABLE_CUT_COMPLETENESS_BUCKET_OWNER
    : env.STABLE_CUT_COVERAGE_BUCKET_OWNER;
  const censusHash = completeness ? env.STABLE_CUT_CENSUS_SHA256 : undefined;
  if (
    !profileIdValid(issuerId) ||
    !sourceHashValid(publicKeySha256) ||
    !localPath(keyFile) ||
    !isAbsolute(keyFile) ||
    (completeness && !sourceHashValid(censusHash))
  )
    throw new Error('Invalid configuration');
  return {
    ...common,
    command,
    issuerId,
    keyFile,
    publicKeySha256,
    output: archiveConfig(
      bucket,
      bucketOwner,
      completeness ? maxBytes : maxCoverageBytes,
    ),
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
    assertPublicKey(createPublicKey(key), expectedFingerprint);
    return key;
  } finally {
    bytes.fill(0);
  }
}

function assertPublicKey(key: KeyObject, expectedFingerprint: string) {
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid key type');
  const der = key.export({ type: 'spki', format: 'der' });
  if (createHash('sha256').update(der).digest('hex') !== expectedFingerprint)
    throw new Error('Unexpected signing key');
}

async function readPublicKey(
  ports: OperationPorts,
  path: string,
  expectedFingerprint: string,
) {
  const bytes = await ports.readFile(path, maxKeyBytes);
  if (
    !bytes.length ||
    bytes.length > maxKeyBytes ||
    !bytes
      .toString('ascii')
      .trimStart()
      .startsWith('-----BEGIN PUBLIC KEY-----')
  )
    throw new Error('Invalid public key bytes');
  const key = createPublicKey({ key: bytes, format: 'pem' });
  assertPublicKey(key, expectedFingerprint);
  return key;
}

async function readJsonFile(
  ports: OperationPorts,
  path: string,
  maxBytes: number,
) {
  const bytes = await ports.readFile(path, maxBytes);
  if (!bytes.length || bytes.length > maxBytes)
    throw new Error('Invalid JSON file size');
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as unknown;
}

async function runStableCutPackagePreflight(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  ports: OperationPorts,
) {
  let stage:
    | 'INPUT'
    | 'SCOPE'
    | 'CENSUS'
    | 'INVENTORY'
    | 'FINDINGS'
    | 'PACKAGE' = 'INPUT';
  try {
    const [
      ,
      scopeOption,
      scopeFile,
      censusOption,
      censusFile,
      inventoryOption,
      inventoryFile,
      findingsOption,
      findingsFile,
    ] = args;
    const {
      STABLE_CUT_CONTROLS_HASH: controlsHash,
      STABLE_CUT_CENSUS_SHA256: censusHash,
    } = env;
    if (
      args.length !== 9 ||
      scopeOption !== '--scope-file' ||
      censusOption !== '--census-file' ||
      inventoryOption !== '--inventory-file' ||
      findingsOption !== '--findings-file' ||
      !localPath(scopeFile) ||
      !localPath(censusFile) ||
      !localPath(inventoryFile) ||
      !localPath(findingsFile) ||
      !sourceHashValid(controlsHash) ||
      !sourceHashValid(censusHash)
    )
      throw new Error('Invalid preflight inputs');
    const maxBytes = evidenceMaxBytes(env.STABLE_CUT_EVIDENCE_MAX_BYTES);

    stage = 'SCOPE';
    const scope = (await readJsonFile(
      ports,
      scopeFile,
      maxScopeBytes,
    )) as CutScope;
    const { scopeHash, horizon } = stableCutCoverageSelection(scope);
    const binding = {
      scopeHash,
      initial: scope.protocol === ITEM_STABLE_CUT_SCOPE_PROTOCOL,
    };
    const startedAt = ports.now().getTime();
    if (!Number.isSafeInteger(startedAt) || startedAt > horizon)
      throw new Error('Invalid scope horizon');

    stage = 'CENSUS';
    const census = capturePinnedStableCutWriterCensus(
      await readJsonFile(ports, censusFile, maxBytes),
      scopeHash,
      controlsHash,
      censusHash,
    );
    const completeness = new StableCutWriterCensusCompleteness({
      readCensus: () => Promise.resolve(census),
    });
    const projected = await completeness.readCompleteness(scope, controlsHash);

    stage = 'INVENTORY';
    const inventory = captureStableCutWriterInventory(
      await readJsonFile(ports, inventoryFile, maxBytes),
      binding,
      controlsHash,
    );
    stage = 'PACKAGE';
    const reader = new StableCutInventoryEvidenceReader(
      {
        readInventory: () => Promise.resolve(inventory),
        readFindings: async (
          _selectedScope,
          generation,
          writerInventoryHash,
        ) => {
          stage = 'FINDINGS';
          const findings = captureStableCutWriterFindings(
            await readJsonFile(ports, findingsFile, maxBytes),
            binding,
            generation,
            writerInventoryHash,
          );
          stage = 'PACKAGE';
          return findings;
        },
      },
      { readCompleteness: () => Promise.resolve(projected) },
    );
    const verified = await reader.readVerifiedEvidence(scope, controlsHash);
    if (!verified)
      return {
        exitCode: 2,
        output: { version, status: 'EVIDENCE_UNAVAILABLE' },
      };
    const { writerInventoryHash, validFrom, validUntil } = verified.coverage;
    const checkedAt = ports.now().getTime();
    if (
      !Number.isSafeInteger(checkedAt) ||
      checkedAt < startedAt ||
      checkedAt > horizon ||
      historicalPutEvidenceTime(census.validFrom) > checkedAt ||
      historicalPutEvidenceTime(validFrom) > checkedAt ||
      Buffer.byteLength(JSON.stringify(verified.inventory)) > maxBytes ||
      Buffer.byteLength(JSON.stringify(verified.findings)) > maxBytes
    )
      throw new Error('Package not ready for publication');
    return {
      exitCode: 0,
      output: {
        version,
        status: 'PACKAGE_CONSISTENT',
        scopeHash,
        controlsHash,
        censusHash,
        writerInventoryHash,
        validFrom,
        validUntil,
      },
    };
  } catch {
    return { exitCode: 1, output: { version, status: 'ERROR', stage } };
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
        usage:
          '(publish | publish-completeness | collect | verify) --scope-file FILE',
        preflightUsage:
          'preflight --scope-file FILE --census-file FILE --inventory-file FILE --findings-file FILE',
      },
    };

  if (args[0] === 'preflight')
    return runStableCutPackagePreflight(args, env, ports);

  let stage:
    | 'INPUT'
    | 'SCOPE'
    | 'KEY'
    | 'PUBLICATION'
    | 'COLLECTION'
    | 'VERIFICATION' = 'INPUT';
  try {
    const [command, option, scopeFile] = args;
    if (
      args.length !== 3 ||
      (command !== 'publish' &&
        command !== 'publish-completeness' &&
        command !== 'collect' &&
        command !== 'verify') ||
      option !== '--scope-file' ||
      !localPath(scopeFile)
    )
      throw new Error('Invalid arguments');
    const config = operationConfig(env, command);

    stage = 'SCOPE';
    const scope = (await readJsonFile(
      ports,
      scopeFile,
      maxScopeBytes,
    )) as CutScope;
    const { horizon } = stableCutCoverageSelection(scope);
    const now = ports.now();
    if (!Number.isFinite(now.getTime()) || now.getTime() > horizon)
      throw new Error('Invalid scope horizon');

    stage = 'KEY';
    const clock = () => ports.now();
    if (config.command === 'verify') {
      const publicKey = await readPublicKey(
        ports,
        config.keyFile,
        config.publicKeySha256,
      );
      stage = 'VERIFICATION';
      const client = ports.createClient(config.region);
      try {
        const readerConfig = {
          bucket: config.coverage.evidenceBucket,
          bucketOwner: config.coverage.evidenceBucketOwner,
          maxBytes: config.coverage.maxBytes,
          issuerId: config.issuerId,
          controlsHash: config.controlsHash,
          publicKey,
        };
        const report =
          scope.protocol === ITEM_STABLE_CUT_SCOPE_PROTOCOL
            ? await new AwsSignedItemStableCutCoverage(
                client,
                readerConfig,
                clock,
              ).readCoverage(scope)
            : await new AwsSignedLaterPeriodStableCutCoverage(
                client,
                readerConfig,
                clock,
              ).readCoverage(scope);
        if (!report)
          return {
            exitCode: 2,
            output: { version, status: 'EVIDENCE_UNAVAILABLE' },
          };
        const {
          scopeHash,
          controlsHash,
          writerInventoryHash,
          validFrom,
          validUntil,
        } = report;
        return {
          exitCode: 0,
          output: {
            version,
            status: 'VERIFIED',
            scopeHash,
            controlsHash,
            writerInventoryHash,
            validFrom,
            validUntil,
          },
        };
      } finally {
        client.destroy();
      }
    }

    if (config.command === 'collect') {
      const publicKey = await readPublicKey(
        ports,
        config.keyFile,
        config.publicKeySha256,
      );
      stage = 'COLLECTION';
      const client = ports.createClient(config.region);
      try {
        const collector = new AwsStableCutOperationalEvidenceArchive(
          client,
          config.evidence,
          new AwsStableCutOperationalEvidenceSource(client, config.input),
          new AwsSignedStableCutWriterCompletenessSource(
            client,
            {
              ...config.completeness,
              issuerId: config.issuerId,
              controlsHash: config.controlsHash,
              publicKey,
            },
            clock,
          ),
        );
        const receipt = await collector.archive(scope, config.controlsHash);
        return receipt
          ? { exitCode: 0, output: { version, status: 'ARCHIVED', ...receipt } }
          : {
              exitCode: 2,
              output: { version, status: 'EVIDENCE_UNAVAILABLE' },
            };
      } finally {
        client.destroy();
      }
    }

    const privateKey = await readPrivateKey(
      ports,
      config.keyFile,
      config.publicKeySha256,
    );

    stage = 'PUBLICATION';
    const client = ports.createClient(config.region);
    try {
      const issuerConfig = {
        issuerId: config.issuerId,
        controlsHash: config.controlsHash,
        privateKey,
      };
      const publisher = config.censusHash
        ? new AwsStableCutWriterCompletenessPublisher(
            client,
            config.output,
            new StableCutWriterCompletenessIssuer(
              new StableCutWriterCensusCompleteness(
                new AwsStableCutWriterCensusReader(client, {
                  ...config.evidence,
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
              bucket: config.output.evidenceBucket,
              bucketOwner: config.output.evidenceBucketOwner,
              maxBytes: config.output.maxBytes,
            },
            new StableCutWriterCoverageIssuer(
              new StableCutInventoryEvidenceReader(
                new AwsStableCutOperationalEvidenceSource(
                  client,
                  config.evidence,
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
