const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ error = null, throws = false, clientThrows = false } = {}) {
  const calls = []; const logs = [];
  const module = { exports: {} };
  const mocks = {
    'next/navigation': { redirect: url => { throw new Error('REDIRECT:' + url); } },
    '@/lib/supabase/server': { createClient: async () => {
      if (clientThrows) throw new Error('private configuration');
      return { auth: { signInWithPassword: async args => {
        calls.push(args);
        if (throws) throw new TypeError('fetch failed: private configuration');
        return { error };
      } } };
    } }
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/auth/actions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, console: { error: message => logs.push(message) }, require: name => mocks[name] });
  return { signIn: module.exports.signIn, calls, logs };
}

function form(values = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ email: ' member@example.org ', password: 'test-password', ...values })) data.set(key, value);
  return data;
}

test('sign in only identifies invalid credentials when Supabase explicitly rejects them', async () => {
  const h = harness({ error: { code: 'invalid_credentials', status: 400 } });
  assert.match((await h.signIn(undefined, form())).error, /correo o la contraseña no son correctos/);
  assert.equal(h.calls[0].email, 'member@example.org');
  assert.equal(h.calls[0].password, 'test-password');
});

test('DNS, retryable and server failures do not tell users their password is wrong', async () => {
  for (const error of [
    { name: 'AuthRetryableFetchError', status: 0 },
    { name: 'AuthRetryableFetchError' }, { status: 502 }, { status: 503 }
  ]) {
    const result = await harness({ error }).signIn(undefined, form());
    assert.match(result.error, /No se puede conectar/);
    assert.match(result.error, /No se han podido comprobar/);
  }
});

test('rate limits and unknown failures have distinct safe feedback', async () => {
  assert.match((await harness({ error: { status: 429 } }).signIn(undefined, form())).error, /demasiados intentos/);
  const h = harness({ error: { status: 401, message: 'private configuration', code: 'unexpected' } });
  const result = await h.signIn(undefined, form());
  assert.match(result.error, /No se ha podido completar/);
  assert.doesNotMatch(result.error, /private|test-password|member@example/);
});

test('thrown transport or client configuration failures do not expose provider details', async () => {
  for (const option of [{ throws: true }, { clientThrows: true }]) {
    const h = harness(option); const result = await h.signIn(undefined, form());
    assert.match(result.error, /servicio de acceso no está disponible/);
    assert.doesNotMatch(JSON.stringify([result, h.logs]), /private|test-password|member@example/);
  }
});

test('empty credentials do not contact Supabase', async () => {
  for (const values of [{ email: ' ' }, { password: '' }]) {
    const h = harness(); assert.match((await h.signIn(undefined, form(values))).error, /Necesitas/);
    assert.equal(h.calls.length, 0);
  }
});

test('successful sign in preserves safe QR destinations and rejects external redirects', async () => {
  for (const [next, expected] of [
    ['/dashboard/stock/abc', '/dashboard/stock/abc'], ['/dashboard?view=all', '/dashboard?view=all'],
    ['https://example.org', '/dashboard'], ['//example.org', '/dashboard'],
    ['/dashboard-evil', '/dashboard'], ['/dashboard/\\example.org', '/dashboard']
  ]) {
    const h = harness();
    await assert.rejects(h.signIn(undefined, form({ next })), error => error.message === 'REDIRECT:' + expected);
    assert.equal(h.logs.length, 0);
  }
});
