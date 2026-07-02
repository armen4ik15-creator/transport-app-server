const crypto = require('crypto');

const NOISE_KEYS = ['_meta', '_trace', '_ctx', '_sync'];

function randomHex(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function attachNoiseFields(payload) {
  if (payload == null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload;

  const key = NOISE_KEYS[crypto.randomInt(0, NOISE_KEYS.length)];
  return {
    ...payload,
    [key]: {
      v: randomHex(4),
      ts: Date.now(),
      n: crypto.randomInt(1000, 9999),
    },
  };
}

function responseNoiseMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (String(req.path || '').startsWith('/uploads')) return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(attachNoiseFields(body));
  return next();
}

module.exports = { responseNoiseMiddleware, attachNoiseFields };
