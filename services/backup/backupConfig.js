const path = require('path');
const { DATA_DIR } = require('../../config/paths');

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function getBackupConfig() {
  const backupDir = path.join(DATA_DIR, 'backups');
  return {
    enabled: process.env.BACKUP_ENABLED !== 'false',
    intervalHours: parsePositiveInt(process.env.BACKUP_INTERVAL_HOURS, 6),
    keepLocalCount: parsePositiveInt(process.env.BACKUP_KEEP_LOCAL, 14),
    backupDir,
    s3: {
      enabled: Boolean(process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_ACCESS_KEY),
      endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
      region: process.env.BACKUP_S3_REGION || 'ru-1',
      bucket: process.env.BACKUP_S3_BUCKET || '',
      accessKey: process.env.BACKUP_S3_ACCESS_KEY || '',
      secretKey: process.env.BACKUP_S3_SECRET_KEY || '',
      prefix: process.env.BACKUP_S3_PREFIX || 'reestrpro/',
    },
    webhookUrl: process.env.BACKUP_WEBHOOK_URL || '',
    telegram: {
      botToken: process.env.BACKUP_TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.BACKUP_TELEGRAM_CHAT_ID || '',
    },
  };
}

module.exports = { getBackupConfig };
