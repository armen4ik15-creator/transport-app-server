const { normalizeUploadWebPath } = require('./uploadPaths');

const CACHE_TTL_MS = Number(process.env.UPLOAD_AVAIL_CACHE_TTL_MS) || 90_000;
const cache = new Map();

function getCachedAvailability(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return undefined;

  const entry = cache.get(normalized);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(normalized);
    return undefined;
  }
  return entry.value;
}

function setCachedAvailability(webPath, value) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return;
  cache.set(normalized, { value: Boolean(value), at: Date.now() });
}

function markUploadAvailable(webPath) {
  setCachedAvailability(webPath, true);
}

function invalidateUploadAvailability(webPath) {
  const normalized = normalizeUploadWebPath(webPath);
  if (!normalized) return;
  cache.delete(normalized);
}

module.exports = {
  getCachedAvailability,
  setCachedAvailability,
  markUploadAvailable,
  invalidateUploadAvailability,
};
