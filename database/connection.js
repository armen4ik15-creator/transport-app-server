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

function getHostCandidates() {
  const hosts = [];
  const addHost = (value) => {
    const host = String(value || '').trim();
    if (host && !hosts.includes(host)) {
      hosts.push(host);
    }
  };

  addHost(process.env.DB_HOST);
  for (const host of String(process.env.DB_FALLBACK_HOSTS || '').split(',')) {
    addHost(host);
  }
  return hosts;
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
