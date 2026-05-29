const { isPostgresEnabled, getPostgresEnvDiagnostics } = require('./database/connection');

function createDatabase() {
  const env = getPostgresEnvDiagnostics();
  console.log('[data] Database env:', env);

  if (isPostgresEnabled()) {
    return require('./database/postgres').init();
  }
  console.log('[data] PostgreSQL not configured — using SQLite fallback');
  return require('./database/sqlite').init();
}

const db = createDatabase();

module.exports = db;
