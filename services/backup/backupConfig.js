const path = require('path');
const { DATA_DIR } = require('../../config/paths');
const { readS3Env } = require('../../config/s3');

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function getBackupConfig() {
  const backupDir = path.join(DATA_DIR, 'backups');
  const s3 = readS3Env();
  const cronSchedule = process.env.BACKUP_CRON_SCHEDULE || '0 3 * * *';

  return {
    enabled: process.env.BACKUP_ENABLED !== 'false',
    intervalHours: parsePositiveInt(process.env.BACKUP_INTERVAL_HOURS, 6),
    keepLocalCount: parsePositiveInt(process.env.BACKUP_KEEP_LOCAL, 14),
    keepLocalDays: parsePositiveInt(process.env.BACKUP_KEEP_DAYS, 7),
    cronSchedule,
    backupDir,
    s3: {
      enabled: s3.enabled,
      endpoint: s3.endpoint,
      region: s3.region,
      bucket: s3.bucket,
      accessKey: s3.accessKey,
      secretKey: s3.secretKey,
      prefix: s3.prefix,
    },
    restoreCode: process.env.BACKUP_RESTORE_CODE || process.env.PASSWORD_RESET_CODE || '',
    webhookUrl: process.env.BACKUP_WEBHOOK_URL || '',
    telegram: {
      botToken: process.env.BACKUP_TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.BACKUP_TELEGRAM_CHAT_ID || '',
    },
  };
}

module.exports = { getBackupConfig };
