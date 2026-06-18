const deasync = require('deasync');
const { Pool } = require('pg');
const { buildConnectionString, resolveSslConfig } = require('./connection');
const { normalizeSqlForPostgres } = require('./sqlNormalize');
const { SCHEMA_SQL } = require('./postgresSchema');
const { seedDefaultAdmin, seedFounderAdmin } = require('./seedUsers');
const { createFailedAdapter } = require('./failed');

let txClient = null;

function waitPromise(promise) {
  let finished = false;
  let result;
  let error;
  promise
    .then((value) => {
      result = value;
      finished = true;
    })
    .catch((err) => {
      error = err;
      finished = true;
    });
  deasync.loopWhile(() => !finished);
  if (error) throw error;
  return result;
}

function createStatement(pool, sql) {
  const pgSql = normalizeSqlForPostgres(sql);

  return {
    get(...params) {
      const client = txClient || pool;
      const res = waitPromise(client.query(pgSql, params));
      return res.rows[0];
    },
    all(...params) {
      const client = txClient || pool;
      const res = waitPromise(client.query(pgSql, params));
      return res.rows;
    },
    run(...params) {
      const client = txClient || pool;
      const res = waitPromise(client.query(pgSql, params));
      const insertedId = res.rows[0]?.id;
      return {
        lastInsertRowid: insertedId != null ? Number(insertedId) : undefined,
        changes: res.rowCount,
      };
    },
  };
}

function createDbFacade(pool) {
  return {
    kind: 'postgres',
    pool,
    prepare(sql) {
      return createStatement(pool, sql);
    },
    transaction(fn) {
      const client = waitPromise(pool.connect());
      txClient = client;
      try {
        waitPromise(client.query('BEGIN'));
        const result = fn();
        waitPromise(client.query('COMMIT'));
        return result;
      } catch (error) {
        waitPromise(client.query('ROLLBACK'));
        throw error;
      } finally {
        txClient = null;
        client.release();
      }
    },
    ping() {
      waitPromise(pool.query('SELECT 1'));
      return true;
    },
  };
}

function seedAdmin(db) {
  seedDefaultAdmin(db);
  seedFounderAdmin(db);
}

function setupPostgresPool(pool) {
  return (async () => {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(991001)');
      await client.query(SCHEMA_SQL);
      const db = createDbFacade(pool);
      seedAdmin(db);
      return db;
    } finally {
      await client.query('SELECT pg_advisory_unlock(991001)').catch(() => {});
      client.release();
    }
  })();
}

function isRetryablePostgresError(error) {
  return (
    error.code === 'EAI_AGAIN' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNREFUSED' ||
    error.code === '40P01'
  );
}
function waitMs(ms) {
  const start = Date.now();
  deasync.loopWhile(() => Date.now() - start < ms);
}

function init(options = {}) {
  const fastStartup = options.fastStartup !== false;
  const connectionString = buildConnectionString();
  if (!connectionString) {
    throw new Error('PostgreSQL: DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD required');
  }

  const safeHost = connectionString.replace(/:[^:@/]+@/, ':***@');
  console.log(`[data] Connecting to PostgreSQL: ${safeHost}`);

  if (fastStartup) {
    console.log('[data] PostgreSQL sync init skipped — connecting in background');
    return createFailedAdapter(new Error('PostgreSQL connecting in background'));
  }

  const maxAttempts = Number(process.env.DB_INIT_RETRIES || 8);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const pool = new Pool({
      connectionString,
      ssl: resolveSslConfig(connectionString),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });

    pool.on('error', (err) => {
      console.error('[data] PostgreSQL pool error:', err.message);
    });

    try {
      waitPromise(pool.query('SELECT 1'));
      const db = waitPromise(setupPostgresPool(pool));
      console.log('[data] PostgreSQL connected');
      return db;
    } catch (error) {
      lastError = error;
      pool.end().catch(() => {});
      const retryable = isRetryablePostgresError(error);
      if (!retryable || attempt === maxAttempts) {
        console.error('[data] PostgreSQL init failed:', error.message);
        return createFailedAdapter(error);
      }
      const delayMs = attempt * 2000;
      console.warn(
        `[data] PostgreSQL init attempt ${attempt}/${maxAttempts} failed (${error.code || error.message}), retry in ${delayMs}ms`
      );
      waitMs(delayMs);
    }
  }

  return createFailedAdapter(lastError || new Error('PostgreSQL init failed'));
}

async function reconnectInBackground(onConnected) {
  const connectionString = buildConnectionString();
  if (!connectionString) return;

  const maxAttempts = Number(process.env.DB_BACKGROUND_RETRIES || 60);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const pool = new Pool({
      connectionString,
      ssl: resolveSslConfig(connectionString),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    try {
      await pool.query('SELECT 1');
      const db = await setupPostgresPool(pool);
      onConnected(db);
      return;
    } catch (error) {
      lastError = error;
      pool.end().catch(() => {});
      if (!isRetryablePostgresError(error) && attempt === maxAttempts) {
        console.error('[data] PostgreSQL background reconnect failed:', error.message);
        setTimeout(() => reconnectInBackground(onConnected), 30000);
        return;
      }
      const delayMs = Math.min(attempt * 2000, 15000);
      console.warn(
        `[data] PostgreSQL background retry ${attempt}/${maxAttempts} failed (${error.code || error.message}), next in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.error('[data] PostgreSQL background reconnect gave up:', lastError?.message);
  setTimeout(() => reconnectInBackground(onConnected), 30000);
}

module.exports = { init, reconnectInBackground };
