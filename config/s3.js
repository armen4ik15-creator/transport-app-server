const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const S3_CONNECTION_TIMEOUT_MS = Number(process.env.S3_CONNECTION_TIMEOUT_MS) || 5000;
const S3_REQUEST_TIMEOUT_MS = Number(process.env.S3_REQUEST_TIMEOUT_MS) || 8000;

let cachedClient = null;
let cachedClientKey = null;

function readS3Env() {
  const bucket = process.env.S3_BUCKET || process.env.BACKUP_S3_BUCKET || '';
  const accessKey = process.env.S3_ACCESS_KEY || process.env.BACKUP_S3_ACCESS_KEY || '';
  const secretKey = process.env.S3_SECRET_KEY || process.env.BACKUP_S3_SECRET_KEY || '';
  const endpoint = process.env.S3_ENDPOINT || process.env.BACKUP_S3_ENDPOINT || undefined;
  const region = process.env.S3_REGION || process.env.BACKUP_S3_REGION || 'ru-1';
  const prefix = process.env.S3_PREFIX || process.env.BACKUP_S3_PREFIX || 'reestrpro/';

  return {
    enabled: Boolean(bucket && accessKey && secretKey),
    bucket,
    accessKey,
    secretKey,
    endpoint,
    region,
    prefix,
  };
}

function createS3Client(config = readS3Env()) {
  if (!config.enabled) return null;

  const clientKey = `${config.bucket}|${config.accessKey}|${config.endpoint || ''}|${config.region}`;
  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      requestTimeout: S3_REQUEST_TIMEOUT_MS,
    }),
  });
  cachedClientKey = clientKey;
  return cachedClient;
}

async function uploadFileToS3({ client, bucket, key, filePath, contentType = 'application/zip' }) {
  const fs = require('fs');
  const body = fs.createReadStream(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return { bucket, key };
}

async function listS3Objects({ client, bucket, prefix, maxKeys = 30 }) {
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    })
  );

  return (response.Contents || [])
    .filter((item) => item.Key && item.Key.endsWith('.zip'))
    .map((item) => ({
      key: item.Key,
      sizeBytes: item.Size || 0,
      lastModified: item.LastModified ? item.LastModified.toISOString() : null,
    }))
    .sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));
}

module.exports = {
  readS3Env,
  createS3Client,
  uploadFileToS3,
  listS3Objects,
};
