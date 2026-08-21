const express = require('express');
const db = require('../database');
const { requireRole } = require('../middleware/auth');
const {
  getCompanyCashSettings,
  updateCompanyCashSettings,
  getCompanyCashSummary,
} = require('../services/companyCash');
const { extractStrictMarkers } = require('../utils/importMarkers');

const router = express.Router();

router.get('/cash-settings', requireRole('admin'), (_req, res) => {
  return res.json(getCompanyCashSettings());
});

router.put('/cash-settings', requireRole('admin'), (req, res) => {
  try {
    const updated = updateCompanyCashSettings(req.body || {});
    return res.json(updated);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Не удалось сохранить настройки' });
  }
});

router.get('/cash-summary', requireRole('admin'), (_req, res) => {
  return res.json(getCompanyCashSummary());
});

/**
 * Integrity check: true import duplicates (same strict marker + amount).
 * Shared batch tags like [cash-#10] are ignored — they cover many different lines.
 */
router.get('/integrity', requireRole('admin'), (_req, res) => {
  const expenses = db
    .prepare(
      `SELECT id, exp_date, exp_type, method, amount, comment
       FROM expenses
       WHERE comment IS NOT NULL AND TRIM(comment) != ''
       ORDER BY id ASC`
    )
    .all();
  const salary = db
    .prepare(
      `SELECT id, driver_id, type, method, amount, note, period_start, period_end
       FROM driver_payments
       WHERE note IS NOT NULL AND TRIM(note) != ''
       ORDER BY id ASC`
    )
    .all();
  const payments = db
    .prepare(
      `SELECT id, contractor_id, amount, note, payment_date
       FROM contractor_payments
       WHERE note IS NOT NULL AND TRIM(note) != ''
       ORDER BY id ASC`
    )
    .all();

  function collect(rows, textKey, extraKeys = []) {
    const map = new Map();
    for (const row of rows) {
      const markers = extractStrictMarkers(row[textKey]);
      if (!markers.length) continue;
      const marker = markers.reduce((a, b) => (a.length >= b.length ? a : b));
      const amount = Number(row.amount) || 0;
      const key = [marker, amount.toFixed(2), ...extraKeys.map((k) => String(row[k] ?? ''))].join('|');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    const dups = [];
    for (const [key, items] of map.entries()) {
      if (items.length < 2) continue;
      const [marker, amount] = key.split('|');
      dups.push({
        marker,
        amount: Number(amount),
        count: items.length,
        keep_id: items[0].id,
        delete_ids: items.slice(1).map((item) => item.id),
        ids: items.map((item) => item.id),
      });
    }
    return dups;
  }

  const expenseDups = collect(expenses, 'comment');
  const salaryDups = collect(salary, 'note', ['driver_id']);
  const paymentDups = collect(payments, 'note');

  return res.json({
    ok: expenseDups.length === 0 && salaryDups.length === 0 && paymentDups.length === 0,
    checked: {
      expenses: expenses.length,
      salary_payments: salary.length,
      contractor_payments: payments.length,
    },
    duplicates: {
      expenses: expenseDups,
      salary_payments: salaryDups,
      contractor_payments: paymentDups,
    },
    rule_ru:
      'Дубликат = один и тот же маркер импорта ([bank-…], [cpay-…], [cash-aug-…] и т.п.) и та же сумма. Общие теги партии вроде [cash-#10] дублями не считаются.',
  });
});

module.exports = router;
