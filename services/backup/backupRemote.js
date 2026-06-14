const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

async function uploadToS3(config, filePath, objectKey) {
  if (!config.s3.enabled) {
    return { uploaded: false, reason: 's3_not_configured' };
  }

  const client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint || undefined,
    forcePathStyle: Boolean(config.s3.endpoint),
    credentials: {
      accessKeyId: config.s3.accessKey,
      secretAccessKey: config.s3.secretKey,
    },
  });

  const body = fs.createReadStream(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey,
      Body: body,
      ContentType: 'application/zip',
    })
  );

  return { uploaded: true, bucket: config.s3.bucket, key: objectKey };
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
    results.webhook = await postWebhook(config, {
      event: 'backup_completed',
      ...backupMeta,
      remote_key: results.s3?.key,
    });
  } catch (error) {
    results.webhook = { sent: false, error: error.message };
  }

  try {
    results.telegram = await notifyTelegram(
      config,
      `ReestrPro backup\n${backupMeta.filename}\n${Math.round(backupMeta.sizeBytes / 1024 / 1024)} MB`
    );
  } catch (error) {
    results.telegram = { sent: false, error: error.message };
  }

  return results;
}

module.exports = { uploadBackupRemote };
