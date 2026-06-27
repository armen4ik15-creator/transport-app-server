const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { purgeBusinessData } = require('../services/purge/purgeBusinessData');

const router = express.Router();
router.use(authMiddleware);

const CONFIRM_PHRASE = 'PURGE-REESTRPRO';

function requireOwner(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }

  const row = db.prepare('SELECT is_owner FROM users WHERE id = ?').get(req.user.id);
  if (!row || Number(row.is_owner) !== 1) {
    return res.status(403).json({ error: 'Только учредитель может очистить все данные' });
  }

  return next();
}

router.post('/purge-business-data', requireOwner, (req, res) => {
  const confirm = String(req.body?.confirm ?? '').trim();
  if (confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({
      error: `Подтвердите фразой ${CONFIRM_PHRASE}`,
    });
  }

  try {
    const result = purgeBusinessData({
      userId: req.user.id,
      clearUploads: req.body?.clearUploads !== false,
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Purge failed' });
  }
});

module.exports = router;
