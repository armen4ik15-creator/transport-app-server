function buildConnectionString(hostOverride) {
  if (process.env.DATABASE_URL && !hostOverride) {
    return process.env.DATABASE_URL;
  }
  const host = hostOverride || process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME || 'default_db';
  const port = process.env.DB_PORT || '5432';
  if (!host || !user || !password) {
    return null;
  }
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const timeoutSec = Number(process.env.DB_CONNECT_TIMEOUT_SEC || 10);
  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}?connect_timeout=${timeoutSec}`;
}

function isPrivateHost(host) {
  return /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(String(host || '').trim());
}

function getHostCandidates() {
  const privateHosts = [];
  const publicHosts = [];
  const addHost = (bucket, value) => {
    const host = String(value || '').trim();
    if (!host || bucket.includes(host)) return;
    bucket.push(host);
  };

  addHost(isPrivateHost(process.env.DB_HOST) ? privateHosts : publicHosts, process.env.DB_HOST);
  for (const host of String(process.env.DB_FALLBACK_HOSTS || '').split(',')) {
    addHost(isPrivateHost(host) ? privateHosts : publicHosts, host);
  }

  // App Platform Express часто не имеет стабильного маршрута до private IP БД.
  // Сначала пробуем public (с SSL), затем private.
  const preferPrivate = process.env.DB_PREFER_PRIVATE === 'true';
  return preferPrivate ? [...privateHosts, ...publicHosts] : [...publicHosts, ...privateHosts];
}

function resolveSslConfig(connectionString) {
  if (process.env.DATABASE_SSL === 'false') {
    return false;
  }
  if (/sslmode=disable/i.test(connectionString || '')) {
    return false;
  }
  if (process.env.PGSSLROOTCERT) {
    const fs = require('fs');
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'),
    };
  }
  return { rejectUnauthorized: false };
}

function isPostgresEnabled() {
  return Boolean(buildConnectionString());
}

function getPostgresEnvDiagnostics() {
  return {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    DB_HOST: Boolean(process.env.DB_HOST),
    DB_USER: Boolean(process.env.DB_USER),
    DB_PASSWORD: Boolean(process.env.DB_PASSWORD),
    DB_NAME: Boolean(process.env.DB_NAME),
    postgres_configured: isPostgresEnabled(),
  };
}

module.exports = {
  buildConnectionString,
  getHostCandidates,
  resolveSslConfig,
  isPostgresEnabled,
  getPostgresEnvDiagnostics,
};
