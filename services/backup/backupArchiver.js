const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { UPLOADS_DIR } = require('../../config/paths');

function countFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(fullPath);
    } else {
      count += 1;
    }
  });
  return count;
}

function getDirectorySizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let size = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirectorySizeBytes(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  });
  return size;
}

function copyDirectoryRecursive(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  entries.forEach((entry) => {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  });
}

function createBackupZip({ stagingDir, zipPath, manifest }) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(stagingDir, false);
    archive.finalize();
  });
}

function prepareStagingDirectory(stagingDir) {
  const dbDir = path.join(stagingDir, 'database');
  const uploadsDir = path.join(stagingDir, 'uploads');
  fs.mkdirSync(dbDir, { recursive: true });
  copyDirectoryRecursive(UPLOADS_DIR, uploadsDir);

  const uploadsFileCount = countFilesRecursive(uploadsDir);
  const uploadsSizeBytes = getDirectorySizeBytes(uploadsDir);

  return { dbDir, uploadsFileCount, uploadsSizeBytes };
}

module.exports = {
  countFilesRecursive,
  getDirectorySizeBytes,
  createBackupZip,
  prepareStagingDirectory,
};
