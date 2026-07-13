const { createS3Client, uploadFileToS3 } = require('../../config/s3');
const { uploadFileToYandexDisk } = require('./yandexDisk');

async function uploadToS3(config, filePath, objectKey) {
  if (!config.s3.enabled) {
    return { uploaded: false, reason: 's3_not_configured' };
  }

  const client = createS3Client(config.s3);
  if (!client) {
    return { uploaded: false, reason: 's3_not_configured' };
  }

  await uploadFileToS3({
    client,
    bucket: config.s3.bucket,
    key: objectKey,
    filePath,
  });

  return { uploaded: true, bucket: config.s3.bucket, key: objectKey };
}

async function uploadToYandex(config, backupMeta) {
  if (!config.yandexDisk?.enabled) {
    return { uploaded: false, reason: 'yandex_not_configured' };
  }

  return uploadFileToYandexDisk({
    token: config.yandexDisk.token,
    localFilePath: backupMeta.filePath,
    remoteFolder: config.yandexDisk.folder,
    filename: backupMeta.filename,
  });
}

async function postWebhook(config, payload) {
  if (!config.webhookUrl) {
    return { sent: false, reason: 'webhook_not_configured' };
  }

  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook responded with ${response.status}`);
  }

  return { sent: true };
}

async function notifyTelegram(config, message) {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    return { sent: false, reason: 'telegram_not_configured' };
  }

  const textUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(textUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }

  return { sent: true };
}

async function uploadBackupRemote(config, backupMeta) {
  const results = {};
  const objectKey = `${config.s3.prefix}${backupMeta.filename}`;

  try {
    results.s3 = await uploadToS3(config, backupMeta.filePath, objectKey);
  } catch (error) {
    results.s3 = { uploaded: false, error: error.message };
  }

  try {
    results.yandex = await uploadToYandex(config, backupMeta);
  } catch (error) {
    results.yandex = { uploaded: false, error: error.message };
    console.warn('[backup] Yandex Disk upload failed:', error.message);
  }

  try {
    results.webhook = await postWebhook(config, {
      event: 'backup_completed',
      ...backupMeta,
      remote_key: results.s3?.key,
      yandex_path: results.yandex?.path,
    });
  } catch (error) {
    results.webhook = { sent: false, error: error.message };
  }

  try {
    const yandexLine = results.yandex?.uploaded
      ? `\nYandex: ${results.yandex.path}`
      : results.yandex?.error
        ? `\nYandex: ошибка (${results.yandex.error})`
        : '';
    results.telegram = await notifyTelegram(
      config,
      `ReestrPro backup\n${backupMeta.filename}\n${Math.round(backupMeta.sizeBytes / 1024 / 1024)} MB${yandexLine}`
    );
  } catch (error) {
    results.telegram = { sent: false, error: error.message };
  }

  return results;
}

module.exports = { uploadBackupRemote };
