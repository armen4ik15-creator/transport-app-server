const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','driver')),
  full_name TEXT,
  phone TEXT,
  password_reset_enabled INTEGER NOT NULL DEFAULT 0,
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  license_number TEXT,
  license_expiry TEXT,
  medical_check_expiry TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  car_number TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS contractors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'company',
  phone TEXT,
  address TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
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
  task_name TEXT,
  sender TEXT,
  receiver TEXT,
  total_planned_volume REAL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  updated_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS order_photos (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS finances (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  amount REAL NOT NULL,
  description TEXT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('waybill','invoice','act')),
  file_path TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS document_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('waybill','invoice','act')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS order_templates (
  id SERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

    CREATE TABLE IF NOT EXISTS trips (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK(stage IN ('loading','unloading')),
      status TEXT CHECK(status IN ('loading','completed')),
      ttn_number TEXT,
      volume REAL,
      note TEXT,
      photo_path TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      completed_at TEXT
    );

CREATE TABLE IF NOT EXISTS driver_payments (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('salary','advance','bonus','deduction')),
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS contractor_payments (
  id SERIAL PRIMARY KEY,
  contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  exp_date TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
  exp_type TEXT NOT NULL DEFAULT 'other',
  method TEXT CHECK(method IN ('cash','noncash')),
  amount REAL NOT NULL,
  comment TEXT,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  car_number TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL DEFAULT 'т',
  price_per_ton REAL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  plate_number TEXT NOT NULL UNIQUE,
  model TEXT,
  capacity REAL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS waybills (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
  file_path TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
  amount REAL,
  file_path TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  "read" INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'general',
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS admin_registration_requests (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS driver_registration_requests (
  id SERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'general';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id INTEGER;

ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS method TEXT CHECK(method IN ('cash','noncash'));
ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS period_start TEXT;
ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS period_end TEXT;
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS payment_date TEXT;

CREATE TABLE IF NOT EXISTS fuel_cards (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  card_number TEXT NOT NULL UNIQUE,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS fuel_transactions (
  id SERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
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
  updated_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS fuel_sync_logs (
  id SERIAL PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  source TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_fuel_cards_driver ON fuel_cards(driver_id);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_driver ON fuel_transactions(driver_id);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_date ON fuel_transactions(transaction_at);
CREATE INDEX IF NOT EXISTS idx_fuel_sync_logs_started ON fuel_sync_logs(started_at);
`;

module.exports = { SCHEMA_SQL };
