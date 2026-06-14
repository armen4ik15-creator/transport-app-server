const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const db = require('../../database');
const { DB_PATH } = require('../../config/paths');
const { buildConnectionString, isPostgresEnabled } = require('../../database/connection');

const EXPORT_TABLES = [
  'users',
  'drivers',
  'contractors',
  'orders',
  'order_photos',
  'finances',
  'documents',
  'document_templates',
  'order_templates',
  'trips',
  'driver_payments',
  'contractor_payments',
  'expenses',
  'materials',
  'vehicles',
  'waybills',
  'invoices',
  'notifications',
  'activity_log',
  'fuel_cards',
  'fuel_transactions',
  'fuel_settings',
];

function exportPostgresJson(targetDir) {
  const exportDir = path.join(targetDir, 'json');
  fs.mkdirSync(exportDir, { recursive: true });
  const summary = {};

  EXPORT_TABLES.forEach((table) => {
    try {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      fs.writeFileSync(path.join(exportDir, `${table}.json`), JSON.stringify(rows, null, 2), 'utf8');
      summary[table] = rows.length;
    } catch (error) {
      summary[table] = { error: error.message };
    }
  });

  fs.writeFileSync(
    path.join(exportDir, '_summary.json'),
    JSON.stringify({ exported_at: new Date().toISOString(), tables: summary }, null, 2),
    'utf8'
  );

  return { kind: 'postgres_json', summary };
}

function dumpPostgresSql(targetFile) {
  const connectionString = buildConnectionString();
  if (!connectionString) {
    throw new Error('PostgreSQL connection string is not configured');
  }

  const result = spawnSync('pg_dump', ['--no-owner', '--no-acl', connectionString, '-f', targetFile], {
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.status !== 0 || !fs.existsSync(targetFile)) {
    throw new Error(result.stderr || 'pg_dump failed');
  }

  return { kind: 'postgres_sql', file: targetFile };
}

function backupSqlite(targetFile) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`SQLite database not found: ${DB_PATH}`);
  }
  const source = new Database(DB_PATH, { readonly: true });
  source.backup(targetFile);
  source.close();
  return { kind: 'sqlite', file: targetFile };
}

function exportDatabase(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  if (isPostgresEnabled() && db.kind === 'postgres') {
    const sqlFile = path.join(targetDir, 'database.sql');
    try {
      return dumpPostgresSql(sqlFile);
    } catch (error) {
      console.warn('[backup] pg_dump unavailable, falling back to JSON export:', error.message);
      return exportPostgresJson(targetDir);
    }
  }

  const sqliteFile = path.join(targetDir, 'database.sqlite');
  return backupSqlite(sqliteFile);
}

module.exports = { exportDatabase, EXPORT_TABLES };
