const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  if (req.user.role !== 'admin') {
    const rows = db
      .prepare(
        `SELECT id, user_id, action, details, created_at
         FROM activity_log
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 200`
      )
      .all(req.user.id);
    return res.json(rows);
  }
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, a.action, a.details, a.created_at, u.email AS user_email
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT 500`
    )
    .all();
  return res.json(rows);
});

module.exports = router;
