const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR } = require('../config/paths');

const LEGACY_UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function normalizeUploadWebPath(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  if (raw.startsWith('/uploads/')) return raw;
  if (raw.startsWith('uploads/')) return `/${raw}`;
  if (raw.startsWith('/')) return `/uploads${raw}`;
  return `/uploads/${raw}`;
}

function resolveUploadAbsolutePath(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return null;

  const subPath = normalized.replace(/^\/uploads\/?/, '');
  if (!subPath || subPath.includes('..')) return null;

  const fileName = path.basename(subPath);
  const parentDir = path.dirname(subPath);
  const candidates = [
    path.join(UPLOADS_DIR, subPath),
    path.join(UPLOADS_DIR, parentDir, fileName),
    path.join(UPLOADS_DIR, 'trips', fileName),
    path.join(UPLOADS_DIR, 'orders', fileName),
    path.join(UPLOADS_DIR, 'expenses', fileName),
    path.join(LEGACY_UPLOADS_DIR, subPath),
    path.join(LEGACY_UPLOADS_DIR, 'trips', fileName),
    path.join(LEGACY_UPLOADS_DIR, 'orders', fileName),
  ];

  for (const absolute of candidates) {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return absolute;
    }
  }

  return null;
}

module.exports = {
  normalizeUploadWebPath,
  resolveUploadAbsolutePath,
};
