const deasync = require('deasync');
const { Pool } = require('pg');
const { buildConnectionString, resolveSslConfig } = require('./connection');
const { normalizeSqlForPostgres } = require('./sqlNormalize');
const { SCHEMA_SQL } = require('./postgresSchema');
const { seedDefaultAdmin, seedFounderAdmin } = require('./seedUsers');

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

function init() {
  const connectionString = buildConnectionString();
  if (!connectionString) {
    throw new Error('PostgreSQL: DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD required');
  }

  const safeHost = connectionString.replace(/:[^:@/]+@/, ':***@');
  console.log(`[data] Connecting to PostgreSQL: ${safeHost}`);

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
    const db = createDbFacade(pool);
    waitPromise(pool.query(SCHEMA_SQL));
    seedAdmin(db);
    console.log('[data] PostgreSQL connected');
    return db;
  } catch (error) {
    console.error('[data] PostgreSQL init failed:', error.message);
    throw error;
  }
}

module.exports = { init };
