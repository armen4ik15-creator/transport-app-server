const fs = require('fs');
const path = require('path');
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { createS3Client, readS3Env } = require('../config/s3');
const { resolveUploadAbsolutePath, normalizeUploadWebPath } = require('./uploadPaths');
const {
  getCachedAvailability,
  setCachedAvailability,
  markUploadAvailable,
  invalidateUploadAvailability,
} = require('./uploadAvailabilityCache');

const S3_MAX_CONCURRENT = Number(process.env.S3_MAX_CONCURRENT) || 4;
let s3Inflight = 0;
const s3WaitQueue = [];

function releaseS3Slot() {
  s3Inflight = Math.max(0, s3Inflight - 1);
  const next = s3WaitQueue.shift();
  if (next) next();
}

function acquireS3Slot() {
  if (s3Inflight < S3_MAX_CONCURRENT) {
    s3Inflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    s3WaitQueue.push(resolve);
  }).then(() => {
    s3Inflight += 1;
  });
}

async function sendS3Command(client, command, options) {
  await acquireS3Slot();
  try {
    return await client.send(command, options);
  } finally {
    releaseS3Slot();
  }
}

function getUploadsObjectKey(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return null;
  const subPath = normalized.replace(/^\/uploads\//, '');
  const prefix = process.env.S3_UPLOADS_PREFIX || 'uploads/';
  return `${prefix}${subPath}`;
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

async function uploadBufferToS3(webPath, buffer, contentType) {
  const config = readS3Env();
  if (!config.enabled) return false;
  if (!buffer?.length) {
    throw new Error('Empty upload buffer');
  }

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) {
    throw new Error('S3 client or object key unavailable');
  }

  await sendS3Command(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || guessContentType(webPath),
    })
  );
  markUploadAvailable(webPath);
  return true;
}

async function uploadLocalFileToS3(webPath, absolutePath) {
  const config = readS3Env();
  if (!config.enabled || !fs.existsSync(absolutePath)) return false;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) return false;

  const body = fs.readFileSync(absolutePath);
  await sendS3Command(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: guessContentType(absolutePath),
    })
  );
  markUploadAvailable(webPath);
  return true;
}

/**
 * Проверка наличия файла.
 * ВАЖНО: Timeweb S3 HeadObject занимает 10–15с и вешает API при списках рейсов/фото.
 * Поэтому при включённом S3 доверяем photo_path в БД (файл попал туда после успешного PutObject).
 * Реальная проверка — при отдаче файла через GetObject.
 */
async function isUploadAvailable(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return false;

  const cached = getCachedAvailability(normalized);
  if (cached !== undefined) return cached;

  const absolute = resolveUploadAbsolutePath(normalized);
  if (absolute) {
    setCachedAvailability(normalized, true);
    return true;
  }

  const s3 = readS3Env();
  if (s3.enabled) {
    setCachedAvailability(normalized, true);
    return true;
  }

  setCachedAvailability(normalized, false);
  return false;
}

async function readUploadBuffer(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return null;

  const absolute = resolveUploadAbsolutePath(normalized);
  if (absolute) {
    return fs.readFileSync(absolute);
  }

  const config = readS3Env();
  if (!config.enabled) return null;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(normalized);
  if (!client || !key) return null;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number(process.env.S3_GET_TIMEOUT_MS) || 12000
  );

  try {
    const response = await sendS3Command(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: controller.signal }
    );
    if (!response.Body) return null;

    const body = response.Body;
    if (Buffer.isBuffer(body)) return body;

    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Прогреваем локальный /tmp, чтобы следующие запросы шли через express.static.
    try {
      const localPath = path.join(
        require('../config/paths').UPLOADS_DIR,
        normalized.replace(/^\/uploads\//, '')
      );
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, buffer);
    } catch (cacheError) {
      console.warn('[uploads] local cache write failed:', cacheError.message);
    }

    return buffer;
  } catch (error) {
    console.warn('[uploads] S3 read buffer failed:', error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function streamUploadToResponse(webPath, res) {
  const config = readS3Env();
  if (!config.enabled) return false;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) return false;

  try {
    const response = await sendS3Command(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key })
    );
    if (!response.Body) return false;

    res.setHeader('Content-Type', response.ContentType || guessContentType(webPath));
    if (response.ContentLength != null) {
      res.setHeader('Content-Length', String(response.ContentLength));
    }

    const body = response.Body;
    if (typeof body.pipe === 'function') {
      body.pipe(res);
      return true;
    }

    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    res.end(Buffer.concat(chunks));
    return true;
  } catch (error) {
    console.warn('[uploads] S3 GetObject failed:', error.message);
    return false;
  }
}

async function deleteFromS3(webPath) {
  const config = readS3Env();
  if (!config.enabled) return false;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.S3_DELETE_TIMEOUT_MS) || 5000);

  try {
    await sendS3Command(
      client,
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: controller.signal }
    );
    invalidateUploadAvailability(webPath);
    return true;
  } catch (error) {
    console.warn('[uploads] S3 delete failed:', error.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function deleteStoredUpload(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return;

  const absolute = resolveUploadAbsolutePath(normalized);
  if (absolute) {
    try {
      fs.unlinkSync(absolute);
    } catch {
      // ignore local delete errors
    }
  }

  await deleteFromS3(normalized);
  invalidateUploadAvailability(normalized);
}

module.exports = {
  getUploadsObjectKey,
  uploadBufferToS3,
  uploadLocalFileToS3,
  deleteFromS3,
  readUploadBuffer,
  streamUploadToResponse,
  isUploadAvailable,
  deleteStoredUpload,
  markUploadAvailable,
  invalidateUploadAvailability,
};
