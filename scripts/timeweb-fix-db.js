/**
 * Fix PostgreSQL connectivity for Timeweb App 211879 via API.
 * Usage: node scripts/timeweb-fix-db.js
 */
require('dotenv').config({
  path: require('path').join(__dirname, '../timeweb.env'),
  override: true,
});

const API_BASE = 'https://api.timeweb.cloud/api/v1';
const TOKEN = process.env.TIMEWEB_API_TOKEN;
const APP_ID = process.env.TIMEWEB_APP_ID || '211879';
const DB_ID = 4171291;
const FIREWALL_GROUP_ID = '08bedf3e-f97d-4d26-aa14-5916ca7156dc';
const DUPLICATE_GROUP_ID = '2a82ddc9-7bd5-4e2f-861e-5bbfffab60fa';
const APP_PUBLIC_IP = '72.56.234.162';
const DB_PUBLIC_IP = '186.246.12.45';
const HEALTH_URL =
  'https://armen4ik15-creator-transport-app-server-1d1c.twc1.net/api/health';
const LOGIN_URL =
  'https://armen4ik15-creator-transport-app-server-1d1c.twc1.net/api/auth/login';

async function apiRequest(method, urlPath, body) {
  const response = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Timeweb ${method} ${urlPath} -> ${response.status}: ${text}`);
  }
  return data;
}

async function ensureFirewallRules() {
  const existing = await apiRequest('GET', `/firewall/groups/${FIREWALL_GROUP_ID}/rules`);
  const rules = existing.rules || [];
  const cidrsToAdd = [
    `${APP_PUBLIC_IP}/32`,
    '192.168.0.0/24',
    '192.168.128.0/17',
    '192.168.160.0/24',
  ];

  for (const cidr of cidrsToAdd) {
    const already = rules.some((rule) => rule.cidr === cidr && rule.port === '5432');
    if (already) {
      console.log(`[fix-db] firewall rule exists: ${cidr}`);
      continue;
    }
    await apiRequest('POST', `/firewall/groups/${FIREWALL_GROUP_ID}/rules`, {
      direction: 'ingress',
      protocol: 'tcp',
      port: '5432',
      cidr,
      description: 'ReestrPro App to PostgreSQL',
    });
    console.log(`[fix-db] firewall rule added: ${cidr}`);
  }

  try {
    await apiRequest(
      'DELETE',
      `/firewall/groups/${DUPLICATE_GROUP_ID}/resources/${DB_ID}`
    );
    console.log('[fix-db] removed duplicate firewall group from database');
  } catch (error) {
    console.warn('[fix-db] duplicate group unlink skipped:', error.message);
  }
}

async function updateAppEnv() {
  const current = await apiRequest('GET', `/apps/${APP_ID}`);
  const envs = {
    ...(current.app?.envs || {}),
    DB_HOST: DB_PUBLIC_IP,
    DB_FALLBACK_HOSTS: '',
    DATABASE_SSL: 'true',
    DB_CONNECT_TIMEOUT_SEC: '15',
    DB_FAST_STARTUP: 'true',
  };
  await apiRequest('PATCH', `/apps/${APP_ID}`, { envs });
  console.log('[fix-db] app env updated (DB_HOST=public IP, no DNS fallback)');
}

async function rebootApp() {
  await apiRequest('PATCH', `/apps/${APP_ID}/action/reboot`, {});
  console.log('[fix-db] app reboot triggered');
}

async function waitMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollHealth(maxAttempts = 16) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      console.log(
        `[fix-db] health ${attempt}/${maxAttempts}: db_connected=${data.db_connected} db_error=${data.db_error || 'none'}`
      );
      if (data.db_connected === true) {
        return data;
      }
    } catch (error) {
      console.warn(`[fix-db] health ${attempt}/${maxAttempts} failed:`, error.message);
    }
    await waitMs(15000);
  }
  return null;
}

async function testLogin() {
  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.FOUNDER_ADMIN_EMAIL || 'aram_grigoryan96@bk.ru',
      password: process.env.FOUNDER_ADMIN_PASSWORD || '1998ara16',
    }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  console.log(`[fix-db] login HTTP ${response.status}: ${text.slice(0, 200)}`);
  return response.status;
}

async function main() {
  if (!TOKEN) {
    console.error('[fix-db] TIMEWEB_API_TOKEN missing in timeweb.env');
    process.exit(1);
  }

  await ensureFirewallRules();
  await updateAppEnv();
  await rebootApp();
  console.log('[fix-db] waiting 90s for reboot...');
  await waitMs(90000);

  const health = await pollHealth();
  const loginStatus = await testLogin();

  if (health?.db_connected && loginStatus === 200) {
    console.log('[fix-db] SUCCESS: database connected and login works');
    return;
  }

  console.log('[fix-db] still failing — Timeweb support ticket may be required');
  console.log(
    '[fix-db] issue: Docker container on App Platform cannot route to PostgreSQL reliably'
  );
}

main().catch((error) => {
  console.error('[fix-db]', error.message);
  process.exit(1);
});
