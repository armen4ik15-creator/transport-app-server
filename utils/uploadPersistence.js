const fs = require('fs');
const { uploadBufferToS3, uploadLocalFileToS3 } = require('./uploadsStorage');
const { resolveUploadAbsolutePath } = require('./uploadPaths');

/**
 * Фоновое зеркалирование загруженного файла в S3 (не блокирует ответ API).
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

module.exports = {
  queueUploadMirror,
  mirrorUploadToS3,
};
