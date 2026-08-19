/**
 * Timeweb frontend deploy for ReestrPro web/ (app 240507).
 * Does NOT touch backend app 211901.
 *
 * Commands:
 *   node scripts/timeweb-deploy.js status
 *   node scripts/timeweb-deploy.js configure   # react build from /web (after web/ is on GitHub)
 *   node scripts/timeweb-deploy.js deploy        # build locally + trigger Timeweb deploy
 *
 * Env:
 *   TIMEWEB_API_TOKEN, TIMEWEB_WEB_APP_ID=240507
 *   DEPLOY_COMMIT_SHA — commit on GitHub with web/ folder
 *   DEPLOY_GITHUB_REPO=armen4ik15-creator/transport-app-server
 *   SKIP_BUILD=1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, '..');
const API_BASE = 'https://api.timeweb.cloud/api/v1';
const DEFAULT_WEB_APP_ID = '240507';
const DEFAULT_API_URL =
  'https://armen4ik15-creator-transport-app-server-26b3.twc1.net/api';
const DEFAULT_GITHUB_REPO =
  process.env.DEPLOY_GITHUB_REPO || 'armen4ik15-creator/transport-app-server';
const DEFAULT_BRANCH = process.env.DEPLOY_BRANCH || 'main';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
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
    env[key] = value;
  }
  return env;
}

function resolveToken() {
  const webEnv = loadEnvFile(path.join(WEB_ROOT, 'timeweb.env'));
  const serverEnv = loadEnvFile(path.join(WEB_ROOT, '..', 'server', 'timeweb.env'));
  return process.env.TIMEWEB_API_TOKEN || webEnv.TIMEWEB_API_TOKEN || serverEnv.TIMEWEB_API_TOKEN;
}

async function apiRequest(method, urlPath, token, body) {
  const response = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
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

async function fetchGitHubCommitSha(repo, branch) {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`);
  if (!response.ok) {
    throw new Error(`GitHub ${repo}@${branch} -> ${response.status}`);
  }
  const data = await response.json();
  if (!data.sha) throw new Error(`GitHub commit sha missing for ${repo}@${branch}`);
  return data.sha;
}

async function resolveCommitSha() {
  if (process.env.DEPLOY_COMMIT_SHA) return process.env.DEPLOY_COMMIT_SHA;
  return fetchGitHubCommitSha(DEFAULT_GITHUB_REPO, DEFAULT_BRANCH);
}

async function getApp(token, appId) {
  const data = await apiRequest('GET', `/apps/${appId}`, token, null);
  return data?.app ?? data;
}

function summarizeApp(app) {
  return {
    id: app.id,
    name: app.name,
    status: app.status,
    framework: app.framework,
    build_entry_path: app.build_entry_path,
    index_dir: app.index_dir,
    build_cmd: app.build_cmd,
    branch: app.branch,
    repository: app.repository?.full_name,
    domains: (app.domains || []).map((d) => d.fqdn || d),
    env_keys: app.envs ? Object.keys(app.envs) : [],
  };
}

function warnIfWrongSource(app) {
  const repo = app.repository?.full_name || '';
  const entry = app.build_entry_path || '';
  const problems = [];

  if (repo.includes('TransportApp') && !repo.includes('transport-app-server')) {
    problems.push(
      'Подключён репозиторий Supabase/Expo (TransportApp), а не transport-app-server с папкой web/.'
    );
  }
  if (entry === '/web-build' || entry === 'web-build') {
    problems.push(
      'Отдаётся старая static-сборка web-build (Supabase). Логин «Failed to fetch» — нет связи с Supabase.'
    );
  }
  if (app.framework === 'static-nobuild' && entry !== '/web/dist') {
    problems.push('Для static-nobuild нужен build_entry_path=/web/dist с нашим Vite dist в GitHub.');
  }
  if (app.framework === 'react' && entry !== '/web') {
    problems.push('Для react-сборки Timeweb ожидает build_entry_path=/web.');
  }
  if (!app.envs?.VITE_API_URL) {
    problems.push('Не задан VITE_API_URL при сборке — клиент может ходить не на Timeweb API.');
  }

  if (problems.length > 0) {
    console.warn('[web-deploy] ⚠ Конфигурация фронтенда:');
    problems.forEach((p) => console.warn(`  - ${p}`));
    console.warn('[web-deploy] Исправление: Timeweb → app 240507 → репозиторий transport-app-server, путь web/, React, npm ci && npm run build, dist/, env VITE_API_URL.');
  } else {
    console.log('[web-deploy] Конфигурация выглядит корректно для web/.');
  }
}

async function cmdStatus(token, appId) {
  const app = await getApp(token, appId);
  console.log(JSON.stringify(summarizeApp(app), null, 2));
  warnIfWrongSource(app);
}

async function cmdConfigure(token, appId, apiUrl) {
  const current = await getApp(token, appId);
  const envs = {
    ...(current.envs && typeof current.envs === 'object' ? current.envs : {}),
    VITE_API_URL: apiUrl,
  };

  const patch = {
    framework: 'react',
    build_cmd: 'npm ci && npm run build',
    build_entry_path: '/web',
    index_dir: '/dist',
    branch_name: DEFAULT_BRANCH,
    envs,
  };

  console.log('[web-deploy] Applying react/web settings…');
  const updated = await apiRequest('PATCH', `/apps/${appId}`, token, patch);
  console.log(JSON.stringify(summarizeApp(updated.app), null, 2));
  warnIfWrongSource(updated.app);
  console.log(
    '[web-deploy] Если repository всё ещё TransportApp — смените репозиторий в панели Timeweb на transport-app-server (API это не меняет).'
  );
}

async function cmdDeploy(token, appId, apiUrl) {
  const skipBuild = process.env.SKIP_BUILD === '1';
  if (!skipBuild) {
    console.log('[web-deploy] Running npm run build…');
    execSync('npm run build', { cwd: WEB_ROOT, stdio: 'inherit' });
  }

  const app = await getApp(token, appId);
  warnIfWrongSource(app);

  const commitSha = await resolveCommitSha();
  const envs = {
    ...(app.envs && typeof app.envs === 'object' ? app.envs : {}),
    VITE_API_URL: apiUrl,
    GIT_COMMIT_SHA: commitSha,
  };

  console.log(`[web-deploy] PATCH app ${appId}, VITE_API_URL set`);
  await apiRequest('PATCH', `/apps/${appId}`, token, { envs });

  console.log(`[web-deploy] Deploy ${DEFAULT_GITHUB_REPO}@${DEFAULT_BRANCH} commit ${commitSha}`);
  const deploy = await apiRequest('POST', `/apps/${appId}/deploy`, token, { commit_sha: commitSha });
  console.log('[web-deploy] Deploy triggered:', JSON.stringify(deploy, null, 2));
  console.log('[web-deploy] Backend app 211901 was NOT modified.');
}

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error('[web-deploy] Add TIMEWEB_API_TOKEN to web/timeweb.env or server/timeweb.env');
    process.exit(1);
  }

  const appId = process.env.TIMEWEB_WEB_APP_ID || DEFAULT_WEB_APP_ID;
  const apiUrl = process.env.VITE_API_URL || DEFAULT_API_URL;
  const command = process.argv[2] || 'deploy';

  if (command === 'status') {
    await cmdStatus(token, appId);
    return;
  }
  if (command === 'configure') {
    await cmdConfigure(token, appId, apiUrl);
    return;
  }
  if (command === 'deploy') {
    await cmdDeploy(token, appId, apiUrl);
    return;
  }

  console.error(`Unknown command: ${command}. Use: status | configure | deploy`);
  process.exit(1);
}

main().catch((error) => {
  console.error('[web-deploy]', error.message);
  process.exit(1);
});
