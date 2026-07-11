const { randomUUID } = require('crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { readS3Env, createS3Client } = require('../config/s3');
const { getUploadDirHealth } = require('../config/paths');

const HEALTH_CACHE_MS = Number(process.env.STORAGE_HEALTH_CACHE_MS) || 5 * 60 * 1000;
const S3_PROBE_TIMEOUT_MS = Number(process.env.S3_PROBE_TIMEOUT_MS) || 6000;

let cachedReport = null;
let cachedAt = 0;

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function probeS3Storage() {
  const config = readS3Env();
  const uploadsPrefix = process.env.S3_UPLOADS_PREFIX || 'uploads/';

  if (!config.enabled) {
    return {
      configured: false,
      reachable: false,
      writable: false,
      bucket: null,
      uploads_prefix: uploadsPrefix,
      message: 'S3 переменные не заданы — фото будут теряться при redeploy App Platform',
    };
  }

  const client = createS3Client(config);
  if (!client) {
    return {
      configured: true,
      reachable: false,
      writable: false,
      bucket: config.bucket,
      uploads_prefix: uploadsPrefix,
      message: 'Не удалось создать S3-клиент',
    };
  }

  const probeKey = `${uploadsPrefix}_health_probe_${randomUUID()}.txt`;
  try {
    await withTimeout(
      client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: probeKey,
          Body: 'ok',
          ContentType: 'text/plain',
        })
      ),
      S3_PROBE_TIMEOUT_MS,
      'S3 write probe'
    );
    await withTimeout(
      client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: probeKey,
        })
      ),
      S3_PROBE_TIMEOUT_MS,
      'S3 delete probe'
    );
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      writable: false,
      bucket: config.bucket,
      uploads_prefix: uploadsPrefix,
      error: error.message,
      message: 'S3 недоступен или не отвечает вовремя — проверьте ключи и bucket',
    };
  }

  return {
    configured: true,
    reachable: true,
    writable: true,
    bucket: config.bucket,
    uploads_prefix: uploadsPrefix,
    message: 'S3 готов для постоянного хранения фото',
  };
}

async function getFullStorageHealth(options = {}) {
  const force = options.force === true;
  if (!force && cachedReport && Date.now() - cachedAt < HEALTH_CACHE_MS) {
    return cachedReport;
  }

  const local = getUploadDirHealth();
  const s3 = await probeS3Storage();

  const report = {
    ...local,
    s3,
    photo_storage_ready: s3.writable || local.persistent_volume,
    healthy: s3.writable || (local.persistent_volume && local.upload_dir_writable),
  };

  cachedReport = report;
  cachedAt = Date.now();
  return report;
}

module.exports = {
  probeS3Storage,
  getFullStorageHealth,
};
