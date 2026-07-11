const fs = require('fs');
const { readS3Env } = require('../config/s3');
const { uploadBufferToS3, uploadLocalFileToS3, markUploadAvailable } = require('./uploadsStorage');
const { resolveUploadAbsolutePath } = require('./uploadPaths');

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

/**
 * Сохранить файл в S3 (для фото ТТН).
 * После успешного PutObject сразу помечаем доступным — без HeadObject
 * (на Timeweb HEAD занимает 10–15с и роняет весь API).
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

  markUploadAvailable(webPath);
}

module.exports = {
  queueUploadMirror,
  mirrorUploadToS3,
  persistUploadMirror,
};
