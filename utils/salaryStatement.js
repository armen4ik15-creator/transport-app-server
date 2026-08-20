const {
  asNumber,
  calcDriverCompensations,
  calcDriverDeductions,
  calcDriverSeniorAllowance,
  calcDriverTripAccrued,
  formatRuDate,
  isTripSalaryEligible,
  resolvePaymentPeriod,
} = require('./salaryCalculations');

const COMPLETED_TRIP_SQL =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

const PAYOUT_TYPES = new Set(['salary', 'advance', 'bonus']);

const PAYMENT_CATEGORY = {
  salary: 'Выплата',
  advance: 'Аванс',
  bonus: 'Премия',
  deduction: 'Удержание',
};

const EXPENSE_CATEGORY = {
  fuel: 'Топливо',
  fuel_card: 'Пополнение ТК',
  repair: 'Ремонт',
  parts: 'Запчасти',
  maintenance: 'ТО',
  platon: 'Платон',
  wash: 'Мойка',
  toll: 'Платная дорога',
  fine: 'Штраф',
  dps: 'ДПС',
  supplies: 'Расходники',
  lease: 'Аренда',
  bank_fee: 'Банк',
  salary_other: 'Зарплата / прочее',
  other: 'Прочее',
  idle: 'Простой',
  compensation: 'Компенсация',
};

function expenseCategoryLabel(expType) {
  const key = String(expType || '').toLowerCase();
  return EXPENSE_CATEGORY[key] || 'Компенсация';
}

function paymentCategoryLabel(type) {
  return PAYMENT_CATEGORY[type] || type;
}

function paymentMethodLabel(method) {
  if (method === 'noncash') return 'безнал';
  if (method === 'cash') return 'наличные';
  return '';
}

function fetchDriverMeta(db, driverId) {
  return db
    .prepare(
      `SELECT
         d.id AS driver_id,
         u.full_name AS driver_name,
         d.car_number AS driver_car_number
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = ?`
    )
    .get(driverId);
}

function fetchTrips(db, driverId, from, to) {
  return db
    .prepare(
      `SELECT
         t.id,
         t.order_id,
         t.ttn_number,
         t.volume,
         t.photo_path,
         t.status,
         date(COALESCE(t.completed_at, t.created_at)) AS trip_date,
         COALESCE(o.driver_rate, 0) AS driver_rate,
         COALESCE(o.material, '') AS material,
         COALESCE(o.load_address, '') AS load_address,
         COALESCE(o.unload_address, '') AS unload_address,
         COALESCE(c.name, o.task_name, '') AS contractor_name
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       LEFT JOIN contractors c ON c.id = o.contractor_id
       WHERE t.driver_id = ?
         AND ${COMPLETED_TRIP_SQL}
         AND date(COALESCE(t.completed_at, t.created_at)) >= date(?)
         AND date(COALESCE(t.completed_at, t.created_at)) <= date(?)
       ORDER BY COALESCE(t.completed_at, t.created_at) ASC, t.id ASC`
    )
    .all(driverId, from, to);
}

function fetchCompensations(db, driverId, from, to) {
  return db
    .prepare(
      `SELECT
         e.id,
         e.exp_date,
         e.exp_type,
         e.amount,
         COALESCE(e.comment, '') AS comment
       FROM expenses e
       WHERE e.driver_id = ?
         AND e.source = 'driver'
         AND e.status = 'approved'
         AND date(e.exp_date) >= date(?)
         AND date(e.exp_date) <= date(?)
       ORDER BY e.exp_date ASC, e.id ASC`
    )
    .all(driverId, from, to);
}

function fetchPayments(db, driverId, from, to) {
  const rows = db
    .prepare(
      `SELECT
         p.id, p.type, p.amount, p.method, p.note,
         p.period_start, p.period_end, p.created_at
       FROM driver_payments p
       WHERE p.driver_id = ?
       ORDER BY COALESCE(p.period_start, p.created_at) ASC, p.id ASC`
    )
    .all(driverId);

  return rows.filter((row) => {
    const period = resolvePaymentPeriod(row);
    if (!period) return false;
    return period.end >= from && period.start <= to;
  });
}

function mapTrips(rows) {
  return rows.map((row) => {
    const counted = isTripSalaryEligible(row);
    const rate = asNumber(row.driver_rate);
    return {
      id: row.id,
      trip_date: row.trip_date,
      order_id: row.order_id,
      ttn_number: row.ttn_number,
      material: row.material || null,
      contractor_name: row.contractor_name || null,
      load_address: row.load_address || null,
      unload_address: row.unload_address || null,
      volume: row.volume == null ? null : asNumber(row.volume),
      driver_rate: rate,
      counted_in_salary: counted,
      exclude_reason: counted
        ? null
        : 'Нет фото ТТН — рейс не входит в начисление ЗП автоматически (может быть учтён вручную отдельной строкой)',
    };
  });
}

/**
 * Ведомость как в Excel: начисления → выплаты → остаток,
 * плюс список рейсов с пометкой «учтён / нет фото ТТН».
 */
function buildDriverPayrollStatement(db, { driverId, from, to }) {
  const driver = fetchDriverMeta(db, driverId);
  if (!driver) return null;

  const tripRows = mapTrips(fetchTrips(db, driverId, from, to));
  const countedTrips = tripRows.filter((t) => t.counted_in_salary);
  const excludedTrips = tripRows.filter((t) => !t.counted_in_salary);
  const tripsAccrued = calcDriverTripAccrued(db, driverId, from, to);
  const tripsExcludedSum = excludedTrips.reduce((sum, t) => sum + t.driver_rate, 0);
  const seniorAllowance = calcDriverSeniorAllowance(db, driverId, from, to);
  const compensationsTotal = calcDriverCompensations(db, driverId, from, to);
  const deducted = calcDriverDeductions(db, driverId, from, to);
  const compensationRows = fetchCompensations(db, driverId, from, to);
  const paymentRows = fetchPayments(db, driverId, from, to);

  const ledger = [];
  let balance = 0;
  let lineNo = 0;

  const pushAccrual = ({ category, date, description, amount }) => {
    const value = asNumber(amount);
    if (value <= 0) return;
    balance += value;
    lineNo += 1;
    ledger.push({
      line_no: lineNo,
      kind: 'accrual',
      category,
      date: date || null,
      description,
      accrued: value,
      paid: null,
      balance,
    });
  };

  const pushPayout = ({ category, date, description, amount }) => {
    const value = asNumber(amount);
    if (value <= 0) return;
    balance -= value;
    lineNo += 1;
    ledger.push({
      line_no: lineNo,
      kind: 'payout',
      category,
      date: date || null,
      description,
      accrued: null,
      paid: value,
      balance,
    });
  };

  if (countedTrips.length > 0 || tripsAccrued > 0) {
    pushAccrual({
      category: 'Рейсы',
      description: `Итого рейсов за период — ${countedTrips.length} (с фото ТТН)`,
      amount: tripsAccrued,
    });
  }

  if (excludedTrips.length > 0) {
    lineNo += 1;
    ledger.push({
      line_no: lineNo,
      kind: 'note',
      category: 'Рейсы без ЗП',
      date: null,
      description: `${excludedTrips.length} рейс(ов) не начислены (нет фото ТТН) на ${tripsExcludedSum.toLocaleString('ru-RU')} ₽ — см. таблицу рейсов`,
      accrued: null,
      paid: null,
      balance,
    });
  }

  if (seniorAllowance > 0) {
    pushAccrual({
      category: 'Старший водитель',
      date: to,
      description: 'Надбавка старшего водителя за вахту',
      amount: seniorAllowance,
    });
  }

  compensationRows.forEach((row) => {
    const comment = String(row.comment || '').trim();
    pushAccrual({
      category: expenseCategoryLabel(row.exp_type),
      date: String(row.exp_date).slice(0, 10),
      description: comment || expenseCategoryLabel(row.exp_type),
      amount: row.amount,
    });
  });

  const paidTotal = paymentRows
    .filter((p) => PAYOUT_TYPES.has(p.type))
    .reduce((sum, p) => sum + asNumber(p.amount), 0);

  if (paymentRows.length > 0) {
    lineNo += 1;
    ledger.push({
      line_no: lineNo,
      kind: 'section',
      category: 'ВЫПЛАТЫ',
      date: null,
      description: 'Что уже выдали водителю',
      accrued: null,
      paid: null,
      balance,
    });
  }

  paymentRows.forEach((row) => {
    const created = String(row.created_at || '').slice(0, 10);
    const method = paymentMethodLabel(row.method);
    const note = String(row.note || '').trim();
    const parts = [paymentCategoryLabel(row.type)];
    if (method) parts.push(method);
    if (note) parts.push(note);

    if (row.type === 'deduction') {
      pushPayout({
        category: paymentCategoryLabel(row.type),
        date: created || null,
        description: parts.join(' — '),
        amount: row.amount,
      });
      return;
    }

    if (PAYOUT_TYPES.has(row.type)) {
      pushPayout({
        category: paymentCategoryLabel(row.type),
        date: created || null,
        description: parts.join(' — '),
        amount: row.amount,
      });
    }
  });

  const accruedTotal = tripsAccrued + seniorAllowance + compensationsTotal;
  const debt = accruedTotal - deducted - paidTotal;

  return {
    driver_id: driver.driver_id,
    driver_name: driver.driver_name,
    driver_car_number: driver.driver_car_number,
    from,
    to,
    period_label: `${formatRuDate(from)} — ${formatRuDate(to)}`,
    totals: {
      accrued: accruedTotal,
      paid: paidTotal,
      deducted,
      debt,
      trips_accrued: tripsAccrued,
      trips_excluded: tripsExcludedSum,
      trips_counted_count: countedTrips.length,
      trips_excluded_count: excludedTrips.length,
      senior_allowance: seniorAllowance,
      compensations: compensationsTotal,
    },
    ledger,
    trips: tripRows,
    payments: paymentRows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: asNumber(row.amount),
      method: row.method,
      note: row.note,
      period_start: row.period_start ? String(row.period_start).slice(0, 10) : null,
      period_end: row.period_end ? String(row.period_end).slice(0, 10) : null,
      created_at: row.created_at,
      category: paymentCategoryLabel(row.type),
    })),
  };
}

module.exports = {
  buildDriverPayrollStatement,
};
