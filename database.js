const { isPostgresEnabled, getPostgresEnvDiagnostics } = require('./database/connection');

const dbState = { current: null, lastReconnectError: null };
let reconnectStarted = false;

function createDatabase() {
  const env = getPostgresEnvDiagnostics();
  console.log('[data] Database env:', env);
  if (env.DB_PASSWORD) {
    console.log('[data] DB_PASSWORD length:', String(process.env.DB_PASSWORD).length);
  }

  if (isPostgresEnabled()) {
    const fastStartup =
      options.fastStartup !== undefined
        ? options.fastStartup
        : process.env.DB_FAST_STARTUP !== 'false';
    return require('./database/postgres').init({ fastStartup });
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

function connectPostgresWithRetries() {
  if (!isPostgresEnabled()) return getDb();
  if (getDb().kind === 'postgres') return getDb();

  console.log('[data] Connecting to PostgreSQL (post-boot sync)...');
  const nextDb = require('./database/postgres').init({ fastStartup: false });
  setDb(nextDb);
  return nextDb;
}

function startBackgroundReconnect() {
  if (reconnectStarted) return;
  if (!isPostgresEnabled()) return;
  const db = getDb();
  if (db.kind === 'postgres') return;
  reconnectStarted = true;

  require('./database/postgres').reconnectInBackground(
    (nextDb) => {
      setDb(nextDb);
      dbState.lastReconnectError = null;
      console.log('[data] PostgreSQL connected (background retry)');
      try {
        const { ensureTripSchema } = require('./routes/trips');
        if (typeof ensureTripSchema === 'function') {
          ensureTripSchema();
        }
      } catch (error) {
        console.warn('[data] post-reconnect schema migration skipped:', error.message);
      }
      try {
        const { restartBackupScheduler } = require('./services/backup/backupScheduler');
        if (typeof restartBackupScheduler === 'function') {
          restartBackupScheduler();
        }
      } catch (error) {
        console.warn('[data] backup scheduler restart skipped:', error.message);
      }
    },
    (error) => {
      dbState.lastReconnectError = error;
      const db = getDb();
      if (db?.kind === 'postgres_error') {
        db.initError = error;
      }
    }
  );
}

const dbProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'getDb') return getDb;
      if (prop === 'setDb') return setDb;
      if (prop === 'startBackgroundReconnect') return startBackgroundReconnect;
      if (prop === 'connectPostgresWithRetries') return connectPostgresWithRetries;

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

if (dbState.current?.kind === 'postgres_error' && isPostgresEnabled()) {
  setImmediate(() => startBackgroundReconnect());
}
