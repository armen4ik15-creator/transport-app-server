const express = require('express');
const { requireRole } = require('../middleware/auth');
const {
  listImprestHolders,
  getImprestHolder,
  createImprestHolder,
  listImprestMovements,
  createImprestMovement,
  getImprestTotals,
} = require('../services/imprest');

const router = express.Router();

router.get('/imprest', requireRole('admin'), (_req, res) => {
  try {
    return res.json({
      ...getImprestTotals(),
      holders: listImprestHolders(),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Не удалось загрузить подотчёт' });
  }
});

router.post('/imprest/holders', requireRole('admin'), (req, res) => {
  try {
    const created = createImprestHolder(req.body || {});
    return res.status(201).json(created);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Не удалось создать держателя' });
  }
});

router.get('/imprest/holders/:id/movements', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }
  const holder = getImprestHolder(id);
  if (!holder) return res.status(404).json({ error: 'Держатель не найден' });
  return res.json({
    holder,
    movements: listImprestMovements(id),
  });
});

router.post('/imprest/movements', requireRole('admin'), (req, res) => {
  try {
    const created = createImprestMovement({
      ...(req.body || {}),
      created_by: req.user.id,
    });
    const status = created._duplicate ? 200 : 201;
    return res.status(status).json(created);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Не удалось создать движение' });
  }
});

module.exports = router;
