/**
 * Upload env from timeweb.env and trigger redeploy on Timeweb App Platform.
 * Requires TIMEWEB_API_TOKEN in server/timeweb.env (from Timeweb -> API keys).
 *
 *   node scripts/timeweb-deploy.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../timeweb.env') });
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.timeweb.cloud/api/v1';
const TOKEN = process.env.TIMEWEB_API_TOKEN;
const APP_ID = process.env.TIMEWEB_APP_ID || '199564';
const ENV_FILE = path.join(__dirname, '../timeweb.env');

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
  if (!response.ok) {
    throw new Error(`GitHub commits/main -> ${response.status}`);
  }
  const data = await response.json();
  if (!data.sha) {
    throw new Error('GitHub commit sha missing');
  }
  return data.sha;
}

async function fetchCurrentEnvs() {
  const data = await apiRequest('GET', `/apps/${APP_ID}`, null);
  return data?.app?.envs && typeof data.app.envs === 'object' ? { ...data.app.envs } : {};
}

async function main() {
  if (!TOKEN) {
    console.error('[timeweb-deploy] Add TIMEWEB_API_TOKEN to server/timeweb.env');
    process.exit(1);
  }
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`[timeweb-deploy] Missing ${ENV_FILE}`);
    process.exit(1);
  }

  const fileEnvs = parseEnvFile(ENV_FILE);
  const currentEnvs = await fetchCurrentEnvs();
  const envs = { ...currentEnvs, ...fileEnvs };
  console.log(`[timeweb-deploy] Updating app ${APP_ID} (${Object.keys(envs).length} env vars, merged)...`);
  await apiRequest('PATCH', `/apps/${APP_ID}`, { envs });

  console.log('[timeweb-deploy] Starting deploy...');
  const commitSha = process.env.DEPLOY_COMMIT_SHA || (await fetchLatestCommitSha());
  console.log(`[timeweb-deploy] commit_sha=${commitSha}`);
  const deploy = await apiRequest('POST', `/apps/${APP_ID}/deploy`, { commit_sha: commitSha });
  console.log('[timeweb-deploy] Deploy triggered:', JSON.stringify(deploy, null, 2));
}

main().catch((error) => {
  console.error('[timeweb-deploy]', error.message);
  process.exit(1);
});
