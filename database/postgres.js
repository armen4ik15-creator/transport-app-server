const deasync = require('deasync');
const { Pool } = require('pg');
const { buildConnectionString, getHostCandidates, resolveSslConfig } = require('./connection');
const { normalizeSqlForPostgres } = require('./sqlNormalize');
const { SCHEMA_SQL } = require('./postgresSchema');
const { seedAdminAsync } = require('./seedUsers');
const { createFailedAdapter } = require('./failed');

let txClient = null;

function waitPromise(promise, timeoutMs = Number(process.env.DB_QUERY_TIMEOUT_MS || 10000)) {
  let finished = false;
  let result;
  let error;

  const timeoutId = setTimeout(() => {
    if (finished) return;
    finished = true;
    error = Object.assign(new Error(`Database query timeout after ${timeoutMs}ms`), {
      code: 'ETIMEDOUT',
    });
  }, timeoutMs);

  promise
    .then((value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      result = value;
    })
    .catch((err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      error = err;
    });
  deasync.loopWhile(() => !finished);
  clearTimeout(timeoutId);
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

function attachPoolHandlers(pool) {
  pool.on('error', (err) => {
    console.error('[data] PostgreSQL pool error:', err.message);
  });
}

function createPoolConfig(connectionString, hostOverride) {
  const sessionOptions = '-c idle_session_timeout=0 -c idle_in_transaction_session_timeout=0';
  const host = hostOverride || process.env.DB_HOST || '';
  const usePrivateHost = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);

  const baseConfig = {
    max: Number(process.env.DB_POOL_MAX || 25),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };

  if (host && process.env.DB_USER && process.env.DB_PASSWORD) {
    return {
      ...baseConfig,
      host,
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'default_db',
      ssl: usePrivateHost ? false : resolveSslConfig(connectionString),
      options: sessionOptions,
    };
  }

  const separator = connectionString.includes('?') ? '&' : '?';
  const connectionWithSession = `${connectionString}${separator}options=${encodeURIComponent(sessionOptions)}`;

  return {
    connectionString: connectionWithSession,
    ssl: resolveSslConfig(connectionString),
    ...baseConfig,
  };
}

function setupPostgresPool(pool) {
  return (async () => {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(991001)');
      await client.query(SCHEMA_SQL);
      await seedAdminAsync(client);
      console.log('[data] PostgreSQL schema + seed complete (async)');
      return createDbFacade(pool);
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
    error.code === 'ENETUNREACH' ||
    error.code === 'EHOSTUNREACH' ||
    error.code === '40P01' ||
    error.code === '57P05' ||
    /idle-session timeout/i.test(error.message || '') ||
    /connection timeout/i.test(error.message || '')
  );
}

async function queryWithTimeout(pool, sql, timeoutMs = 12000) {
  let timer;
  const queryPromise = pool.query(sql);
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
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
  const hosts = getHostCandidates();
  if (hosts.length === 0) {
    return createFailedAdapter(new Error('PostgreSQL: no DB_HOST configured'));
  }

  for (const host of hosts) {
    console.log(`[data] PostgreSQL init trying host ${host}`);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const connectionString = buildConnectionString(host);
      const pool = new Pool(createPoolConfig(connectionString, host));
      attachPoolHandlers(pool);

      try {
        waitPromise(pool.query('SELECT 1'));
        const db = waitPromise(setupPostgresPool(pool));
        console.log(`[data] PostgreSQL connected via ${host}`);
        return db;
      } catch (error) {
        lastError = error;
        pool.end().catch(() => {});
        const retryable = isRetryablePostgresError(error);
        if (!retryable || attempt === maxAttempts) {
          console.error(`[data] PostgreSQL init failed on ${host}:`, error.message);
          break;
        }
        const delayMs = attempt * 2000;
        console.warn(
          `[data] PostgreSQL init ${host} attempt ${attempt}/${maxAttempts} failed (${error.code || error.message}), retry in ${delayMs}ms`
        );
        waitMs(delayMs);
      }
    }
  }

  console.error('[data] PostgreSQL init failed on all hosts:', lastError?.message);
  return createFailedAdapter(lastError || new Error('PostgreSQL init failed'));
}

async function reconnectInBackground(onConnected, onError) {
  const hostCandidates = getHostCandidates();
  if (hostCandidates.length === 0) return;

  console.log('[data] PostgreSQL background reconnect loop running');
  const attemptsPerHost = Number(process.env.DB_HOST_ATTEMPTS || 5);
  const maxRounds = Number(process.env.DB_BACKGROUND_RETRIES || 12);
  let lastError = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    for (const host of hostCandidates) {
      console.log(`[data] PostgreSQL trying host ${host} (round ${round}/${maxRounds})`);
      for (let attempt = 1; attempt <= attemptsPerHost; attempt += 1) {
        const connectionString = buildConnectionString(host);
        const pool = new Pool({
          ...createPoolConfig(connectionString, host),
          connectionTimeoutMillis: 10000,
        });
        attachPoolHandlers(pool);

        try {
          console.warn(
            `[data] PostgreSQL background retry ${attempt}/${attemptsPerHost} on ${host}`
          );
          await queryWithTimeout(pool, 'SELECT 1');
          const db = await setupPostgresPool(pool);
          onConnected(db);
          return;
        } catch (error) {
          lastError = error;
          if (typeof onError === 'function') onError(error);
          pool.end().catch(() => {});
          if (!isRetryablePostgresError(error) && attempt === attemptsPerHost) {
            console.error(
              `[data] PostgreSQL background reconnect failed on ${host}:`,
              error.message
            );
            break;
          }
          const delayMs = Math.min(attempt * 2000, 15000);
          console.warn(
            `[data] PostgreSQL background retry ${attempt}/${attemptsPerHost} on ${host} failed (${error.code || error.message}), next in ${delayMs}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  }

  console.error('[data] PostgreSQL background reconnect gave up:', lastError?.message);
  setTimeout(() => reconnectInBackground(onConnected, onError), 30000);
}

module.exports = { init, reconnectInBackground };
