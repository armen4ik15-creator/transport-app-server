#!/usr/bin/env node
/**
 * Локальный запуск (production env):
 *   node scripts/purge-business-data.js --confirm PURGE-REESTRPRO
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });

const { purgeBusinessData } = require('../services/purge/purgeBusinessData');

const confirm = process.argv.includes('--confirm')
  ? process.argv[process.argv.indexOf('--confirm') + 1]
  : null;

if (confirm !== 'PURGE-REESTRPRO') {
  console.error('Usage: node scripts/purge-business-data.js --confirm PURGE-REESTRPRO');
  process.exit(1);
}

try {
  const result = purgeBusinessData({ userId: null, clearUploads: true });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
