import { mongo } from 'mongoose';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareFlowMongoConnection,
  readFlowReviewFile,
} from '../../../src/operations/transfer-flow-mongo-connection';
import { FLOW_REVIEW_MAX_BYTES } from '../../../src/operations/transfer-flow-operation';
import { flowTarget } from '../fixtures/transfer-flow-requirements.fixture';

const uri = `mongodb://operator:private%2Fpassword@127.0.0.1:27018/?replicaSet=${flowTarget.replicaSet}&directConnection=true`;
describe('Native operational connection boundaries, never connecting a server', () => {
  afterEach(() => jest.restoreAllMocks());
  it('constructs without connecting and pins nonretrying bounded settings, no global CSOT and no driver logging', async () => {
    let options: mongo.MongoClient['options'] | undefined;
    const connect = jest
      .spyOn(mongo.MongoClient.prototype, 'connect')
      .mockImplementation(function (this: mongo.MongoClient) {
        options = this.options;
        return Promise.reject(new Error('No actual connection in this guard'));
      });
    const prepared = prepareFlowMongoConnection(uri, flowTarget);
    expect(connect).not.toHaveBeenCalled();
    expect(prepared.deployment).toEqual({
      protocol: 'mongodb',
      hosts: ['127.0.0.1:27018'],
      tls: false,
      directConnection: true,
    });
    expect(JSON.stringify(prepared.deployment)).not.toMatch(
      /operator|private|password/,
    );
    await expect(prepared.open()).rejects.toThrow('No actual connection');
    await prepared.close();
    expect(options).toMatchObject({
      replicaSet: flowTarget.replicaSet,
      retryReads: false,
      retryWrites: false,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      socketTimeoutMS: 10000,
      maxPoolSize: 2,
    });
    expect(options?.timeoutMS).toBeUndefined();
  });
  it('binds canonical multi-seed endpoints while allowing credential rotation', async () => {
    const a = prepareFlowMongoConnection(
      `mongodb://a:private@host-b:27018,host-a:27018/${flowTarget.databaseName}?tls=true`,
      flowTarget,
    );
    const b = prepareFlowMongoConnection(
      `mongodb://b:other@host-a:27018,host-b:27018/?tls=true`,
      flowTarget,
    );
    expect(a.deployment).toEqual(b.deployment);
    expect(a.deployment.hosts).toEqual(['host-a:27018', 'host-b:27018']);
    await a.close();
    await b.close();
  });
  it('supports SRV endpoint parsing without DNS lookup or connection', async () => {
    const connect = jest
      .spyOn(mongo.MongoClient.prototype, 'connect')
      .mockRejectedValue(new Error('forbidden'));
    const prepared = prepareFlowMongoConnection(
      'mongodb+srv://operator:private@cluster.example.com/?retryWrites=false&w=majority',
      flowTarget,
    );
    expect(prepared.deployment).toEqual({
      protocol: 'mongodb+srv',
      hosts: ['cluster.example.com'],
      tls: true,
      directConnection: false,
    });
    expect(connect).not.toHaveBeenCalled();
    await prepared.close();
  });
  it('disables each driver log component even if diagnostic environment options are set', async () => {
    const previous = process.env.MONGODB_LOG_COMMAND;
    process.env.MONGODB_LOG_COMMAND = 'debug';
    let severities: unknown;
    jest
      .spyOn(mongo.MongoClient.prototype, 'connect')
      .mockImplementation(function (this: mongo.MongoClient) {
        severities = (
          this.options as unknown as {
            mongoLoggerOptions: { componentSeverities: unknown };
          }
        ).mongoLoggerOptions.componentSeverities;
        return Promise.reject(new Error('No actual connection'));
      });
    try {
      const prepared = prepareFlowMongoConnection(uri, flowTarget);
      await expect(prepared.open()).rejects.toThrow('No actual');
      await prepared.close();
      expect(severities).toEqual({
        default: 'off',
        command: 'off',
        topology: 'off',
        serverSelection: 'off',
        connection: 'off',
        client: 'off',
      });
    } finally {
      if (previous === undefined) delete process.env.MONGODB_LOG_COMMAND;
      else process.env.MONGODB_LOG_COMMAND = previous;
    }
  });
  it('rejects nonlocal review locations and a directory as a review file', async () => {
    await expect(
      readFlowReviewFile('\\\\server\\share\\review.json'),
    ).rejects.toThrow('REVIEW_FILE');
    await expect(
      readFlowReviewFile('https://example.com/review.json'),
    ).rejects.toThrow('REVIEW_FILE');
    await expect(readFlowReviewFile(tmpdir())).rejects.toThrow('REVIEW_FILE');
  });
  it.each([
    'mongodb://user:private@127.0.0.1:27018/other',
    uri + '&replicaSet=other',
    uri + '&timeoutMS=1',
    uri + '&tlsInsecure=true',
    uri + '&retryWrites=true',
    uri + '&w=0',
    uri + '&readPreference=secondary',
    uri + '&authMechanism=MONGODB-AWS',
    uri + '&appName=one&APPNAME=two',
    uri + '\n',
    'mongodb://user:private@bad host/',
  ])(
    'refuses unsafe/conflicting URI options without exposing them',
    (value) => {
      let caught: unknown;
      try {
        prepareFlowMongoConnection(value, flowTarget);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ reason: 'URI' });
      expect(String(caught)).not.toMatch(/private|mongodb:\/\//);
    },
  );
  it('reads a bounded review file and closes its stream before returning on success or oversize', async () => {
    const directory = await mkdtemp(
        join(tmpdir(), 'animalrecord-flow-review-'),
      ),
      small = join(directory, 'small.json'),
      large = join(directory, 'large.json');
    try {
      await writeFile(small, '{"review":"synthetic"}');
      await writeFile(large, Buffer.alloc(FLOW_REVIEW_MAX_BYTES + 1, 'a'));
      expect(await readFlowReviewFile(small)).toBe('{"review":"synthetic"}');
      await expect(readFlowReviewFile(large)).rejects.toThrow('REVIEW_FILE');
    } finally {
      await unlink(small);
      await unlink(large);
      await rmdir(directory);
    }
  });
});
