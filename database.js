const path = require('path');
const Database = require('better-sqlite3');
const { hashPasswordSync } = require('./utils/password');

const DB_PATH = path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function ensureColumn(table, column, definition) {
  if (hasColumn(table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','driver')),
      full_name TEXT,
      phone TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      license_number TEXT,
      license_expiry TEXT,
      medical_check_expiry TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      car_number TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contractors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'company',
      phone TEXT,
      address TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
      contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
      material TEXT,
      quantity REAL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','in_progress','completed','cancelled')),
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      description TEXT,
      load_address TEXT,
      unload_address TEXT,
      amount REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS finances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      amount REAL NOT NULL,
      description TEXT,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('waybill','invoice','act')),
      file_path TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('waybill','invoice','act')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id);
    CREATE INDEX IF NOT EXISTS idx_orders_contractor ON orders(contractor_id);
    CREATE INDEX IF NOT EXISTS idx_order_photos_order ON order_photos(order_id);
    CREATE INDEX IF NOT EXISTS idx_finances_driver ON finances(driver_id);
    CREATE INDEX IF NOT EXISTS idx_finances_order ON finances(order_id);
    CREATE INDEX IF NOT EXISTS idx_documents_order ON documents(order_id);
    CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
  `);

  // Backward-compatible online migration for existing SQLite files.
  ensureColumn('users', 'full_name', 'full_name TEXT');
  ensureColumn('users', 'phone', 'phone TEXT');

  ensureColumn('drivers', 'license_number', 'license_number TEXT');
  ensureColumn('drivers', 'license_expiry', 'license_expiry TEXT');
  ensureColumn('drivers', 'medical_check_expiry', 'medical_check_expiry TEXT');
  ensureColumn('drivers', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
  ensureColumn('drivers', 'car_number', 'car_number TEXT');

  ensureColumn('contractors', 'type', `type TEXT NOT NULL DEFAULT 'company'`);
  ensureColumn(
    'contractors',
    'created_by',
    'created_by INTEGER REFERENCES users(id) ON DELETE SET NULL'
  );

  ensureColumn('orders', 'material', 'material TEXT');
  ensureColumn('orders', 'quantity', 'quantity REAL');
  ensureColumn('orders', 'notes', 'notes TEXT');
  ensureColumn(
    'orders',
    'created_by',
    'created_by INTEGER REFERENCES users(id) ON DELETE SET NULL'
  );

  ensureColumn(
    'order_photos',
    'uploaded_by',
    'uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL'
  );
}

function seedAdmin() {
  const email = 'admin@test.com';
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return;
  const hash = hashPasswordSync('admin123');
  db.prepare(
    'INSERT INTO users (email, password_hash, role, full_name, phone) VALUES (?, ?, ?, ?, ?)'
  ).run(
    email,
    hash,
    'admin',
    'Тестовый Администратор',
    null
  );
  console.log('[seed] admin@test.com / admin123 создан');
}

migrate();
seedAdmin();

module.exports = db;
