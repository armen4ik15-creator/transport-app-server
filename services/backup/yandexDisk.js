/**
 * Upload backup ZIP to Yandex Disk via REST API.
 * Requires OAuth token with disk:write (YANDEX_DISK_TOKEN).
 */
const fs = require('fs');

const API = 'https://cloud-api.yandex.net/v1/disk';

async function yandexRequest(token, method, urlPath, options = {}) {
  const response = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `OAuth ${token}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.description || text || `HTTP ${response.status}`;
    const error = new Error(`Yandex Disk ${method} ${urlPath} -> ${response.status}: ${message}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function ensureFolder(token, folderPath) {
  const normalized = String(folderPath || '/ReestrPro/backups').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  let current = '';

  for (const part of parts) {
    current += `/${part}`;
    try {
      await yandexRequest(
        token,
        'PUT',
        `/resources?path=${encodeURIComponent(current)}`
      );
    } catch (error) {
      // 409 = already exists
      if (error.status !== 409) throw error;
    }
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

async function uploadFileToYandexDisk({
  token,
  localFilePath,
  remoteFolder = '/ReestrPro/backups',
  filename,
}) {
  if (!token) {
    return { uploaded: false, reason: 'yandex_token_not_configured' };
  }
  if (!fs.existsSync(localFilePath)) {
    throw new Error('Local backup file not found for Yandex upload');
  }

  const folder = await ensureFolder(token, remoteFolder);
  const remotePath = `${folder.replace(/\/$/, '')}/${filename}`;

  const uploadInfo = await yandexRequest(
    token,
    'GET',
    `/resources/upload?path=${encodeURIComponent(remotePath)}&overwrite=true`
  );

  if (!uploadInfo?.href) {
    throw new Error('Yandex Disk did not return upload href');
  }

  const fileBuffer = fs.readFileSync(localFilePath);
  const putResponse = await fetch(uploadInfo.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(fileBuffer.length),
    },
    body: fileBuffer,
  });

  if (!putResponse.ok && putResponse.status !== 201 && putResponse.status !== 202) {
    const errText = await putResponse.text().catch(() => '');
    throw new Error(`Yandex Disk PUT failed: ${putResponse.status} ${errText}`);
  }

  return {
    uploaded: true,
    path: remotePath,
    sizeBytes: fileBuffer.length,
  };
}

module.exports = {
  uploadFileToYandexDisk,
  ensureFolder,
};
