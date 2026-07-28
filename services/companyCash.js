const db = require('../database');
const { getImprestTotals, ensureImprestTables } = require('./imprest');

function ensureCompanyCashSettings() {
  const row = db.prepare('SELECT id FROM company_cash_settings WHERE id = 1').get();
  if (row) return;
  db.prepare(
    `INSERT INTO company_cash_settings
     (id, opening_cash_balance, opening_cash_date, updated_at)
     VALUES (1, 0, NULL, datetime('now'))`
  ).run();
}

function parseOpeningCashBalance(value) {
  if (value == null || value === '') return { value: 0 };
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { error: 'opening_cash_balance должен быть числом ≥ 0' };
  }
  return { value: numeric };
}

function parseOpeningCashDate(value) {
  if (value == null || value === '') return { value: null };
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'opening_cash_date должен быть в формате YYYY-MM-DD' };
  }
  return { value: date };
}

function getCompanyCashSettings() {
  ensureCompanyCashSettings();
  const row = db.prepare('SELECT * FROM company_cash_settings WHERE id = 1').get();
  return {
    opening_cash_balance: Number(row?.opening_cash_balance ?? 0),
    opening_cash_date: row?.opening_cash_date ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

function updateCompanyCashSettings(patch) {
  ensureCompanyCashSettings();
  const current = getCompanyCashSettings();

  let nextBalance = current.opening_cash_balance;
  let nextDate = current.opening_cash_date;

  if (patch.opening_cash_balance !== undefined) {
    const balance = parseOpeningCashBalance(patch.opening_cash_balance);
    if (balance.error) throw new Error(balance.error);
    nextBalance = balance.value ?? 0;
  }

  if (patch.opening_cash_date !== undefined) {
    const date = parseOpeningCashDate(patch.opening_cash_date);
    if (date.error) throw new Error(date.error);
    nextDate = date.value;
  }

  db.prepare(
    `UPDATE company_cash_settings
     SET opening_cash_balance = ?, opening_cash_date = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(nextBalance, nextDate);

  return getCompanyCashSettings();
}

function getCompanyCashSummary() {
  const settings = getCompanyCashSettings();
  const openingDate = settings.opening_cash_date;

  let paymentsIn = 0;
  let expensesOut = 0;
  let driverPayOut = 0;

  if (openingDate) {
    const paymentsRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM contractor_payments
         WHERE SUBSTR(COALESCE(payment_date, created_at), 1, 10) >= ?`
      )
      .get(openingDate);
    paymentsIn = Number(paymentsRow?.total ?? 0);

    const expensesRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM expenses
         WHERE (status IS NULL OR status = 'approved')
           AND date(exp_date) >= date(?)`
      )
      .get(openingDate);
    expensesOut = Number(expensesRow?.total ?? 0);

    const driverRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM driver_payments
         WHERE type IN ('salary', 'advance', 'bonus')
           AND SUBSTR(COALESCE(created_at), 1, 10) >= ?`
      )
      .get(openingDate);
    driverPayOut = Number(driverRow?.total ?? 0);
  }

  let imprestOutstanding = 0;
  let imprestFlowSinceOpening = 0;
  try {
    ensureImprestTables();
    const totals = getImprestTotals();
    imprestOutstanding = Number(totals.outstanding || 0);
    if (openingDate) {
      const flowRow = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN kind = 'issue' THEN amount ELSE 0 END), 0) AS issued,
             COALESCE(SUM(CASE WHEN kind IN ('report', 'return') THEN amount ELSE 0 END), 0) AS closed
           FROM imprest_movements
           WHERE date(move_date) >= date(?)`
        )
        .get(openingDate);
      imprestFlowSinceOpening =
        Number(flowRow?.issued || 0) - Number(flowRow?.closed || 0);
    }
  } catch {
    imprestOutstanding = 0;
    imprestFlowSinceOpening = 0;
  }

  const opening = Number(settings.opening_cash_balance ?? 0);
  // Оценка р/с: открытия + оплаты − расходы − зарплаты − выдачи под отчёт с даты открытия
  const estimatedBalance =
    opening + paymentsIn - expensesOut - driverPayOut - imprestFlowSinceOpening;

  return {
    opening_cash_balance: opening,
    opening_cash_date: openingDate,
    payments_in: paymentsIn,
    expenses_out: expensesOut,
    driver_payments_out: driverPayOut,
    imprest_outstanding: imprestOutstanding,
    imprest_flow_since_opening: imprestFlowSinceOpening,
    estimated_cash_balance: estimatedBalance,
  };
}

module.exports = {
  getCompanyCashSettings,
  updateCompanyCashSettings,
  getCompanyCashSummary,
};
