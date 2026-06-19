/**
 * Create Timeweb Backend (Node/Express) app in private network — no Docker bridge.
 * Usage: node scripts/timeweb-create-backend-app.js
 */
require('dotenv').config({
  path: require('path').join(__dirname, '../timeweb.env'),
  override: true,
});

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.timeweb.cloud/api/v1';
const TOKEN = process.env.TIMEWEB_API_TOKEN;
const ENV_FILE = path.join(__dirname, '../timeweb.env');
const PRIVATE_NETWORK_ID = 'network-bd16d5320ecf4761a9577b27cd344a4d';
const PRIVATE_IP = process.env.TIMEWEB_PRIVATE_IP || '192.168.0.7';
const SOURCE_APP_ID = process.env.TIMEWEB_APP_ID || '211879';

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const envs = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key || key.startsWith('TIMEWEB_')) continue;
    if (value.includes('YOUR_')) continue;
    envs[key] = value;
  }
  return envs;
}

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

async function fetchLatestCommitSha() {
  const response = await fetch(
    'https://api.github.com/repos/armen4ik15-creator/transport-app-server/commits/main'
  );
  if (!response.ok) throw new Error(`GitHub commits/main -> ${response.status}`);
  const data = await response.json();
  if (!data.sha) throw new Error('GitHub commit sha missing');
  return data.sha;
}

async function main() {
  if (!TOKEN) {
    console.error('[create-backend] TIMEWEB_API_TOKEN missing');
    process.exit(1);
  }

  const source = await apiRequest('GET', `/apps/${SOURCE_APP_ID}`, null);
  const app = source.app;
  const commitSha = await fetchLatestCommitSha();
  const fileEnvs = parseEnvFile(ENV_FILE);

  const payload = {
    type: 'backend',
    provider_id: app.provider.id,
    repository_id: app.repository.id,
    branch_name: 'main',
    build_cmd: 'npm install --production',
    run_cmd: 'npm start',
    framework: 'express',
    env_version: '20',
    is_auto_deploy: true,
    commit_sha: commitSha,
    name: 'ReestrPro Backend',
    comment: 'Node backend in private network for PostgreSQL 192.168.0.5',
    preset_id: app.preset_id,
    project_id: app.project_id,
    system_dependencies: ['python3', 'make', 'g++'],
    envs: {
      ...fileEnvs,
      APP_VERSION: '1.3.0',
      GIT_COMMIT_SHA: commitSha,
      DB_HOST: '192.168.0.5',
      DATABASE_SSL: 'false',
      DB_FALLBACK_HOSTS: '',
      PORT: '3000',
      DATA_DIR: './data',
    },
    network: {
      id: PRIVATE_NETWORK_ID,
      ip: PRIVATE_IP,
    },
  };

  console.log('[create-backend] Creating backend app...');
  try {
    const created = await apiRequest('POST', '/apps', payload);
    console.log('[create-backend] Success:', JSON.stringify(created, null, 2));
  } catch (error) {
    console.warn('[create-backend] network object failed, retrying with network_id...');
    const fallbackPayload = {
      ...payload,
      network: undefined,
      network_id: PRIVATE_NETWORK_ID,
      private_ip: PRIVATE_IP,
    };
    const created = await apiRequest('POST', '/apps', fallbackPayload);
    console.log('[create-backend] Success (fallback):', JSON.stringify(created, null, 2));
  }
}

main().catch((error) => {
  console.error('[create-backend]', error.message);
  process.exit(1);
});
