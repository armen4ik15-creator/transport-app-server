const db = require('../../database');
const { createFuelDataSource } = require('./FuelDataSource');
const { getFuelSettings, markSyncResult } = require('./fuelSettings');

function getSystemAdminId() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  return admin?.id ?? null;
}

function listActiveFuelCards() {
  return db
    .prepare(
      `SELECT
         fc.id, fc.driver_id, fc.card_number, fc.label, fc.is_active,
         d.car_number,
         u.full_name AS driver_name
       FROM fuel_cards fc
       JOIN drivers d ON d.id = fc.driver_id
       JOIN users u ON u.id = d.user_id
       WHERE fc.is_active = 1 AND d.is_active = 1
       ORDER BY fc.id`
    )
    .all();
}

function transactionExists(externalId, cardNumber, transactionAt, amount) {
  const byExternal = db
    .prepare('SELECT id FROM fuel_transactions WHERE external_id = ?')
    .get(externalId);
  if (byExternal) return true;

  const byFingerprint = db
    .prepare(
      `SELECT id FROM fuel_transactions
       WHERE card_number = ? AND transaction_at = ? AND amount = ?`
    )
    .get(cardNumber, transactionAt, amount);
  return Boolean(byFingerprint);
}

function resolveDriverByCard(cardNumber) {
  const card = db
    .prepare(
      `SELECT fc.driver_id, d.car_number
       FROM fuel_cards fc
       JOIN drivers d ON d.id = fc.driver_id
       WHERE fc.card_number = ? AND fc.is_active = 1`
    )
    .get(cardNumber);
  return card || null;
}

function createExpenseFromTransaction(tx, driverId, carNumber, adminUserId) {
  const expDate = String(tx.transaction_at).slice(0, 10);
  const litersLabel = tx.liters != null ? `${tx.liters} л` : '';
  const externalId = String(tx.external_id || '').trim() || `${tx.card_number}-${tx.transaction_at}-${tx.amount}`;
  // Маркер [opti-fuel-...] обязателен для оценки баланса ТК в companyCash.
  // method=NULL: заправка списывается с баланса карты, р/с не трогает.
  const comment = `[opti-fuel-${externalId}] Opti: ${tx.station_name}${litersLabel ? `, ${litersLabel}` : ''}, карта ${tx.card_number}`;

  const result = db
    .prepare(
      `INSERT INTO expenses
       (exp_date, exp_type, method, amount, comment, driver_id, car_number, created_by,
        status, source, updated_at)
       VALUES (?, 'fuel', NULL, ?, ?, ?, ?, ?, 'approved', 'system', datetime('now'))`
    )
    .run(expDate, tx.amount, comment, driverId, carNumber, adminUserId);

  return result.lastInsertRowid;
}

function insertFuelTransaction(tx, driverId, carNumber, expenseId, source) {
  const result = db
    .prepare(
      `INSERT INTO fuel_transactions
       (external_id, source, card_number, driver_id, transaction_at, station_name,
        amount, liters, car_number, expense_id, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      tx.external_id,
      source,
      tx.card_number,
      driverId,
      tx.transaction_at,
      tx.station_name,
      tx.amount,
      tx.liters ?? null,
      carNumber,
      expenseId,
      tx.raw_payload ? JSON.stringify(tx.raw_payload) : null
    );
  return result.lastInsertRowid;
}

function insertSyncLog({ status, source, fetchedCount, createdCount, errorMessage }) {
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    `INSERT INTO fuel_sync_logs
     (started_at, finished_at, status, source, fetched_count, created_count, error_message)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?)`
  ).run(startedAt, status, source, fetchedCount || 0, createdCount || 0, errorMessage || null);
}

function notifyAdminsAboutSyncFailure(message) {
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  for (const admin of admins) {
    db.prepare(
      `INSERT INTO notifications (user_id, message, read) VALUES (?, ?, 0)`
    ).run(admin.id, `⛽ Сбой синхронизации топлива Opti: ${message}`);
  }
}

async function runFuelSync() {
  const settings = getFuelSettings();
  if (!settings.sync_enabled) {
    return { ok: true, skipped: true, created: 0, fetched: 0, message: 'Синхронизация отключена' };
  }

  const cards = listActiveFuelCards();
  const dataSource = createFuelDataSource(settings.data_source, {
    opti_login: settings.opti_login,
    opti_password: settings.opti_password,
  });

  const since = settings.last_sync_at || null;
  let fetched = [];
  let created = 0;

  try {
    fetched = await dataSource.fetchRecentTransactions(cards, since);
    const adminUserId = getSystemAdminId();

    for (const tx of fetched) {
      if (transactionExists(tx.external_id, tx.card_number, tx.transaction_at, tx.amount)) {
        continue;
      }

      const resolved = resolveDriverByCard(tx.card_number);
      if (!resolved) continue;

      const expenseId = createExpenseFromTransaction(
        tx,
        resolved.driver_id,
        resolved.car_number,
        adminUserId
      );
      insertFuelTransaction(
        tx,
        resolved.driver_id,
        resolved.car_number,
        expenseId,
        settings.data_source
      );
      created += 1;
    }

    markSyncResult({ status: 'ok', newCount: created, errorMessage: null });
    insertSyncLog({
      status: 'ok',
      source: settings.data_source,
      fetchedCount: fetched.length,
      createdCount: created,
    });

    return { ok: true, skipped: false, created, fetched: fetched.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка синхронизации';
    markSyncResult({ status: 'error', newCount: 0, errorMessage: message });
    insertSyncLog({
      status: 'error',
      source: settings.data_source,
      fetchedCount: fetched.length,
      createdCount: created,
      errorMessage: message,
    });
    if (settings.data_source === 'opti') {
      notifyAdminsAboutSyncFailure(message);
    }
    return { ok: false, skipped: false, created, fetched: fetched.length, error: message };
  }
}

async function testFuelConnection() {
  const settings = getFuelSettings();
  const dataSource = createFuelDataSource(settings.data_source, {
    opti_login: settings.opti_login,
    opti_password: settings.opti_password,
  });
  return dataSource.testConnection();
}

module.exports = {
  listActiveFuelCards,
  runFuelSync,
  testFuelConnection,
};
