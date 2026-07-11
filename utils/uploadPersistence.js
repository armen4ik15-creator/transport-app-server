const fs = require('fs');
const { readS3Env } = require('../config/s3');
const { uploadBufferToS3, uploadLocalFileToS3, existsOnS3, markUploadAvailable } = require('./uploadsStorage');
const { resolveUploadAbsolutePath } = require('./uploadPaths');

const S3_VERIFY_TIMEOUT_MS = Number(process.env.S3_VERIFY_TIMEOUT_MS) || 5000;
const S3_VERIFY_RETRIES = Number(process.env.S3_VERIFY_RETRIES) || 2;

/**
 * Фоновое зеркалирование (для некритичных upload-роутов).
 */
function queueUploadMirror(webPath, options = {}) {
  void mirrorUploadToS3(webPath, options).catch((error) => {
    console.warn('[uploads] S3 background mirror failed:', error.message);
  });
}

async function mirrorUploadToS3(webPath, { buffer, mimeType, absolutePath } = {}) {
  const s3 = readS3Env();

  if (buffer?.length && s3.enabled) {
    await uploadBufferToS3(webPath, buffer, mimeType);
    return;
  }

  const localPath = absolutePath || resolveUploadAbsolutePath(webPath);
  if (!localPath || !fs.existsSync(localPath)) {
    if (s3.enabled) {
      throw new Error('Локальный файл не найден для загрузки в S3');
    }
    return;
  }

  if (s3.enabled) {
    const uploaded = await uploadLocalFileToS3(webPath, localPath);
    if (!uploaded) {
      throw new Error('Не удалось загрузить файл в S3');
    }
  }
}

async function waitForS3Object(webPath) {
  for (let attempt = 0; attempt < S3_VERIFY_RETRIES; attempt += 1) {
    const found = await existsOnS3(webPath, S3_VERIFY_TIMEOUT_MS);
    if (found) return true;
    if (attempt < S3_VERIFY_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return false;
}

/**
 * Сохранить файл в S3 и дождаться подтверждения (для фото ТТН).
 */
async function persistUploadMirror(webPath, options = {}) {
  await mirrorUploadToS3(webPath, options);

  const s3 = readS3Env();
  if (!s3.enabled) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[uploads] S3 не настроен — файлы будут потеряны при redeploy');
    }
    return;
  }

  const onS3 = await waitForS3Object(webPath);
  if (!onS3) {
    throw new Error(
      'Фото не сохранилось в S3. Проверьте интернет и повторите загрузку.'
    );
  }
  markUploadAvailable(webPath);
}

module.exports = {
  queueUploadMirror,
  mirrorUploadToS3,
  persistUploadMirror,
};
