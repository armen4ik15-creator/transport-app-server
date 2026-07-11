const { randomUUID } = require('crypto');
const { ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { readS3Env, createS3Client } = require('../config/s3');
const { getUploadDirHealth } = require('../config/paths');

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

  let reachable = false;
  let objectCount = 0;
  try {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: uploadsPrefix,
        MaxKeys: 5,
      })
    );
    reachable = true;
    objectCount = listed.KeyCount ?? (listed.Contents?.length ?? 0);
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      writable: false,
      bucket: config.bucket,
      uploads_prefix: uploadsPrefix,
      error: error.message,
      message: 'S3 недоступен — проверьте ключи и bucket',
    };
  }

  const probeKey = `${uploadsPrefix}_health_probe_${randomUUID()}.txt`;
  let writable = false;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: probeKey,
        Body: 'ok',
        ContentType: 'text/plain',
      })
    );
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: probeKey,
      })
    );
    writable = true;
  } catch (error) {
    return {
      configured: true,
      reachable,
      writable: false,
      bucket: config.bucket,
      uploads_prefix: uploadsPrefix,
      sample_object_count: objectCount,
      error: error.message,
      message: 'S3 доступен для чтения, но запись не работает',
    };
  }

  return {
    configured: true,
    reachable,
    writable,
    bucket: config.bucket,
    uploads_prefix: uploadsPrefix,
    sample_object_count: objectCount,
    message: 'S3 готов для постоянного хранения фото',
  };
}

async function getFullStorageHealth() {
  const local = getUploadDirHealth();
  const s3 = await probeS3Storage();

  return {
    ...local,
    s3,
    photo_storage_ready: s3.writable || local.persistent_volume,
    healthy: s3.writable || (local.persistent_volume && local.upload_dir_writable),
  };
}

module.exports = {
  probeS3Storage,
  getFullStorageHealth,
};
