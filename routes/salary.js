const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  buildDriverSalaryBalance,
  parseIsoDate,
  resolvePaymentPeriod,
} = require('../utils/salaryCalculations');
const { buildDriverPayrollStatement } = require('../utils/salaryStatement');
const { findDuplicateImportMarker } = require('../utils/importMarkers');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

const PAYMENT_SELECT = `
  SELECT
    p.id, p.driver_id, p.type, p.amount, p.method, p.note,
    p.period_start, p.period_end, p.created_by, p.created_at,
    u.full_name AS driver_name,
    d.car_number AS driver_car_number
  FROM driver_payments p
  JOIN drivers d ON d.id = p.driver_id
  JOIN users u ON u.id = d.user_id
`;

function validatePeriod(startRaw, endRaw) {
  const start = startRaw ? String(startRaw).slice(0, 10) : null;
  const end = endRaw ? String(endRaw).slice(0, 10) : null;

  if (!start || !end) {
    return { error: 'period_start и period_end обязательны (YYYY-MM-DD)' };
  }
  if (!parseIsoDate(start) || !parseIsoDate(end)) {
    return { error: 'Некорректный формат периода' };
  }
  if (start > end) {
    return { error: 'Начало периода не может быть позже конца' };
  }
  return { start, end };
}

function validateMethod(method, type) {
  if (type === 'deduction') return { method: null };
  const normalized = method === 'noncash' ? 'noncash' : 'cash';
  return { method: normalized };
}

router.get('/payments', (req, res) => {
  const driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
  const where = [];
  const params = [];
  if (driverId) {
    where.push('p.driver_id = ?');
    params.push(driverId);
  }
  const rows = db
    .prepare(`${PAYMENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC`)
    .all(...params);
  return res.json(rows);
});

router.get('/accrued', async (req, res) => {
  try {
    const driverId = Number(req.query.driver_id);
    const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query.to ? String(req.query.to).slice(0, 10) : null;

    if (!Number.isFinite(driverId) || driverId <= 0) {
      return res.status(400).json({ error: 'driver_id обязателен' });
    }
    if (!from || !to) {
      return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });
    }

    const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

    const accrued = calcDriverTripAccrued(db, driverId, from, to);
    const compensations = calcDriverCompensations(db, driverId, from, to);
    const seniorAllowance = calcDriverSeniorAllowance(db, driverId, from, to);
    const deductions = calcDriverDeductions(db, driverId, from, to);

    return res.json({
      driver_id: driverId,
      from,
      to,
      accrued,
      senior_allowance: seniorAllowance,
      compensations,
      deductions,
      net: accrued + seniorAllowance + compensations - deductions,
    });
  } catch (error) {
    console.error('[salary/accrued]', error);
    return res.status(500).json({ error: error.message || 'Ошибка расчёта начислений' });
  }
});

router.post('/payments', (req, res) => {
  const { driver_id, type, amount, note, method, period_start, period_end } = req.body || {};
  if (!driver_id || !type || amount == null) {
    return res.status(400).json({ error: 'driver_id, type и amount обязательны' });
  }
  if (!['salary', 'advance', 'bonus', 'deduction'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть salary, advance, bonus или deduction' });
  }

  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount должен быть положительным числом' });
  }

  const period = validatePeriod(period_start, period_end);
  if (period.error) return res.status(400).json({ error: period.error });

  const paymentMethod = validateMethod(method, type);
  if (paymentMethod.error) return res.status(400).json({ error: paymentMethod.error });

  const duplicate = findDuplicateImportMarker(db, 'driver_payments', note, {
    amount: numericAmount,
    driverId: Number(driver_id),
  });
  if (duplicate) {
    return res.status(409).json({
      error: `Дубликат импорта: маркер ${duplicate.marker} уже в выплате #${duplicate.id}`,
      existing_id: duplicate.id,
      marker: duplicate.marker,
    });
  }

  const result = db
    .prepare(
      `INSERT INTO driver_payments
       (driver_id, type, amount, method, note, period_start, period_end, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      driver_id,
      type,
      numericAmount,
      paymentMethod.method,
      note || null,
      period.start,
      period.end,
      req.user.id
    );

  const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.delete('/payments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }
  const exists = db.prepare('SELECT id FROM driver_payments WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Выплата не найдена' });
  db.prepare('DELETE FROM driver_payments WHERE id = ?').run(id);
  return res.json({ ok: true });
});

router.get('/statement', (req, res) => {
  try {
    const driverId = Number(req.query.driver_id);
    const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query.to ? String(req.query.to).slice(0, 10) : null;

    if (!Number.isFinite(driverId) || driverId <= 0) {
      return res.status(400).json({ error: 'driver_id обязателен' });
    }
    if (!from || !to) {
      return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });
    }
    if (!parseIsoDate(from) || !parseIsoDate(to)) {
      return res.status(400).json({ error: 'Некорректный формат периода' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'Начало периода не может быть позже конца' });
    }

    const statement = buildDriverPayrollStatement(db, { driverId, from, to });
    if (!statement) return res.status(404).json({ error: 'Водитель не найден' });
    return res.json(statement);
  } catch (error) {
    console.error('[salary/statement]', error);
    return res.status(500).json({ error: error.message || 'Ошибка формирования ведомости' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
    const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query.to ? String(req.query.to).slice(0, 10) : null;

    if (!driverId || !Number.isFinite(driverId)) {
      return res.status(400).json({ error: 'driver_id обязателен' });
    }

    const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

    const periodStart = from ?? '1970-01-01';
    const periodEnd = to ?? '2099-12-31';

    const balance = buildDriverSalaryBalance(db, driverId, periodStart, periodEnd, {
      includeOpening: periodStart <= '1970-01-02' && periodEnd >= '2099-12-30',
    });

    return res.json({
      driver_id: driverId,
      from: periodStart,
      to: periodEnd,
      ...balance,
    });
  } catch (error) {
    console.error('[salary/summary]', error);
    return res.status(500).json({ error: error.message || 'Ошибка сводки зарплаты' });
  }
});

router.get('/debts', async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === '1';

    const drivers = db
      .prepare(
        `SELECT
           d.id AS driver_id,
           u.full_name AS driver_name,
           d.car_number AS driver_car_number,
           COALESCE(d.is_archived, 0) AS is_archived,
           COALESCE(d.is_active, 0) AS is_active
         FROM drivers d
         JOIN users u ON u.id = d.user_id
         ORDER BY u.full_name ASC`
      )
      .all();

    const rows = [];
    for (const driver of drivers) {
      if (!includeArchived && Number(driver.is_archived) === 1) continue;

      const balance = buildDriverSalaryBalance(db, driver.driver_id, '1970-01-01', '2099-12-31');

      rows.push({
        driver_id: driver.driver_id,
        driver_name: driver.driver_name,
        driver_car_number: driver.driver_car_number,
        is_archived: Number(driver.is_archived) === 1,
        is_active: Number(driver.is_active) === 1,
        calculation_scope: 'all_time',
        ...balance,
      });
    }

    rows.sort((a, b) => b.owed - a.owed || b.debt - a.debt || String(a.driver_name).localeCompare(String(b.driver_name)));
    return res.json(rows);
  } catch (error) {
    console.error('[salary/debts]', error);
    return res.status(500).json({ error: error.message || 'Ошибка расчёта долгов' });
  }
});

const SHIFT_SETTLEMENT_SELECT = `
  SELECT
    s.id, s.driver_id, s.period_start, s.period_end, s.note, s.created_by, s.created_at,
    u.full_name AS driver_name,
    d.car_number AS driver_car_number
  FROM salary_shift_settlements s
  JOIN drivers d ON d.id = s.driver_id
  JOIN users u ON u.id = d.user_id
`;

router.get('/shift-settlements', (req, res) => {
  try {
    const driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
    const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query.to ? String(req.query.to).slice(0, 10) : null;
    const where = [];
    const params = [];

    if (driverId) {
      where.push('s.driver_id = ?');
      params.push(driverId);
    }
    if (from) {
      where.push('s.period_end >= ?');
      params.push(from);
    }
    if (to) {
      where.push('s.period_start <= ?');
      params.push(to);
    }

    const rows = db
      .prepare(
        `${SHIFT_SETTLEMENT_SELECT}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY s.period_start DESC, s.id DESC`
      )
      .all(...params);
    return res.json(rows);
  } catch (error) {
    console.error('[salary/shift-settlements GET]', error);
    return res.status(500).json({ error: error.message || 'Ошибка загрузки закрытых вахт' });
  }
});

router.post('/shift-settlements', (req, res) => {
  try {
    const { driver_id, period_start, period_end, note } = req.body || {};
    const driverId = Number(driver_id);
    if (!Number.isFinite(driverId) || driverId <= 0) {
      return res.status(400).json({ error: 'driver_id обязателен' });
    }

    const period = validatePeriod(period_start, period_end);
    if (period.error) return res.status(400).json({ error: period.error });

    const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
    if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

    const existing = db
      .prepare(
        `SELECT id FROM salary_shift_settlements
         WHERE driver_id = ? AND period_start = ? AND period_end = ?`
      )
      .get(driverId, period.start, period.end);

    let rowId;
    if (existing) {
      db.prepare(
        `UPDATE salary_shift_settlements
         SET note = ?, created_by = ?
         WHERE id = ?`
      ).run(note || null, req.user.id, existing.id);
      rowId = existing.id;
    } else {
      const result = db
        .prepare(
          `INSERT INTO salary_shift_settlements
           (driver_id, period_start, period_end, note, created_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(driverId, period.start, period.end, note || null, req.user.id);
      rowId = result.lastInsertRowid;
    }

    const row = db.prepare(`${SHIFT_SETTLEMENT_SELECT} WHERE s.id = ?`).get(rowId);
    return res.status(201).json(row);
  } catch (error) {
    console.error('[salary/shift-settlements POST]', error);
    return res.status(500).json({ error: error.message || 'Ошибка закрытия вахты' });
  }
});

router.delete('/shift-settlements/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Некорректный id' });
    }
    const exists = db.prepare('SELECT id FROM salary_shift_settlements WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ error: 'Запись не найдена' });
    db.prepare('DELETE FROM salary_shift_settlements WHERE id = ?').run(id);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[salary/shift-settlements DELETE]', error);
    return res.status(500).json({ error: error.message || 'Ошибка удаления' });
  }
});

module.exports = router;
