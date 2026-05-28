const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

const SELECT_SQL = `
  SELECT
    t.id, t.name, t.contractor_id, t.material, t.unit, t.default_quantity,
    t.driver_rate, t.company_rate, t.distance_km, t.notes, t.description,
    t.load_address, t.unload_address, t.created_by, t.created_at,
    c.name AS contractor_name
  FROM order_templates t
  LEFT JOIN contractors c ON c.id = t.contractor_id
`;

router.get('/', (_req, res) => {
  const rows = db.prepare(`${SELECT_SQL} ORDER BY t.created_at DESC`).all();
  return res.json(rows);
});

router.post('/', (req, res) => {
  const {
    name,
    contractor_id,
    material,
    unit,
    default_quantity,
    driver_rate,
    company_rate,
    distance_km,
    notes,
    description,
    load_address,
    unload_address,
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name обязателен' });
  }

  const contractorId =
    contractor_id == null || contractor_id === '' ? null : Number(contractor_id);

  if (contractorId != null && !Number.isFinite(contractorId)) {
    return res.status(400).json({ error: 'contractor_id должен быть числом' });
  }

  if (contractorId != null) {
    const exists = db
      .prepare('SELECT id FROM contractors WHERE id = ?')
      .get(contractorId);
    if (!exists) return res.status(404).json({ error: 'Контрагент не найден' });
  }

  const result = db
    .prepare(
      `INSERT INTO order_templates
       (name, contractor_id, material, unit, default_quantity, driver_rate, company_rate, distance_km, notes, description, load_address, unload_address, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      contractorId,
      material || null,
      unit || null,
      default_quantity == null || default_quantity === '' ? null : Number(default_quantity),
      driver_rate == null || driver_rate === '' ? null : Number(driver_rate),
      company_rate == null || company_rate === '' ? null : Number(company_rate),
      distance_km == null || distance_km === '' ? null : Number(distance_km),
      notes || null,
      description || null,
      load_address || null,
      unload_address || null,
      req.user.id
    );

  const row = db.prepare(`${SELECT_SQL} WHERE t.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.post('/from-order', (req, res) => {
  const { order_id, name } = req.body || {};
  const orderId = Number(order_id);
  if (!Number.isFinite(orderId) || orderId <= 0 || !name || !String(name).trim()) {
    return res.status(400).json({ error: 'order_id и name обязательны' });
  }
  const order = db
    .prepare(
      `SELECT
         contractor_id, material, unit, quantity, driver_rate, company_rate, distance_km,
         notes, description, load_address, unload_address
       FROM orders
       WHERE id = ?`
    )
    .get(orderId);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const result = db
    .prepare(
      `INSERT INTO order_templates
       (name, contractor_id, material, unit, default_quantity, driver_rate, company_rate, distance_km, notes, description, load_address, unload_address, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      order.contractor_id || null,
      order.material || null,
      order.unit || null,
      order.quantity == null ? null : Number(order.quantity),
      order.driver_rate == null ? null : Number(order.driver_rate),
      order.company_rate == null ? null : Number(order.company_rate),
      order.distance_km == null ? null : Number(order.distance_km),
      order.notes || null,
      order.description || null,
      order.load_address || null,
      order.unload_address || null,
      req.user.id
    );
  return res.status(201).json(db.prepare(`${SELECT_SQL} WHERE t.id = ?`).get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM order_templates WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Шаблон не найден' });

  const {
    name,
    contractor_id,
    material,
    unit,
    default_quantity,
    driver_rate,
    company_rate,
    distance_km,
    notes,
    description,
    load_address,
    unload_address,
  } = req.body || {};

  const contractorId =
    contractor_id == null || contractor_id === '' ? null : Number(contractor_id);
  if (contractor_id !== undefined && contractorId != null && !Number.isFinite(contractorId)) {
    return res.status(400).json({ error: 'contractor_id должен быть числом' });
  }

  if (contractor_id !== undefined && contractorId != null) {
    const exists = db
      .prepare('SELECT id FROM contractors WHERE id = ?')
      .get(contractorId);
    if (!exists) return res.status(404).json({ error: 'Контрагент не найден' });
  }

  db.prepare(
    `UPDATE order_templates
     SET name = COALESCE(?, name),
         contractor_id = CASE WHEN ? = 1 THEN ? ELSE contractor_id END,
         material = COALESCE(?, material),
         unit = COALESCE(?, unit),
         default_quantity = COALESCE(?, default_quantity),
         driver_rate = COALESCE(?, driver_rate),
         company_rate = COALESCE(?, company_rate),
         distance_km = COALESCE(?, distance_km),
         notes = COALESCE(?, notes),
         description = COALESCE(?, description),
         load_address = COALESCE(?, load_address),
         unload_address = COALESCE(?, unload_address)
     WHERE id = ?`
  ).run(
    name ? String(name).trim() : null,
    contractor_id !== undefined ? 1 : 0,
    contractor_id !== undefined ? contractorId : null,
    material || null,
    unit || null,
    default_quantity == null || default_quantity === '' ? null : Number(default_quantity),
    driver_rate == null || driver_rate === '' ? null : Number(driver_rate),
    company_rate == null || company_rate === '' ? null : Number(company_rate),
    distance_km == null || distance_km === '' ? null : Number(distance_km),
    notes || null,
    description || null,
    load_address || null,
    unload_address || null,
    id
  );

  const row = db.prepare(`${SELECT_SQL} WHERE t.id = ?`).get(id);
  return res.json(row);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM order_templates WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Шаблон не найден' });
  db.prepare('DELETE FROM order_templates WHERE id = ?').run(id);
  return res.json({ ok: true });
});

module.exports = router;
