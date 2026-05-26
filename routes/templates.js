const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

const TEMPLATE_TYPES = ['waybill', 'invoice', 'act'];

router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      'SELECT id, name, type, content, created_at FROM document_templates ORDER BY created_at DESC'
    )
    .all();
  return res.json(rows);
});

router.post('/', (req, res) => {
  const { name, type, content } = req.body || {};
  if (!name || !type || !content) {
    return res.status(400).json({ error: 'name, type и content обязательны' });
  }
  if (!TEMPLATE_TYPES.includes(type)) {
    return res.status(400).json({ error: 'type должен быть waybill, invoice или act' });
  }
  const result = db
    .prepare('INSERT INTO document_templates (name, type, content) VALUES (?, ?, ?)')
    .run(String(name).trim(), type, content);
  const row = db
    .prepare('SELECT id, name, type, content, created_at FROM document_templates WHERE id = ?')
    .get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM document_templates WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Шаблон не найден' });

  const { name, type, content } = req.body || {};
  if (type && !TEMPLATE_TYPES.includes(type)) {
    return res.status(400).json({ error: 'type должен быть waybill, invoice или act' });
  }

  db.prepare(
    `UPDATE document_templates
     SET name = COALESCE(?, name),
         type = COALESCE(?, type),
         content = COALESCE(?, content)
     WHERE id = ?`
  ).run(
    name ? String(name).trim() : null,
    type || null,
    content || null,
    id
  );

  const row = db
    .prepare('SELECT id, name, type, content, created_at FROM document_templates WHERE id = ?')
    .get(id);
  return res.json(row);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM document_templates WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Шаблон не найден' });
  db.prepare('DELETE FROM document_templates WHERE id = ?').run(id);
  return res.json({ ok: true });
});

module.exports = router;
