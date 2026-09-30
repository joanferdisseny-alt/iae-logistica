const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function load(file, resolve = require, logger = console) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', code)(resolve, module, module.exports, logger);
  return module.exports;
}
const logs = [];
const { handleDatabaseCheck } = load('lib/database-check.ts', require, { error: message => logs.push(message) });
const env = { CRON_SECRET: 'test-cron-secret' };
const request = (headers = { authorization: `Bearer ${env.CRON_SECRET}` }) => new Request('https://example.org/api/cron/database-check', { headers });

function database(result = { data: [{ code: 'admin' }], error: null }) {
  const calls = [];
  const query = {
    select(value) { calls.push(['select', value]); return query; },
    limit(value) { calls.push(['limit', value]); return query; },
    async abortSignal(signal) { assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted, false); calls.push(['abortSignal']); return result; }
  };
  return { calls, from(table) { calls.push(['from', table]); return query; } };
}

test('missing cron configuration fails closed before privileged client creation', async () => {
  for (const secret of [undefined, '', ' ', 'secret\n', 'secret\r']) {
    const result = await handleDatabaseCheck(request(), { env: { CRON_SECRET: secret }, createClient: () => assert.fail('must not load') });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
});

test('only the correct bearer token grants access; cookies and query parameters cannot bypass it', async () => {
  for (const headers of [{}, { authorization: 'Bearer incorrect' }, { authorization: 'Bearer test-cron-secrex' }, { 'x-cron-secret': env.CRON_SECRET }, { cookie: `CRON_SECRET=${env.CRON_SECRET}` }]) {
    const req = new Request(`https://example.org/api/cron/database-check?secret=${env.CRON_SECRET}`, { headers });
    const result = await handleDatabaseCheck(req, { env, createClient: () => assert.fail('must not load') });
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
});

test('authorized check executes one bounded read without mail variables and exposes no database contents', async () => {
  const db = database();
  const result = await handleDatabaseCheck(request(), { env, createClient: () => db });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const body = await result.json();
  assert.deepEqual(Object.keys(body).sort(), ['checkedAt', 'durationMs', 'ok']);
  assert.equal(body.ok, true);
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
  assert.ok(body.durationMs >= 0);
  assert.deepEqual(db.calls, [['from', 'app_roles'], ['select', 'code'], ['limit', 1], ['abortSignal']]);
});

test('an empty catalogue is still a successful database connection', async () => {
  const result = await handleDatabaseCheck(request(), { env, createClient: () => database({ data: [], error: null }) });
  assert.equal(result.status, 200);
});

test('provider, configuration and timeout errors fail visibly without leaking details', async () => {
  for (const createClient of [
    () => database({ data: null, error: { message: 'sensitive-provider-details', code: 'PGRST' } }),
    () => { throw new Error('sensitive-provider-details'); },
    async () => { throw new DOMException('sensitive-provider-details', 'TimeoutError'); }
  ]) {
    const result = await handleDatabaseCheck(request(), { env, createClient });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await result.json(), { ok: false, error: 'Database check failed' });
  }
  assert.equal(logs.length, 3);
  assert.ok(logs.every(message => !message.includes('sensitive-provider-details')));
});

test('database requests receive the configured eight second timeout', async () => {
  const original = AbortSignal.timeout;
  const controller = new AbortController();
  AbortSignal.timeout = ms => { assert.equal(ms, 8000); return controller.signal; };
  try {
    const result = await handleDatabaseCheck(request(), { env, createClient: () => database() });
    assert.equal(result.status, 200);
  } finally { AbortSignal.timeout = original; }
});

test('route authenticates before importing the admin client and is never cached', async () => {
  let imports = 0;
  const route = load('app/api/cron/database-check/route.ts', name => {
    if (name === '@/lib/database-check') return { handleDatabaseCheck: (req, deps) => handleDatabaseCheck(req, { ...deps, env }) };
    if (name === '@/lib/supabase/admin') { imports++; return { createAdminClient: () => database() }; }
    throw new Error(`Unexpected dependency: ${name}`);
  });
  assert.equal(route.runtime, 'nodejs');
  assert.equal(route.dynamic, 'force-dynamic');
  assert.equal(route.maxDuration, 15);
  assert.equal((await route.GET(request({}))).status, 401);
  assert.equal(imports, 0);
  assert.equal((await route.GET(request())).status, 200);
  assert.equal(imports, 1);
});

test('Vercel schedules a separate daily database check without changing expiry alerts', () => {
  const { crons } = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(crons.filter(cron => cron.path === '/api/cron/database-check').length, 1);
  assert.ok(crons.some(cron => cron.path === '/api/cron/database-check' && cron.schedule === '0 6 * * *'));
  assert.ok(crons.some(cron => cron.path === '/api/cron/expiry-alerts' && cron.schedule === '0 7 * * *'));
});
