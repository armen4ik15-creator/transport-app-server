const { isPostgresEnabled, getPostgresEnvDiagnostics } = require('./database/connection');

function createDatabase() {
  const env = getPostgresEnvDiagnostics();
  console.log('[data] Database env:', env);
  if (env.DB_PASSWORD) {
    console.log('[data] DB_PASSWORD length:', String(process.env.DB_PASSWORD).length);
  }

  if (isPostgresEnabled()) {
    try {
      return require('./database/postgres').init();
    } catch (error) {
      console.error('[data] PostgreSQL init failed:', error.message);
      console.error('[data] Server will start; fix DB_PASSWORD and redeploy.');
      return require('./database/failed').createFailedAdapter(error);
    }
  }
  console.log('[data] PostgreSQL not configured — using SQLite fallback');
  return require('./database/sqlite').init();
}

const db = createDatabase();

module.exports = db;
