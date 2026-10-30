import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { mongo } from 'mongoose';
import {
  FlowTarget,
  copyFlowTarget,
} from '../context/animal-transfer/domain/transfer-flow-mongo-requirements';
import { MongoTransferFlowIndexMaintenance } from '../context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-flow-index-maintenance';
import { validFlowTarget } from '../context/animal-transfer/application/transfer-flow-index-maintenance';
import {
  FLOW_REVIEW_MAX_BYTES,
  FlowOperationConnection,
  FlowOperationInputError,
} from './transfer-flow-operation';

/** Constructs a driver client without connecting. URI/credentials never leave this boundary. */
export function prepareFlowMongoConnection(
  uri: string,
  target: FlowTarget,
): FlowOperationConnection {
  try {
    target = copyFlowTarget(target);
    if (
      !validFlowTarget(target) ||
      typeof uri !== 'string' ||
      uri.trim() !== uri ||
      uri.length > 16384 ||
      /[\s\0]/.test(uri)
    )
      throw new Error();
    const parsed =
      /^(mongodb(?:\+srv)?):\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?$/.exec(uri);
    if (
      !parsed ||
      (parsed[3] &&
        parsed[3] !== '/' &&
        decodeURIComponent(parsed[3].slice(1)) !== target.databaseName)
    )
      throw new Error();
    const params = new URLSearchParams(parsed[4] ?? ''),
      keys = new Set<string>();
    for (const [rawKey, value] of params) {
      const key = rawKey.toLowerCase();
      if (
        keys.has(key) ||
        ![
          'replicaset',
          'tls',
          'authsource',
          'authmechanism',
          'retrywrites',
          'w',
          'appname',
          'directconnection',
          'readpreference',
        ].includes(key)
      )
        throw new Error();
      keys.add(key);
      if (
        (key === 'replicaset' && value !== target.replicaSet) ||
        (key === 'w' && value !== 'majority') ||
        (key === 'readpreference' && value !== 'primary') ||
        (key === 'retrywrites' && value !== 'false') ||
        (key === 'authmechanism' &&
          !['DEFAULT', 'SCRAM-SHA-256', 'SCRAM-SHA-1'].includes(value))
      )
        throw new Error();
    }
    const client = new mongo.MongoClient(uri, {
      replicaSet: target.replicaSet,
      readPreference: 'primary',
      retryReads: false,
      retryWrites: false,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 10000,
      maxPoolSize: 2,
      monitorCommands: false,
      mongodbLogComponentSeverities: {
        default: 'off',
        command: 'off',
        topology: 'off',
        serverSelection: 'off',
        connection: 'off',
        client: 'off',
      },
      // No global timeoutMS: driver 6.20 bulkWrite conflicts with bounded withTransaction.
    });
    const hosts =
      parsed[1] === 'mongodb+srv'
        ? [client.options.srvHost!]
        : client.options.hosts.map((h) => h.toString());
    const deployment = Object.freeze({
      protocol: parsed[1] as 'mongodb' | 'mongodb+srv',
      hosts: Object.freeze(hosts.map((h) => h.toLowerCase()).sort()),
      tls: client.options.tls === true,
      directConnection: client.options.directConnection === true,
    });
    return {
      deployment,
      async open() {
        await client.connect();
        return new MongoTransferFlowIndexMaintenance(
          client.db(target.databaseName),
          target,
        ).operator();
      },
      close: () => client.close(),
    };
  } catch {
    throw new FlowOperationInputError('URI');
  }
}
/** Bounded local review artifact; no writing, globbing, .env loading or stdin fallback. */
export async function readFlowReviewFile(path: string): Promise<string> {
  if (
    !path ||
    /[\0\r\n]/.test(path) ||
    path.startsWith('\\\\') ||
    path.includes('://')
  )
    throw new FlowOperationInputError('REVIEW_FILE');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size > FLOW_REVIEW_MAX_BYTES)
    throw new FlowOperationInputError('REVIEW_FILE');
  const stream = createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: 65536,
  });
  let text = '',
    bytes = 0;
  try {
    for await (const chunk of stream as AsyncIterable<unknown>) {
      if (typeof chunk !== 'string')
        throw new FlowOperationInputError('REVIEW_FILE');
      bytes += Buffer.byteLength(chunk);
      if (bytes > FLOW_REVIEW_MAX_BYTES)
        throw new FlowOperationInputError('REVIEW_FILE');
      text += chunk;
    }
    return text;
  } finally {
    const closed = stream.closed
      ? Promise.resolve()
      : new Promise<void>((resolve) => stream.once('close', resolve));
    stream.destroy();
    await closed;
  }
}
