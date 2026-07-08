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
  '/api/public',
  '/downloads',
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
  if (isMultipart) {
    // Актуальный клиент подписывает multipart пустым телом.
    // Старые бандлы (<=487d633) подписывали JSON.stringify(FormData) с локальным file://-URI фото,
    // который сервер не видит и воспроизвести не может — такие подписи чинятся только обновлением клиента.
    return [''];
  }
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
  const normalized = normalizeBodyForSigning(req.body);
  const candidates = [rawBody, normalized, ''];
  return [...new Set(candidates)];
}

/** Диагностика: перебор комбинаций метода/пути/тела, чтобы понять, что именно подписал клиент. */
function bruteForceSignature(secret, req, timestamp, signature) {
  const provided = String(signature || '').trim().toLowerCase();
  const reqPath = String(req.originalUrl || req.url || '').split('?')[0];
  const fullUrl = String(req.originalUrl || req.url || '');
  const methods = ['POST', 'GET', 'PUT', 'PATCH', 'post', 'get'];
  const paths = [
    ...new Set([
      reqPath,
      `${reqPath}/`,
      fullUrl,
      reqPath.replace(/^\/api/, ''),
      `/api${reqPath}`,
    ]),
  ];
  const bodies = ['', '{}', 'null', 'undefined', '[object Object]', '[object FormData]'];
  const timestamps = [timestamp, String(timestamp)];
  for (const m of methods) {
    for (const p of paths) {
      for (const b of bodies) {
        for (const t of timestamps) {
          const payload = `${t}.${m}.${p}.${b}`;
          const expected = computeSignature(secret, payload);
          if (expected.toLowerCase() === provided) {
            return { method: m, path: p, body: b, tsType: typeof t };
          }
        }
      }
    }
  }
  return null;
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

/** Кольцевой буфер последних HMAC-решений (только при HMAC_DEBUG=1). */
const recentHmacEvents = [];
const MAX_HMAC_EVENTS = 80;

function recordHmacEvent(evt) {
  if (process.env.HMAC_DEBUG !== '1') return;
  recentHmacEvents.push({ at: new Date().toISOString(), ...evt });
  if (recentHmacEvents.length > MAX_HMAC_EVENTS) recentHmacEvents.shift();
}

function getRecentHmacEvents() {
  return recentHmacEvents;
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
  const reqPath = String(req.originalUrl || req.url || '').split('?')[0];
  const method = String(req.method || 'GET').toUpperCase();

  if (isExcludedPath(req.originalUrl || req.url)) {
    return next();
  }

  const deviceId = String(req.headers[DEVICE_ID_HEADER] || '').trim();
  const hasSignature = Boolean(req.headers[SIGNATURE_HEADER]);
  if (!deviceId) {
    recordHmacEvent({ outcome: 'no_device_id', method, path: reqPath, hasSignature, reqUserId: req.user ? req.user.id : null });
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
    recordHmacEvent({ outcome: 'device_not_registered', method, path: reqPath, deviceId, hasSignature, reqUserId: req.user ? req.user.id : null });
    return res.status(403).json({
      error: 'Устройство не зарегистрировано',
      blocked: true,
      code: 'DEVICE_NOT_REGISTERED',
    });
  }

  if (Number(row.blocked) === 1) {
    recordHmacEvent({ outcome: 'device_blocked', method, path: reqPath, deviceId, deviceUserId: row.user_id, reqUserId: req.user ? req.user.id : null });
    return res.status(403).json({
      error: row.block_reason || 'Доступ с этого устройства заблокирован',
      blocked: true,
      code: 'DEVICE_BLOCKED',
    });
  }

  if (req.user && Number(row.user_id) !== Number(req.user.id)) {
    recordHmacEvent({ outcome: 'user_mismatch', method, path: reqPath, deviceId, deviceUserId: row.user_id, reqUserId: req.user.id, appVersion: row.app_version });
    return res.status(403).json({
      error: 'Устройство привязано к другому пользователю',
      blocked: true,
      code: 'DEVICE_USER_MISMATCH',
    });
  }

  const timestamp = parseTimestamp(req.headers[TIMESTAMP_HEADER]);
  if (timestamp == null) {
    recordHmacEvent({ outcome: 'timestamp_missing', method, path: reqPath, deviceId, deviceUserId: row.user_id, hasSignature });
    return res.status(403).json({ error: 'Отсутствует метка времени запроса', code: 'HMAC_TIMESTAMP' });
  }

  const skew = Math.abs(Date.now() - timestamp);
  if (skew > MAX_TIMESTAMP_SKEW_MS) {
    recordHmacEvent({ outcome: 'timestamp_skew', method, path: reqPath, deviceId, deviceUserId: row.user_id, skewMs: skew });
    return res.status(403).json({ error: 'Метка времени запроса недействительна', code: 'HMAC_TIMESTAMP' });
  }

  const signature = req.headers[SIGNATURE_HEADER];
  const isMultipart = String(req.headers['content-type'] || '').includes('multipart/form-data');
  const bodyStrings = buildBodyStringCandidates(req, isMultipart);
  const { matched, bodyString: matchedBody } = verifyAgainstCandidates(
    row.secret,
    req,
    timestamp,
    bodyStrings,
    signature
  );

  if (!matched) {
    const brute = process.env.HMAC_DEBUG === '1'
      ? bruteForceSignature(row.secret, req, timestamp, signature)
      : null;
    recordHmacEvent({
      outcome: 'invalid_signature',
      method,
      path: reqPath,
      deviceId,
      deviceUserId: row.user_id,
      reqUserId: req.user ? req.user.id : null,
      isMultipart,
      contentType: req.headers['content-type'] || null,
      rawBodyLen: typeof req.rawBody === 'string' ? req.rawBody.length : -1,
      candidateCount: bodyStrings.length,
      appVersion: row.app_version,
      hasSignature,
      brute,
    });
    if (process.env.HMAC_DEBUG === '1') {
      logSignatureMismatch(req, row, timestamp, bodyStrings, signature, isMultipart);
    }
    return res.status(403).json({ error: 'Неверная подпись запроса', code: 'HMAC_INVALID' });
  }

  recordHmacEvent({
    outcome: 'ok',
    method,
    path: reqPath,
    deviceId,
    deviceUserId: row.user_id,
    isMultipart,
    matchedBody: JSON.stringify(matchedBody),
  });

  req.device = {
    id: deviceId,
    userId: row.user_id,
    recordId: row.id,
  };

  return next();
}

module.exports = {
  hmacMiddleware,
  isExcludedPath,
  buildSignaturePayload,
  verifySignature,
  getRecentHmacEvents,
};
