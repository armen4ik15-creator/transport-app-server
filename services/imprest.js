const db = require('../database');

const HOLDER_SELECT = `
  SELECT
    h.id, h.name, h.role_note, h.opening_balance, h.opening_balance_date,
    h.is_active, h.created_at
  FROM imprest_holders h
`;

const MOVEMENT_SELECT = `
  SELECT
    m.id, m.holder_id, m.move_date, m.kind, m.amount, m.comment,
    m.created_by, m.created_at
  FROM imprest_movements m
`;

function ensureImprestTables() {
  // PostgreSQL: таблицы создаются из SCHEMA_SQL при старте.
  if (db.kind === 'postgres') return;

  db.prepare(
    `CREATE TABLE IF NOT EXISTS imprest_holders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role_note TEXT,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS imprest_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holder_id INTEGER NOT NULL,
      move_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount REAL NOT NULL,
      comment TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_imprest_movements_holder ON imprest_movements(holder_id)`
  ).run();
}

function calcHolderBalance(holderId, openingBalance) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'issue' THEN amount ELSE 0 END), 0) AS issued,
         COALESCE(SUM(CASE WHEN kind IN ('report', 'return') THEN amount ELSE 0 END), 0) AS closed
       FROM imprest_movements
       WHERE holder_id = ?`
    )
    .get(holderId);
  return Number(openingBalance || 0) + Number(row?.issued || 0) - Number(row?.closed || 0);
}

function listImprestHolders() {
  ensureImprestTables();
  const rows = db.prepare(`${HOLDER_SELECT} ORDER BY h.name`).all();
  return rows.map((row) => ({
    ...row,
    opening_balance: Number(row.opening_balance || 0),
    is_active: Number(row.is_active) === 1,
    balance: calcHolderBalance(row.id, row.opening_balance),
  }));
}

function getImprestHolder(id) {
  ensureImprestTables();
  const row = db.prepare(`${HOLDER_SELECT} WHERE h.id = ?`).get(id);
  if (!row) return null;
  return {
    ...row,
    opening_balance: Number(row.opening_balance || 0),
    is_active: Number(row.is_active) === 1,
    balance: calcHolderBalance(row.id, row.opening_balance),
  };
}

function createImprestHolder({ name, role_note, opening_balance, opening_balance_date, is_active }) {
  ensureImprestTables();
  const safeName = String(name || '').trim();
  if (!safeName) throw new Error('name обязателен');

  const opening = Number(opening_balance ?? 0);
  if (!Number.isFinite(opening) || opening < 0) {
    throw new Error('opening_balance должен быть числом ≥ 0');
  }

  let openingDate = null;
  if (opening_balance_date != null && String(opening_balance_date).trim() !== '') {
    openingDate = String(opening_balance_date).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate)) {
      throw new Error('opening_balance_date должен быть YYYY-MM-DD');
    }
  }

  const result = db
    .prepare(
      `INSERT INTO imprest_holders
       (name, role_note, opening_balance, opening_balance_date, is_active)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      safeName,
      role_note ? String(role_note).trim() : null,
      opening,
      openingDate,
      is_active == null ? 1 : Number(Boolean(is_active))
    );

  return getImprestHolder(result.lastInsertRowid);
}

function listImprestMovements(holderId) {
  ensureImprestTables();
  return db
    .prepare(`${MOVEMENT_SELECT} WHERE m.holder_id = ? ORDER BY m.move_date DESC, m.id DESC`)
    .all(holderId)
    .map((row) => ({
      ...row,
      amount: Number(row.amount || 0),
    }));
}

function findMovementByComment(comment) {
  ensureImprestTables();
  if (!comment) return null;
  return db.prepare(`${MOVEMENT_SELECT} WHERE m.comment = ?`).get(comment);
}

function createImprestMovement({ holder_id, move_date, kind, amount, comment, created_by }) {
  ensureImprestTables();
  const holderId = Number(holder_id);
  if (!Number.isFinite(holderId) || holderId <= 0) {
    throw new Error('holder_id обязателен');
  }
  const holder = getImprestHolder(holderId);
  if (!holder) throw new Error('Держатель подотчёта не найден');

  const safeKind = String(kind || '').trim();
  if (!['issue', 'report', 'return'].includes(safeKind)) {
    throw new Error('kind должен быть issue, report или return');
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('amount должен быть положительным числом');
  }

  const moveDate = move_date
    ? String(move_date).trim().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(moveDate)) {
    throw new Error('move_date должен быть YYYY-MM-DD');
  }

  const safeComment = comment ? String(comment).trim() : null;
  if (safeComment) {
    const existing = findMovementByComment(safeComment);
    if (existing) {
      return {
        ...existing,
        amount: Number(existing.amount || 0),
        _duplicate: true,
      };
    }
  }

  const result = db
    .prepare(
      `INSERT INTO imprest_movements
       (holder_id, move_date, kind, amount, comment, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(holderId, moveDate, safeKind, numericAmount, safeComment, created_by || null);

  const row = db.prepare(`${MOVEMENT_SELECT} WHERE m.id = ?`).get(result.lastInsertRowid);
  return {
    ...row,
    amount: Number(row.amount || 0),
  };
}

function getImprestTotals() {
  ensureImprestTables();
  const holders = listImprestHolders().filter((h) => h.is_active);
  const outstanding = holders.reduce((sum, h) => sum + Math.max(0, h.balance), 0);
  return {
    holders_count: holders.length,
    outstanding,
    holders: holders.map((h) => ({
      id: h.id,
      name: h.name,
      balance: h.balance,
    })),
  };
}

module.exports = {
  ensureImprestTables,
  listImprestHolders,
  getImprestHolder,
  createImprestHolder,
  listImprestMovements,
  createImprestMovement,
  findMovementByComment,
  getImprestTotals,
};
