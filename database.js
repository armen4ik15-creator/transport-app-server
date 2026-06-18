const { isPostgresEnabled, getPostgresEnvDiagnostics } = require('./database/connection');

function createDatabase() {
  const env = getPostgresEnvDiagnostics();
  console.log('[data] Database env:', env);
  if (env.DB_PASSWORD) {
    console.log('[data] DB_PASSWORD length:', String(process.env.DB_PASSWORD).length);
  }

  if (isPostgresEnabled()) {
    return require('./database/postgres').init();
  }
  console.log('[data] PostgreSQL not configured — using SQLite fallback');
  return require('./database/sqlite').init();
}

let db;
try {
  db = createDatabase();
} catch (error) {
  console.error('[data] Fatal database setup:', error.message);
  db = require('./database/failed').createFailedAdapter(error);
}

module.exports = db;
