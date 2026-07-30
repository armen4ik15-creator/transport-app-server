const fs = require('fs');
const Database = require('better-sqlite3');
const { DB_PATH, ensureDataStorage } = require('../config/paths');
const { seedDefaultAdmin, seedFounderAdmin } = require('./seedUsers');

function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function ensureColumn(db, table, column, definition) {
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
}

function migrate(db) {
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
      status TEXT CHECK(status IN ('loading','completed')),
      ttn_number TEXT,
      volume REAL,
      note TEXT,
      photo_path TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
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
      kind TEXT NOT NULL DEFAULT 'general',
      ref_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_registration_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS driver_registration_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      license_number TEXT,
      license_expiry TEXT,
      medical_check_expiry TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected')),
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      rejection_reason TEXT,
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_reg_pending_email
      ON admin_registration_requests(email) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_admin_reg_status ON admin_registration_requests(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_reg_pending_email
      ON driver_registration_requests(email) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_driver_reg_status ON driver_registration_requests(status);
    CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);

    CREATE TABLE IF NOT EXISTS fuel_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      card_number TEXT NOT NULL UNIQUE,
      label TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fuel_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'mock',
      card_number TEXT NOT NULL,
      driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
      transaction_at TEXT NOT NULL,
      station_name TEXT,
      amount REAL NOT NULL,
      liters REAL,
      car_number TEXT,
      expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      raw_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fuel_settings (
      id INTEGER PRIMARY KEY,
      data_source TEXT NOT NULL DEFAULT 'mock',
      opti_login TEXT,
      opti_password TEXT,
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 5,
      last_sync_at TEXT,
      last_sync_status TEXT,
      last_sync_new_count INTEGER NOT NULL DEFAULT 0,
      last_sync_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fuel_sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      source TEXT,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS company_cash_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      opening_cash_balance REAL NOT NULL DEFAULT 0,
      opening_cash_date TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS imprest_holders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role_note TEXT,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS imprest_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holder_id INTEGER NOT NULL REFERENCES imprest_holders(id) ON DELETE CASCADE,
      move_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount REAL NOT NULL,
      comment TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_imprest_movements_holder ON imprest_movements(holder_id);

    CREATE INDEX IF NOT EXISTS idx_fuel_cards_driver ON fuel_cards(driver_id);
    CREATE INDEX IF NOT EXISTS idx_fuel_transactions_driver ON fuel_transactions(driver_id);
    CREATE INDEX IF NOT EXISTS idx_fuel_transactions_date ON fuel_transactions(transaction_at);
    CREATE INDEX IF NOT EXISTS idx_fuel_sync_logs_started ON fuel_sync_logs(started_at);

    CREATE TABLE IF NOT EXISTS device_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      secret TEXT NOT NULL,
      activation_token TEXT NOT NULL,
      platform TEXT,
      app_version TEXT,
      blocked INTEGER NOT NULL DEFAULT 0,
      block_reason TEXT,
      blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      blocked_at TEXT,
      last_heartbeat_at TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_device_secrets_user ON device_secrets(user_id);
    CREATE INDEX IF NOT EXISTS idx_device_secrets_blocked ON device_secrets(blocked);

    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL CHECK(doc_type IN ('sts', 'contract', 'pts', 'insurance', 'driver_passport')),
      file_path TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_documents_type ON vehicle_documents(doc_type);
  `);

  ensureColumn(db, 'users', 'full_name', 'full_name TEXT');
  ensureColumn(db, 'users', 'phone', 'phone TEXT');
  ensureColumn(db, 'users', 'password_reset_enabled', 'password_reset_enabled INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'is_owner', 'is_owner INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'notifications', 'kind', `kind TEXT NOT NULL DEFAULT 'general'`);
  ensureColumn(db, 'notifications', 'ref_id', 'ref_id INTEGER');
  ensureColumn(db, 'drivers', 'license_number', 'license_number TEXT');
  ensureColumn(db, 'drivers', 'license_expiry', 'license_expiry TEXT');
  ensureColumn(db, 'drivers', 'medical_check_expiry', 'medical_check_expiry TEXT');
  ensureColumn(db, 'drivers', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'drivers', 'car_number', 'car_number TEXT');
  ensureColumn(db, 'drivers', 'senior_shift_bonus', 'senior_shift_bonus REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'contractors', 'type', `type TEXT NOT NULL DEFAULT 'company'`);
  ensureColumn(db, 'contractors', 'created_by', 'created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  ensureColumn(db, 'contractors', 'opening_balance', 'opening_balance REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'contractors', 'opening_balance_date', 'opening_balance_date TEXT');
  ensureColumn(db, 'orders', 'material', 'material TEXT');
  ensureColumn(db, 'orders', 'quantity', 'quantity REAL');
  ensureColumn(db, 'orders', 'unit', 'unit TEXT');
  ensureColumn(db, 'orders', 'notes', 'notes TEXT');
  ensureColumn(db, 'orders', 'driver_rate', 'driver_rate REAL');
  ensureColumn(db, 'orders', 'company_rate', 'company_rate REAL');
  ensureColumn(db, 'orders', 'distance_km', 'distance_km REAL');
  ensureColumn(db, 'orders', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'orders', 'task_name', 'task_name TEXT');
  ensureColumn(db, 'orders', 'sender', 'sender TEXT');
  ensureColumn(db, 'orders', 'receiver', 'receiver TEXT');
  ensureColumn(db, 'orders', 'total_planned_volume', 'total_planned_volume REAL');
  ensureColumn(db, 'orders', 'created_by', 'created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  ensureColumn(db, 'order_photos', 'uploaded_by', 'uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  ensureColumn(db, 'driver_payments', 'method', `method TEXT CHECK(method IN ('cash','noncash'))`);
  ensureColumn(db, 'driver_payments', 'period_start', 'period_start TEXT');
  ensureColumn(db, 'driver_payments', 'period_end', 'period_end TEXT');
  ensureColumn(db, 'contractor_payments', 'payment_date', 'payment_date TEXT');
  ensureColumn(db, 'expenses', 'status', `status TEXT DEFAULT 'approved'`);
  ensureColumn(db, 'expenses', 'source', `source TEXT DEFAULT 'admin'`);
  ensureColumn(db, 'expenses', 'rejection_reason', 'rejection_reason TEXT');
  ensureColumn(db, 'expenses', 'photo_path', 'photo_path TEXT');
  ensureColumn(db, 'expenses', 'updated_at', 'updated_at TEXT');
}

function seedAdmin(db) {
  seedDefaultAdmin(db);
  seedFounderAdmin(db);
}

function init() {
  ensureDataStorage();
  if (!fs.existsSync(DB_PATH)) {
    console.log(`[data] Creating new database at ${DB_PATH}`);
  }
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedAdmin(db);
  console.log(`[data] SQLite database: ${DB_PATH}`);
  db.kind = 'sqlite';
  return db;
}

module.exports = { init };
