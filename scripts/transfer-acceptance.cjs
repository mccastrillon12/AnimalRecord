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
  const authority = settings.authorityEndpoint
    ? require('/app/dist/context/animal-transfer/infrastructure/storage/https-initial-transfer-authority').createHttpsInitialTransferAuthority(
        {
          ...settings.authorityEndpoint,
          token: process.env.TRANSFER_AUTHORITY_TOKEN,
        },
      )
    : require('./authority.cjs');
  return createInitialTransferS3Configuration({
    ...settings,
    media: mediaSettings(settings),
    coverage: {
      ...settings.coverage,
      publicKey: createPublicKey(
        readFileSync(join(__dirname, 'coverage-public.pem')),
      ),
    },
    authority,
  });
};

if (require.main === module) {
  const action = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !['--check-media', '--check-config'].includes(action)
  ) {
    console.error(
      'Usage: node transfer-acceptance.cjs --check-media|--check-config',
    );
    process.exitCode = 1;
  } else if (action === '--check-config') {
    const {
      loadInitialTransferAcceptance,
    } = require('/app/dist/app/animal-transfer/initial-transfer-acceptance-startup');
    loadInitialTransferAcceptance(__filename)
      .then(() => console.log(JSON.stringify({ configurationLoaded: true })))
      .catch(() => {
        console.error('Transfer acceptance configuration could not be loaded.');
        process.exitCode = 1;
      });
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
