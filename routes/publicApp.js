const fs = require('fs');
const path = require('path');
const express = require('express');
const { DATA_DIR } = require('../config/paths');

const router = express.Router();

const APP_DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
const APK_FILENAME = 'reestrpro.apk';

function ensureDownloadsDir() {
  if (!fs.existsSync(APP_DOWNLOADS_DIR)) {
    fs.mkdirSync(APP_DOWNLOADS_DIR, { recursive: true });
  }
}

ensureDownloadsDir();

router.get('/app-release', (_req, res) => {
  const apkPath = path.join(APP_DOWNLOADS_DIR, APK_FILENAME);
  const exists = fs.existsSync(apkPath);
  let sizeBytes = 0;
  if (exists) {
    sizeBytes = fs.statSync(apkPath).size;
  }

  return res.json({
    version: process.env.MOBILE_APP_VERSION || '1.5.2',
    version_code: Number(process.env.MOBILE_APP_VERSION_CODE || 37),
    apk_available: exists,
    size_bytes: sizeBytes,
    download_path: exists ? `/downloads/${APK_FILENAME}` : null,
    note: exists
      ? 'Скачайте APK с вашего сервера Timeweb — без Google/Expo.'
      : 'APK ещё не загружен на сервер. Админ: положите файл в DATA_DIR/downloads/reestrpro.apk',
  });
});

module.exports = { router, APP_DOWNLOADS_DIR, APK_FILENAME };
