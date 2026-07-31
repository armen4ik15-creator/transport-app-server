const db = require('../database');
const { getImprestTotals, ensureImprestTables } = require('./imprest');

function ensureCompanyCashSettings() {
  const row = db.prepare('SELECT id FROM company_cash_settings WHERE id = 1').get();
  if (row) return;
  db.prepare(
    `INSERT INTO company_cash_settings
     (id, opening_cash_balance, opening_cash_date, opening_fuel_card_balance, opening_fuel_card_date, updated_at)
     VALUES (1, 0, NULL, 0, NULL, datetime('now'))`
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

function parseFuelCardOpeningBalance(value) {
  if (value == null || value === '') return { value: 0 };
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { error: 'opening_fuel_card_balance должен быть числом' };
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
    opening_fuel_card_balance: Number(row?.opening_fuel_card_balance ?? 0),
    opening_fuel_card_date: row?.opening_fuel_card_date ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

function updateCompanyCashSettings(patch) {
  ensureCompanyCashSettings();
  const current = getCompanyCashSettings();

  let nextBalance = current.opening_cash_balance;
  let nextDate = current.opening_cash_date;
  let nextFuelBalance = current.opening_fuel_card_balance;
  let nextFuelDate = current.opening_fuel_card_date;

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

  if (patch.opening_fuel_card_balance !== undefined) {
    const balance = parseFuelCardOpeningBalance(patch.opening_fuel_card_balance);
    if (balance.error) throw new Error(balance.error);
    nextFuelBalance = balance.value ?? 0;
  }

  if (patch.opening_fuel_card_date !== undefined) {
    const date = parseOpeningCashDate(patch.opening_fuel_card_date);
    if (date.error) throw new Error(date.error || 'opening_fuel_card_date должен быть в формате YYYY-MM-DD');
    nextFuelDate = date.value;
  }

  db.prepare(
    `UPDATE company_cash_settings
     SET opening_cash_balance = ?,
         opening_cash_date = ?,
         opening_fuel_card_balance = ?,
         opening_fuel_card_date = ?,
         updated_at = datetime('now')
     WHERE id = 1`
  ).run(nextBalance, nextDate, nextFuelBalance, nextFuelDate);

  return getCompanyCashSettings();
}

function sumExpensesSince(openingDate, { excludeTypes = [], onlyTypes = null } = {}) {
  const where = [
    '(status IS NULL OR status = \'approved\')',
    'date(exp_date) >= date(?)',
  ];
  const params = [openingDate];

  if (onlyTypes && onlyTypes.length > 0) {
    where.push(`exp_type IN (${onlyTypes.map(() => '?').join(',')})`);
    params.push(...onlyTypes);
  }
  for (const type of excludeTypes) {
    where.push('exp_type != ?');
    params.push(type);
  }

  const row = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE ${where.join(' AND ')}`)
    .get(...params);
  return Number(row?.total ?? 0);
}

function getCompanyCashSummary() {
  const settings = getCompanyCashSettings();
  const openingDate = settings.opening_cash_date;

  let paymentsIn = 0;
  let expensesOut = 0;
  let otherInflows = 0;
  let fuelFills = 0;
  let fuelCardTopups = 0;
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

    // р/с: расходы кроме заправок по карте и кроме приходов (loan_return)
    expensesOut = sumExpensesSince(openingDate, {
      excludeTypes: ['fuel', 'loan_return'],
    });
    otherInflows = sumExpensesSince(openingDate, { onlyTypes: ['loan_return'] });
    fuelFills = sumExpensesSince(openingDate, { onlyTypes: ['fuel'] });
    fuelCardTopups = sumExpensesSince(openingDate, { onlyTypes: ['fuel_card'] });

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
  const fuelOpening = Number(settings.opening_fuel_card_balance ?? 0);

  // Оценка р/с: открытие + оплаты контрагентов + прочие приходы (возврат займа и т.п.)
  // − расходы р/с (в т.ч. пополнения ТК) − зарплаты − подотчёт.
  // Заправки (fuel) НЕ вычитаем — они уже оплачены с баланса топливной карты.
  // loan_return НЕ является оплатой контрагента и не уменьшает его долг.
  const estimatedBalance =
    opening +
    paymentsIn +
    otherInflows -
    expensesOut -
    driverPayOut -
    imprestFlowSinceOpening;

  // Кошелёк ТК: входящий остаток + пополнения − заправки
  const estimatedFuelCardBalance = fuelOpening + fuelCardTopups - fuelFills;

  return {
    opening_cash_balance: opening,
    opening_cash_date: openingDate,
    payments_in: paymentsIn,
    other_inflows: otherInflows,
    expenses_out: expensesOut,
    fuel_fills: fuelFills,
    fuel_card_topups: fuelCardTopups,
    opening_fuel_card_balance: fuelOpening,
    opening_fuel_card_date: settings.opening_fuel_card_date,
    estimated_fuel_card_balance: estimatedFuelCardBalance,
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
