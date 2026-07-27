const express = require('express');
const { requireRole } = require('../middleware/auth');
const {
  getCompanyCashSettings,
  updateCompanyCashSettings,
  getCompanyCashSummary,
} = require('../services/companyCash');

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

module.exports = router;
