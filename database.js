const { isPostgresEnabled, getPostgresEnvDiagnostics } = require('./database/connection');

const dbState = { current: null };

function createDatabase() {
  const env = getPostgresEnvDiagnostics();
  console.log('[data] Database env:', env);
  if (env.DB_PASSWORD) {
    console.log('[data] DB_PASSWORD length:', String(process.env.DB_PASSWORD).length);
  }

  if (isPostgresEnabled()) {
    return require('./database/postgres').init({ fastStartup: true });
  }
  console.log('[data] PostgreSQL not configured — using SQLite fallback');
  return require('./database/sqlite').init();
}

try {
  dbState.current = createDatabase();
} catch (error) {
  console.error('[data] Fatal database setup:', error.message);
  dbState.current = require('./database/failed').createFailedAdapter(error);
}

function getDb() {
  return dbState.current;
}

function setDb(nextDb) {
  dbState.current = nextDb;
}

function startBackgroundReconnect() {
  if (!isPostgresEnabled()) return;
  const db = getDb();
  if (db.kind === 'postgres') return;

  require('./database/postgres').reconnectInBackground((nextDb) => {
    setDb(nextDb);
    console.log('[data] PostgreSQL connected (background retry)');
    try {
      const { ensureTripSchema } = require('./routes/trips');
      if (typeof ensureTripSchema === 'function') {
        ensureTripSchema();
      }
    } catch (error) {
      console.warn('[data] post-reconnect schema migration skipped:', error.message);
    }
  });
}

const dbProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'getDb') return getDb;
      if (prop === 'setDb') return setDb;
      if (prop === 'startBackgroundReconnect') return startBackgroundReconnect;

      const db = getDb();
      const value = db[prop];
      if (typeof value === 'function') {
        return value.bind(db);
      }
      return value;
    },
  }
);

module.exports = dbProxy;
