const fs = require('fs');
const { readS3Env } = require('../config/s3');
const { uploadBufferToS3, uploadLocalFileToS3, existsOnS3 } = require('./uploadsStorage');
const { resolveUploadAbsolutePath } = require('./uploadPaths');

const S3_VERIFY_TIMEOUT_MS = Number(process.env.S3_VERIFY_TIMEOUT_MS) || 8000;

/**
 * Фоновое зеркалирование (для некритичных upload-роутов).
 */
function queueUploadMirror(webPath, options = {}) {
  void mirrorUploadToS3(webPath, options).catch((error) => {
    console.warn('[uploads] S3 background mirror failed:', error.message);
  });
}

async function mirrorUploadToS3(webPath, { buffer, mimeType, absolutePath } = {}) {
  if (buffer?.length) {
    try {
      const uploaded = await uploadBufferToS3(webPath, buffer, mimeType);
      if (uploaded) return;
    } catch (error) {
      console.warn('[uploads] S3 buffer upload failed:', error.message);
    }
  }

  const localPath = absolutePath || resolveUploadAbsolutePath(webPath);
  if (!localPath || !fs.existsSync(localPath)) return;

  try {
    await uploadLocalFileToS3(webPath, localPath);
  } catch (error) {
    console.warn('[uploads] S3 file mirror failed:', error.message);
  }
}

/**
 * Сохранить файл в S3 и дождаться подтверждения (для фото ТТН).
 * Без S3 — только локальный диск (ephemeral на Timeweb).
 */
async function persistUploadMirror(webPath, options = {}) {
  await mirrorUploadToS3(webPath, options);

  const s3 = readS3Env();
  if (!s3.enabled) return;

  const onS3 = await existsOnS3(webPath, S3_VERIFY_TIMEOUT_MS);
  if (!onS3) {
    throw new Error(
      'Фото не сохранилось в постоянное хранилище S3. Проверьте интернет и повторите загрузку.'
    );
  }
}

module.exports = {
  queueUploadMirror,
  mirrorUploadToS3,
  persistUploadMirror,
};
