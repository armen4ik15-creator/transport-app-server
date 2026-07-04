const crypto = require('crypto');
const db = require('../database');

const SIGNATURE_HEADER = 'x-request-signature';
const DEVICE_ID_HEADER = 'x-device-id';
const TIMESTAMP_HEADER = 'x-request-timestamp';
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

const HMAC_EXCLUDED_PREFIXES = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/security-config',
  '/api/auth/migrate-founder',
  '/api/auth/reset-device',
  '/api/device/register',
  '/api/heartbeat',
];

function isExcludedPath(path) {
  const normalized = String(path || '').split('?')[0];
  return HMAC_EXCLUDED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

function normalizeBodyForSigning(body) {
  if (body == null || body === '') return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) {
    return '';
  }
  try {
    return JSON.stringify(body);
  } catch {
    return '';
  }
}

function buildSignaturePayload(req, timestamp, bodyString) {
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return `${timestamp}.${method}.${path}.${bodyString}`;
}

function computeSignature(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifySignature(secret, payload, signature) {
  const expected = computeSignature(secret, payload);
  const provided = String(signature || '').trim().toLowerCase();
  if (!provided || expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

/**
 * Кандидаты канонизации тела запроса.
 * Разные версии клиентского бандла подписывали тело по-разному
 * (точный wire-payload rawBody vs ре-сериализация JSON.stringify(req.body)).
 * Подпись считается валидной, если совпала хотя бы с одним кандидатом —
 * это устраняет рассинхрон версий, не ослабляя защиту (секрет по-прежнему обязателен).
 */
function buildBodyStringCandidates(req, isMultipart) {
  if (isMultipart) return [''];
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
  const normalized = normalizeBodyForSigning(req.body);
  const candidates = [rawBody, normalized, ''];
  return [...new Set(candidates)];
}

function verifyAgainstCandidates(secret, req, timestamp, bodyStrings, signature) {
  for (const bodyString of bodyStrings) {
    const payload = buildSignaturePayload(req, timestamp, bodyString);
    if (verifySignature(secret, payload, signature)) {
      return { matched: true, bodyString, payload };
    }
  }
  return { matched: false, bodyString: null, payload: null };
}

function parseTimestamp(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

/** Отладочный лог расхождения подписи (включается env HMAC_DEBUG=1). */
function logSignatureMismatch(req, row, timestamp, bodyStrings, signature, isMultipart) {
  const provided = String(signature || '').trim().toLowerCase();
  const rawBodyLen = typeof req.rawBody === 'string' ? req.rawBody.length : -1;
  const expectedByCandidate = bodyStrings.map((bodyString, index) => {
    const payload = buildSignaturePayload(req, timestamp, bodyString);
    return {
      index,
      bodyPreview: bodyString.slice(0, 120),
      expected: computeSignature(row.secret, payload).slice(0, 16),
    };
  });
  console.warn(
    '[hmac][MISMATCH]',
    JSON.stringify({
      method: req.method,
      path: String(req.originalUrl || req.url || '').split('?')[0],
      contentType: req.headers['content-type'] || null,
      isMultipart,
      rawBodyLen,
      deviceUserId: row.user_id,
      reqUserId: req.user ? req.user.id : null,
      appVersion: row.app_version || null,
      platform: row.platform || null,
      timestamp,
      providedPrefix: provided.slice(0, 16),
      candidates: expectedByCandidate,
    })
  );
}

function hmacMiddleware(req, res, next) {
  if (isExcludedPath(req.originalUrl || req.url)) {
    return next();
  }

  const deviceId = String(req.headers[DEVICE_ID_HEADER] || '').trim();
  if (!deviceId) {
    return next();
  }

  const row = db
    .prepare(
      `SELECT id, user_id, secret, blocked, block_reason, app_version, platform
       FROM device_secrets
       WHERE device_id = ?`
    )
    .get(deviceId);

  if (!row) {
    return res.status(403).json({
      error: 'Устройство не зарегистрировано',
      blocked: true,
      code: 'DEVICE_NOT_REGISTERED',
    });
  }

  if (Number(row.blocked) === 1) {
    return res.status(403).json({
      error: row.block_reason || 'Доступ с этого устройства заблокирован',
      blocked: true,
      code: 'DEVICE_BLOCKED',
    });
  }

  if (req.user && Number(row.user_id) !== Number(req.user.id)) {
    return res.status(403).json({
      error: 'Устройство привязано к другому пользователю',
      blocked: true,
      code: 'DEVICE_USER_MISMATCH',
    });
  }

  const timestamp = parseTimestamp(req.headers[TIMESTAMP_HEADER]);
  if (timestamp == null) {
    return res.status(403).json({ error: 'Отсутствует метка времени запроса', code: 'HMAC_TIMESTAMP' });
  }

  const skew = Math.abs(Date.now() - timestamp);
  if (skew > MAX_TIMESTAMP_SKEW_MS) {
    return res.status(403).json({ error: 'Метка времени запроса недействительна', code: 'HMAC_TIMESTAMP' });
  }

  const signature = req.headers[SIGNATURE_HEADER];
  const isMultipart = String(req.headers['content-type'] || '').includes('multipart/form-data');
  const bodyStrings = buildBodyStringCandidates(req, isMultipart);
  const { matched } = verifyAgainstCandidates(row.secret, req, timestamp, bodyStrings, signature);

  if (!matched) {
    if (process.env.HMAC_DEBUG === '1') {
      logSignatureMismatch(req, row, timestamp, bodyStrings, signature, isMultipart);
    }
    return res.status(403).json({ error: 'Неверная подпись запроса', code: 'HMAC_INVALID' });
  }

  req.device = {
    id: deviceId,
    userId: row.user_id,
    recordId: row.id,
  };

  return next();
}

module.exports = { hmacMiddleware, isExcludedPath, buildSignaturePayload, verifySignature };
