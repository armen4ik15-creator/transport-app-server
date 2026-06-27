const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { UPLOADS_DIR } = require('../../config/paths');
const { logActivity } = require('../../utils/activity');

const PURGE_STATEMENTS = [
  'DELETE FROM fuel_transactions',
  'DELETE FROM order_photos',
  'DELETE FROM documents',
  'DELETE FROM waybills',
  'DELETE FROM invoices',
  'DELETE FROM trips',
  'DELETE FROM orders',
  'DELETE FROM finances',
  'DELETE FROM expenses',
  'DELETE FROM driver_payments',
  'DELETE FROM contractor_payments',
  'DELETE FROM order_templates',
  'DELETE FROM notifications',
  'DELETE FROM activity_log',
  'DELETE FROM admin_registration_requests',
  'DELETE FROM driver_registration_requests',
  'DELETE FROM fuel_sync_logs',
  'DELETE FROM contractors',
  'DELETE FROM materials',
  'DELETE FROM vehicles',
];

function removeDirectoryContents(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return { removedFiles: 0, removedDirs: 0 };
  }

  let removedFiles = 0;
  let removedDirs = 0;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = removeDirectoryContents(fullPath);
      removedFiles += nested.removedFiles;
      removedDirs += nested.removedDirs;
      fs.rmdirSync(fullPath);
      removedDirs += 1;
    } else {
      fs.unlinkSync(fullPath);
      removedFiles += 1;
    }
  });

  return { removedFiles, removedDirs };
}

function countRows(table) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

function purgeBusinessData({ userId = null, clearUploads = true } = {}) {
  if (db.kind === 'postgres_error') {
    throw new Error('База данных недоступна');
  }

  const before = {
    orders: countRows('orders'),
    trips: countRows('trips'),
    expenses: countRows('expenses'),
    finances: countRows('finances'),
    driver_payments: countRows('driver_payments'),
    contractors: countRows('contractors'),
  };

  db.transaction(() => {
    PURGE_STATEMENTS.forEach((sql) => {
      db.prepare(sql).run();
    });
  });

  let uploads = { removedFiles: 0, removedDirs: 0 };
  if (clearUploads) {
    uploads = removeDirectoryContents(UPLOADS_DIR);
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    ['trips', 'expenses', 'documents', 'orders'].forEach((subdir) => {
      fs.mkdirSync(path.join(UPLOADS_DIR, subdir), { recursive: true });
    });
  }

  const after = {
    orders: countRows('orders'),
    trips: countRows('trips'),
    expenses: countRows('expenses'),
    users: countRows('users'),
    drivers: countRows('drivers'),
  };

  logActivity(userId, 'admin.purge_business_data', {
    before,
    after,
    uploads,
  });

  return {
    ok: true,
    before,
    after,
    uploads,
    kept: ['users', 'drivers', 'fuel_cards', 'fuel_settings', 'document_templates'],
  };
}

module.exports = { purgeBusinessData };
