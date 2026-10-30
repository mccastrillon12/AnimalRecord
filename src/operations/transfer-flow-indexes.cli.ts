import { runFlowOperation } from './transfer-flow-operation';
import {
  prepareFlowMongoConnection,
  readFlowReviewFile,
} from './transfer-flow-mongo-connection';

/** Standalone production entry; importing this file does not run any operation. */
export async function transferFlowIndexesMain(): Promise<void> {
  const result = await runFlowOperation(
    process.argv.slice(2),
    {
      TRANSFER_FLOW_OPERATION_MONGO_URI:
        process.env.TRANSFER_FLOW_OPERATION_MONGO_URI,
    },
    { connection: prepareFlowMongoConnection, readReview: readFlowReviewFile },
  );
  process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
  process.exitCode = result.exitCode;
}
if (require.main === module) {
  void transferFlowIndexesMain().catch(() => {
    process.stderr.write(
      '{"version":"TRANSFER_FLOW_OPERATION_V1","status":"ERROR","error":{"stage":"ENTRY","reason":"UNCONFIRMED"}}\n',
    );
    process.exitCode = 6;
  });
}
