const path = require('node:path');

// Reuse the webpack version pinned by Nest CLI and bundle the deployed AWS SDK.
const webpack = require(
  require.resolve('webpack', {
    paths: [path.dirname(require.resolve('@nestjs/cli/package.json'))],
  }),
);
const root = path.resolve(__dirname, '..');
webpack(
  {
    mode: 'production',
    target: 'node20',
    entry: path.join(root, 'dist/operations/transfer-put-collector.lambda.js'),
    output: {
      path: path.join(root, 'dist/aws-lambda/transfer-put-collector'),
      filename: 'index.cjs',
      library: { type: 'commonjs2' },
    },
    optimization: { minimize: false },
  },
  (error, stats) => {
    if (error || !stats || stats.hasErrors()) {
      console.error(error ?? stats?.toString({ all: false, errors: true }));
      process.exitCode = 1;
      return;
    }
    console.log(stats.toString({ all: false, assets: true, warnings: true }));
  },
);
