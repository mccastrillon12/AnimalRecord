const { createPublicKey } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  createInitialTransferS3Configuration,
} = require('/app/dist/app/animal-transfer/initial-transfer-acceptance-s3');

exports.createInitialTransferAcceptanceOptions = () => {
  const settings = require('./settings.json');
  const authority = require('./authority.cjs');
  const region = process.env.AWS_S3_REGION || process.env.AWS_REGION || 'us-east-1';
  if (settings.media.bucket !== process.env.AWS_S3_BUCKET_NAME || settings.media.region !== region) {
    throw new Error('Transfer media storage differs from the AnimalRecord bucket or region');
  }

  return createInitialTransferS3Configuration({
    ...settings,
    media: {
      ...settings.media,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    },
    coverage: {
      ...settings.coverage,
      publicKey: createPublicKey(readFileSync(join(__dirname, 'coverage-public.pem'))),
    },
    authority,
  });
};
