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

/**
 * Sum approved expenses since opening date.
 * @param {object} opts
 * @param {string[]} [opts.excludeTypes]
 * @param {string[]|null} [opts.onlyTypes]
 * @param {string|null} [opts.commentLike]
 * @param {string|null} [opts.commentNotLike]
 * @param {'cash'|'noncash'|'any'|'unset'|null} [opts.method]
 *   - cash / noncash: exact method
 *   - unset: method IS NULL or empty (P&L-only / reimbursed off р/с)
 *   - any / null: no method filter
 */
function sumExpensesSince(
  openingDate,
  {
    excludeTypes = [],
    onlyTypes = null,
    commentLike = null,
    commentNotLike = null,
    method = null,
  } = {}
) {
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
  if (commentLike) {
    where.push('comment LIKE ?');
    params.push(`%${commentLike}%`);
  }
  if (commentNotLike) {
    where.push('(comment IS NULL OR comment NOT LIKE ?)');
    params.push(`%${commentNotLike}%`);
  }
  if (method === 'cash' || method === 'noncash') {
    where.push('method = ?');
    params.push(method);
  } else if (method === 'unset') {
    where.push("(method IS NULL OR TRIM(method) = '')");
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
  let bankSettlementOut = 0;
  let cashDeskOut = 0;
  let offSettlementExpenses = 0;
  let otherInflows = 0;
  let fuelFills = 0;
  let fuelCardTopups = 0;
  let pprTopups = 0;
  let pprFills = 0;
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

    // р/с: только безнал, который реально уходит с расчётного счёта.
    // method пустой — не трогает р/с (возмещения через ЗП и т.п., только P&L).
    bankSettlementOut = sumExpensesSince(openingDate, {
      excludeTypes: ['fuel', 'loan_return'],
      method: 'noncash',
    });
    cashDeskOut = sumExpensesSince(openingDate, {
      excludeTypes: ['fuel', 'loan_return'],
      method: 'cash',
    });
    offSettlementExpenses = sumExpensesSince(openingDate, {
      excludeTypes: ['fuel', 'loan_return'],
      method: 'unset',
    });

    otherInflows = sumExpensesSince(openingDate, { onlyTypes: ['loan_return'] });

    fuelFills = sumExpensesSince(openingDate, {
      onlyTypes: ['fuel'],
      commentLike: '[opti-fuel-',
    });
    fuelCardTopups = sumExpensesSince(openingDate, {
      onlyTypes: ['fuel_card'],
      commentNotLike: '[ppr-topup-',
    });
    pprTopups = sumExpensesSince(openingDate, {
      onlyTypes: ['fuel_card'],
      commentLike: '[ppr-topup-',
    });
    pprFills = sumExpensesSince(openingDate, {
      onlyTypes: ['fuel'],
      commentLike: '[ppr-fuel-',
    });

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

  // Движение р/с (бухгалтерски):
  //   вход: оплаты контрагентов + прочие приходы на р/с (loan_return)
  //   выход с р/с напрямую: method=noncash (vendor, ТК, комиссии…)
  //   выход через «доход ИП» / кассу: method=cash + ЗП/авансы + выдача подотчёта
  // Заправки fuel не трогают р/с (списаны с баланса ТК после пополнения).
  // Расходы без method — только P&L (уже возмещены через ЗП / не с р/с).
  const expensesOut = bankSettlementOut + cashDeskOut;
  const estimatedBalance =
    opening +
    paymentsIn +
    otherInflows -
    bankSettlementOut -
    cashDeskOut -
    driverPayOut -
    imprestFlowSinceOpening;

  const estimatedFuelCardBalance = fuelOpening + fuelCardTopups - fuelFills;
  const estimatedPprBalance = pprTopups - pprFills;

  return {
    opening_cash_balance: opening,
    opening_cash_date: openingDate,
    payments_in: paymentsIn,
    other_inflows: otherInflows,
    // backward-compatible total of settlement-hitting expense legs
    expenses_out: expensesOut,
    bank_settlement_out: bankSettlementOut,
    cash_desk_out: cashDeskOut,
    // P&L-only expenses (no method) — visible for audit, not in р/с estimate
    off_settlement_expenses: offSettlementExpenses,
    fuel_fills: fuelFills,
    fuel_card_topups: fuelCardTopups,
    ppr_topups: pprTopups,
    ppr_fills: pprFills,
    estimated_ppr_balance: estimatedPprBalance,
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
