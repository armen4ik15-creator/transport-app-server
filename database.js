const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { hashPasswordSync } = require('./utils/password');
const { DB_PATH, ensureDataStorage } = require('./config/paths');

ensureDataStorage();

if (!fs.existsSync(DB_PATH)) {
  console.log(`[data] Creating new database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
console.log(`[data] SQLite database: ${DB_PATH}`);

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
      unit TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','in_progress','completed','cancelled')),
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      description TEXT,
      load_address TEXT,
      unload_address TEXT,
      amount REAL,
      driver_rate REAL,
      company_rate REAL,
      distance_km REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS order_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
      material TEXT,
      unit TEXT,
      default_quantity REAL,
      driver_rate REAL,
      company_rate REAL,
      distance_km REAL,
      notes TEXT,
      description TEXT,
      load_address TEXT,
      unload_address TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK(stage IN ('loading','unloading')),
      ttn_number TEXT,
      volume REAL,
      note TEXT,
      photo_path TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS driver_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('salary','advance','bonus','deduction')),
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contractor_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exp_date TEXT NOT NULL DEFAULT (date('now')),
      exp_type TEXT NOT NULL DEFAULT 'other',
      method TEXT CHECK(method IN ('cash','noncash')),
      amount REAL NOT NULL,
      comment TEXT,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
      car_number TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL DEFAULT 'т',
      price_per_ton REAL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_number TEXT NOT NULL UNIQUE,
      model TEXT,
      capacity REAL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS waybills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      number TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT (date('now')),
      file_path TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      number TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT (date('now')),
      amount REAL,
      file_path TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_order_templates_contractor ON order_templates(contractor_id);
    CREATE INDEX IF NOT EXISTS idx_trips_order ON trips(order_id);
    CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);
    CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips(created_at);
    CREATE INDEX IF NOT EXISTS idx_driver_payments_driver ON driver_payments(driver_id);
    CREATE INDEX IF NOT EXISTS idx_contractor_payments_contractor ON contractor_payments(contractor_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(exp_date);
    CREATE INDEX IF NOT EXISTS idx_expenses_driver ON expenses(driver_id);
    CREATE INDEX IF NOT EXISTS idx_waybills_order ON waybills(order_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
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
  ensureColumn('orders', 'unit', 'unit TEXT');
  ensureColumn('orders', 'notes', 'notes TEXT');
  ensureColumn('orders', 'driver_rate', 'driver_rate REAL');
  ensureColumn('orders', 'company_rate', 'company_rate REAL');
  ensureColumn('orders', 'distance_km', 'distance_km REAL');
  ensureColumn('orders', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
  ensureColumn('orders', 'task_name', 'task_name TEXT');
  ensureColumn('orders', 'sender', 'sender TEXT');
  ensureColumn('orders', 'receiver', 'receiver TEXT');
  ensureColumn('orders', 'total_planned_volume', 'total_planned_volume REAL');
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
