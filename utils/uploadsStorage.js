const fs = require('fs');
const path = require('path');
const { GetObjectCommand, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createS3Client, readS3Env } = require('../config/s3');
const { resolveUploadAbsolutePath, normalizeUploadWebPath } = require('./uploadPaths');

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
  if (!config.enabled || !buffer?.length) return false;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) return false;

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || guessContentType(webPath),
    })
  );
  return true;
}

async function uploadLocalFileToS3(webPath, absolutePath) {
  const config = readS3Env();
  if (!config.enabled || !fs.existsSync(absolutePath)) return false;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) return false;

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: fs.createReadStream(absolutePath),
      ContentType: guessContentType(absolutePath),
    })
  );
  return true;
}

async function existsOnS3(webPath) {
  const config = readS3Env();
  if (!config.enabled) return false;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) return false;

  try {
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function streamUploadToResponse(webPath, res) {
  const config = readS3Env();
  if (!config.enabled) return false;

  const client = createS3Client(config);
  const key = getUploadsObjectKey(webPath);
  if (!client || !key) return false;

  const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
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
}

async function isUploadAvailable(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return false;
  const absolute = resolveUploadAbsolutePath(normalized);
  if (absolute) return true;
  return existsOnS3(normalized);
}

module.exports = {
  getUploadsObjectKey,
  uploadBufferToS3,
  uploadLocalFileToS3,
  existsOnS3,
  streamUploadToResponse,
  isUploadAvailable,
};
