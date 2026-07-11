const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureWritableDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  return dir;
}

function tryWritableDir(dir) {
  try {
    return ensureWritableDir(dir);
  } catch {
    return null;
  }
}

function isEphemeralPath(dir) {
  const normalized = path.resolve(dir);
  const tmpRoot = path.resolve(os.tmpdir());
  return normalized.startsWith(tmpRoot) || normalized.includes('/tmp/');
}

function resolveDataDir() {
  const explicit = process.env.DATA_DIR?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    try {
      return ensureWritableDir(resolved);
    } catch (error) {
      const message = `[storage] DATA_DIR=${resolved} недоступен для записи: ${error.message}`;
      if (process.env.NODE_ENV === 'production') {
        console.error(message);
        throw new Error(message);
      }
      console.warn(`${message} — dev fallback`);
    }
  }

  const candidates = [
    '/data',
    path.join(__dirname, '..', 'data'),
    path.join(os.tmpdir(), 'reestrpro-data'),
  ];

  for (const candidate of candidates) {
    const dir = tryWritableDir(candidate);
    if (dir) {
      if (isEphemeralPath(dir)) {
        console.warn(
          `[storage] Используется временный диск ${dir}. При redeploy файлы пропадут — смонтируйте Volume на /data и задайте DATA_DIR=/data.`
        );
      } else {
        console.log(`[storage] Постоянное хранилище: ${dir}`);
      }
      return dir;
    }
  }

  const fallback = path.join(os.tmpdir(), 'reestrpro-data');
  console.warn(`[storage] Fallback на временный диск: ${fallback}`);
  return ensureWritableDir(fallback);
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const LEGACY_DB_PATH = path.join(__dirname, '..', 'data.sqlite');
const LEGACY_UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const EPHEMERAL_DATA_DIR = isEphemeralPath(DATA_DIR);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureDataStorage() {
  ensureDir(DATA_DIR);
  ensureDir(UPLOADS_DIR);

  if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[data] Legacy database copied to ${DB_PATH}`);
  }

  if (fs.existsSync(LEGACY_UPLOADS_DIR)) {
    const entries = fs.readdirSync(LEGACY_UPLOADS_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
      const from = path.join(LEGACY_UPLOADS_DIR, entry.name);
      const to = path.join(UPLOADS_DIR, entry.name);
      if (entry.isDirectory()) {
        ensureDir(to);
      } else if (!fs.existsSync(to)) {
        fs.copyFileSync(from, to);
      }
    });
  }
}

function uploadsSubdir(name) {
  const dir = path.join(UPLOADS_DIR, name);
  ensureDir(dir);
  return dir;
}

function getUploadDirHealth() {
  let exists = false;
  let writable = false;

  try {
    exists = fs.existsSync(UPLOADS_DIR);
    if (exists) {
      const probe = path.join(UPLOADS_DIR, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, String(Date.now()));
      fs.unlinkSync(probe);
      writable = true;
    }
  } catch {
    exists = fs.existsSync(UPLOADS_DIR);
    writable = false;
  }

  return {
    upload_dir: UPLOADS_DIR,
    upload_dir_exists: exists,
    upload_dir_writable: writable,
    persistent_volume: !EPHEMERAL_DATA_DIR,
  };
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  UPLOADS_DIR,
  EPHEMERAL_DATA_DIR,
  ensureDataStorage,
  uploadsSubdir,
  getUploadDirHealth,
  isEphemeralPath,
};
