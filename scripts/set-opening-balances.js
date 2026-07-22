/**
 * Sets contractor opening balances as of 2026-07-01.
 * Usage:
 *   node scripts/set-opening-balances.js
 * Env:
 *   API_BASE (default production URL)
 *   ADMIN_EMAIL / ADMIN_PASSWORD
 */
const API_BASE =
  process.env.API_BASE ||
  'https://armen4ik15-creator-transport-app-server-26b3.twc1.net';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const OPENING_AS_OF = '2026-07-01';

/** @type {{ match: RegExp; amount: number; createName: string }[]} */
const TARGETS = [
  { match: /злата[\s-]*строй/i, amount: 729318, createName: 'Злата-Строй, ООО' },
  { match: /неруд\s*центр/i, amount: 436007, createName: 'Неруд Центр, ООО' },
  { match: /гк\s*неруд/i, amount: 433548, createName: 'ГК Неруд, ООО' },
  { match: /стройавангард|сройавангард/i, amount: 199499, createName: 'ГК Стройавангард, ООО' },
];

async function request(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function findContractor(list, matcher) {
  return list.find((row) => matcher.test(String(row.name || ''))) || null;
}

async function main() {
  console.log(`API: ${API_BASE}`);
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const token = login.token || login.access_token;
  if (!token) throw new Error('Нет token в ответе login');

  let contractors = await request('/contractors', { token });
  if (!Array.isArray(contractors)) throw new Error('Ожидался массив contractors');

  console.log(`Контрагентов в базе: ${contractors.length}`);

  for (const target of TARGETS) {
    let row = findContractor(contractors, target.match);
    if (!row) {
      console.log(`Создаём: ${target.createName}`);
      row = await request('/contractors', {
        method: 'POST',
        token,
        body: {
          name: target.createName,
          type: 'company',
          opening_balance: target.amount,
          opening_balance_date: OPENING_AS_OF,
        },
      });
      contractors.push(row);
      console.log(`  id=${row.id} opening=${target.amount}`);
      continue;
    }

    const updated = await request(`/contractors/${row.id}`, {
      method: 'PUT',
      token,
      body: {
        opening_balance: target.amount,
        opening_balance_date: OPENING_AS_OF,
      },
    });
    console.log(
      `Обновлён: ${updated.name} (id=${updated.id}) → ${updated.opening_balance} на ${updated.opening_balance_date}`
    );
  }

  const summary = await request('/contractors/summary', { token });
  console.log('\nСводка долга после внесения:');
  for (const target of TARGETS) {
    const row = summary.find((item) => target.match.test(String(item.contractor_name || '')));
    if (!row) {
      console.log(`  ${target.createName}: не найден в summary`);
      continue;
    }
    console.log(
      `  ${row.contractor_name}: входящий=${row.opening_balance}, навезли=${row.accrued}, оплатили=${row.paid}, долг=${row.debt}`
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
