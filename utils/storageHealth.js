const fs = require('fs');
const path = require('path');
const { DATA_DIR, UPLOADS_DIR } = require('../config/paths');
const { getBackupConfig } = require('../services/backup/backupConfig');
const { countFilesRecursive, getDirectorySizeBytes } = require('../services/backup/backupArchiver');

function getStorageHealth() {
  const backupConfig = getBackupConfig();
  const backupDir = backupConfig.backupDir;
  const backups = fs.existsSync(backupDir)
    ? fs
        .readdirSync(backupDir)
        .filter((name) => name.startsWith('reestrpro-backup-') && name.endsWith('.zip'))
    : [];

  const uploadsFileCount = countFilesRecursive(UPLOADS_DIR);
  const uploadsSizeBytes = getDirectorySizeBytes(UPLOADS_DIR);
  const backupSizeBytes = getDirectorySizeBytes(backupDir);

  let dataDirWritable = false;
  try {
    const probe = path.join(DATA_DIR, '.write-probe');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    dataDirWritable = true;
  } catch {
    dataDirWritable = false;
  }

  const warnings = [];
  if (!dataDirWritable) {
    warnings.push('DATA_DIR недоступен для записи — uploads и локальные бэкапы не сохранятся');
  }
  if (uploadsFileCount === 0) {
    warnings.push('Папка uploads пуста — проверьте volume /data на Timeweb');
  }
  if (!backupConfig.s3.enabled) {
    warnings.push('S3 не настроен — off-site бэкапы отключены');
  }
  if (backups.length === 0) {
    warnings.push('Локальных ZIP-бэкапов нет — запустите POST /api/backups/run');
  }

  return {
    data_dir: DATA_DIR,
    data_dir_writable: dataDirWritable,
    uploads_dir: UPLOADS_DIR,
    uploads_file_count: uploadsFileCount,
    uploads_size_bytes: uploadsSizeBytes,
    backup_dir: backupDir,
    backup_file_count: backups.length,
    backup_size_bytes: backupSizeBytes,
    backup_enabled: backupConfig.enabled,
    backup_interval_hours: backupConfig.intervalHours,
    remote: {
      s3: backupConfig.s3.enabled,
      webhook: Boolean(backupConfig.webhookUrl),
      telegram: Boolean(backupConfig.telegram.botToken && backupConfig.telegram.chatId),
    },
    warnings,
    healthy: warnings.length === 0,
  };
}

module.exports = { getStorageHealth };
