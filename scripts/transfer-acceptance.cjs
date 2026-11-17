const { createPublicKey } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  checkInitialTransferS3Media,
  createInitialTransferS3Configuration,
} = require('/app/dist/app/animal-transfer/initial-transfer-acceptance-s3');

function mediaSettings(settings) {
  const region =
    process.env.AWS_S3_REGION || process.env.AWS_REGION || 'us-east-1';
  if (
    settings.media.bucket !== process.env.AWS_S3_BUCKET_NAME ||
    settings.media.region !== region
  ) {
    throw new Error(
      'Transfer media storage differs from the AnimalRecord bucket or region',
    );
  }
  return {
    ...settings.media,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  };
}

exports.createInitialTransferAcceptanceOptions = () => {
  const settings = require('./settings.json');
  return createInitialTransferS3Configuration({
    ...settings,
    media: mediaSettings(settings),
    coverage: {
      ...settings.coverage,
      publicKey: createPublicKey(
        readFileSync(join(__dirname, 'coverage-public.pem')),
      ),
    },
    authority: require('./authority.cjs'),
  });
};

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--check-media') {
    console.error('Usage: node transfer-acceptance.cjs --check-media');
    process.exitCode = 1;
  } else {
    Promise.resolve()
      .then(() =>
        checkInitialTransferS3Media(mediaSettings(require('./settings.json'))),
      )
      .then((report) => {
        console.log(JSON.stringify(report));
        if (!report.versioningEnabled || !report.objectLockEnabled)
          process.exitCode = 1;
      })
      .catch(() => {
        console.error(
          'Transfer media inspection failed. Check media settings and S3 read permissions.',
        );
        process.exitCode = 1;
      });
  }
}
