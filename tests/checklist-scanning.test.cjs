const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText, { module, exports: module.exports, URL, require: n => Object.hasOwn(mocks, n) ? mocks[n] : require(n), ...globals });
  return module.exports;
}
const root = 'app/dashboard/checklists/';
const model = load(root + 'model.ts');
const scan = load(root + 'scan-model.ts');
const id = '11111111-1111-4111-8111-111111111111';
const positionId = '22222222-2222-4222-8222-222222222222';
const box = '33333333-3333-4333-8333-333333333333';
const line = { id: '44444444-4444-4444-8444-444444444444', item_id: id, lot_id: positionId, checklist_id: id, result: 'pending', revision: 2, expected_quantity: 10, item_name: 'Brocas', unit: 'uds', lot_code: 'L1' };
const form = values => { const f = new FormData(); Object.entries(values).forEach(([k,v]) => f.set(k,v)); return f; };
const valid = { checklistId: id, positionId, revision: '2', quantity: '10', result: 'ok', notes: '' };

function harness(options = {}) {
  const writes = [], paths = [], reads = [];
  const data = {
    container_checklists: { id, container_id: box, headquarters_id: id, status: 'draft', created_by: 'author', ...options.checklist },
    inventory_stock_positions: options.noPosition ? null : { item_id: id, lot_id: positionId, container_id: box, ...options.position },
    container_checklist_items: options.noLine ? null : { ...line, ...options.line }
  };
  const actions = load(root + 'scan-actions.ts', {
    './model': model, './scan-model': scan,
    'next/cache': { revalidatePath: (...args) => paths.push(args) },
    '@/lib/auth/context': { requireAccess: async () => {
      if (options.inactive) throw Error('INACTIVE');
      return { user: { id: options.user ?? 'author' }, isAdmin: options.admin ?? false, supabase: {
        from(table) {
          const filters = [];
          const q = { select: () => q, eq: (key,value) => { filters.push([key,value]); return q; }, maybeSingle: async () => {
            reads.push({ table, filters });
            return { data: data[table], error: options.fail === table ? { message: 'offline' } : null };
          } }; return q;
        },
        rpc: async (name,args) => {
          if (name === 'can_manage_logistics_requests') return { data: options.manager ?? false, error: options.permissionError ? {} : null };
          writes.push([name,JSON.parse(JSON.stringify(args))]); return { error: options.rpcError ?? null };
        }
      } };
    } }
  });
  return { ...actions, writes, paths, reads };
}

test('stock QR accepts only same-origin stock URLs, never commercial, generic or foreign links', () => {
  const origin = 'https://logistica.example';
  assert.equal(scan.stockQrPath(positionId), '/dashboard/stock/' + positionId);
  assert.equal(scan.parseStockQr(origin + scan.stockQrPath(positionId), origin), positionId);
  for (const value of ['1234567', '/dashboard/stock/' + positionId, origin + '/dashboard/inventory/' + id,
    origin + '/dashboard/locations/containers/' + box, 'https://evil.example' + scan.stockQrPath(positionId),
    'javascript:alert(1)', origin + '/dashboard/stock/nope', origin + scan.stockQrPath(positionId) + '?x=1',
    'https://user@logistica.example' + scan.stockQrPath(positionId), origin + scan.stockQrPath(positionId) + '#x']) {
    assert.equal(scan.parseStockQr(value, origin), null, value);
  }
});

test('scan only resolves the authoritative box, article and lot snapshot and never writes', async () => {
  const h = harness(); const resolved = await h.resolveChecklistScan(id, positionId);
  assert.equal(resolved.line.id, line.id); assert.equal(h.writes.length, 0);
  assert.equal(JSON.stringify(h.reads.find(r => r.table === 'container_checklist_items').filters), JSON.stringify([
    ['checklist_id', id], ['item_id', id], ['lot_id', positionId]
  ]));
});

test('closed, forbidden, foreign, deleted, already-checked and absent legacy lots cannot be scanned or saved', async () => {
  for (const options of [{ checklist: { status: 'complete' } }, { user: 'other' }, { position: { container_id: id } },
    { position: { container_id: null } }, { noPosition: true }, { noLine: true }, { line: { result: 'ok' } },
    { line: { result: 'missing' } }, { user: 'other', manager: true, permissionError: true },
    ...['container_checklists', 'inventory_stock_positions', 'container_checklist_items'].map(fail => ({ fail }))]) {
    const h = harness(options);
    assert.ok((await h.resolveChecklistScan(id, positionId)).error, JSON.stringify(options));
    assert.ok((await h.saveScannedReturn({},form(valid))).error, JSON.stringify(options));
    assert.equal(h.writes.length, 0); assert.equal(h.paths.length, 0);
  }
});

test('authenticated author, administrator and logistics manager can confirm without adjusting stock', async () => {
  for (const options of [{}, { user: 'other', admin: true }, { user: 'other', manager: true }]) {
    const h = harness(options);
    assert.ok((await h.saveScannedReturn({},form({ ...valid, lineId: 'forged', itemId: 'forged', expected_quantity: '99' }))).success);
    assert.deepEqual(h.writes, [['save_checklist_item', { p_line_id: line.id, p_revision: 2, p_result: 'ok', p_quantity: null, p_notes: '' }]]);
    assert.equal(h.paths.length, 1);
  }
});

test('quantity must be explicit, bounded and exact; shortages require an incident and note', async () => {
  for (const changes of [{ quantity: '' }, { quantity: '-1' }, { quantity: '1e1' }, { quantity: '1.0001' },
    { quantity: '11' }, { quantity: '9' }, { quantity: '9', result: 'missing', notes: '' },
    { revision: '1' }, { revision: '' }, { positionId: 'bad' }, { result: 'pending' }]) {
    const h = harness(); assert.ok((await h.saveScannedReturn({},form({ ...valid, ...changes }))).error);
    assert.equal(h.writes.length, 0);
  }
  const h = harness();
  assert.ok((await h.saveScannedReturn({},form({ ...valid, quantity: '8,5', result: 'consumed', notes: 'Usado en entrenamiento' }))).success);
  assert.equal(h.writes[0][1].p_quantity, 8.5);
});

test('authentication and concurrent/uncertain failures never report success or revalidate', async () => {
  const inactive = harness({ inactive: true });
  await assert.rejects(inactive.resolveChecklistScan(id,positionId), /INACTIVE/);
  await assert.rejects(inactive.saveScannedReturn({},form(valid)), /INACTIVE/);
  for (const rpcError of [{ code: '40001', message: 'La línea ha cambiado' }, { message: 'offline' }]) {
    const h = harness({ rpcError }); assert.ok((await h.saveScannedReturn({},form(valid))).error); assert.equal(h.paths.length, 0);
  }
});

const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];
test('scan UI never saves on detection, prevents overlapping reads and requires an explicit quantity', async () => {
  const hooks = []; let index = 0, calls = 0, resolve;
  const slot = initial => { const i = index++; if (!hooks[i]) hooks[i] = { value: initial }; return hooks[i]; };
  const react = { ...React,
    useState: initial => { const h = slot(initial); return [h.value, value => { h.value = value; }]; },
    useRef: initial => slot({ current: initial }).value,
    useActionState: () => [{}, () => {}, false]
  };
  const Scanner = () => null;
  const { ScanReturns } = load(root + 'scan-return.tsx', {
    react, '../receiving/scanner': { BarcodeScanner: Scanner }, './scan-model': scan, './model': model,
    './scan-actions': { resolveChecklistScan: () => { calls++; return new Promise(r => { resolve = r; }); }, saveScannedReturn: () => { throw Error('Must not save on scan'); } }
  }, { window: { location: { origin: 'https://logistica.example' } } });
  const render = () => { index = 0; return ScanReturns({ checklistId: id }); };
  let tree = render(); const reader = all(tree).find(n => n.type === Scanner);
  reader.props.onRead('123456'); assert.equal(calls, 0); assert.ok(all(render()).some(n => n.props?.role === 'alert'));
  const code = 'https://logistica.example' + scan.stockQrPath(positionId);
  reader.props.onRead(code); reader.props.onRead(code); assert.equal(calls, 1);
  assert.ok(!all(render()).some(n => n.type === Scanner));
  resolve({ line }); await new Promise(r => setImmediate(r)); tree = render();
  const confirm = all(tree).find(n => typeof n.type === 'function' && n.props.positionId);
  assert.ok(confirm); const confirmation = confirm.type(confirm.props);
  const quantity = all(confirmation).find(n => n.props?.name === 'quantity');
  assert.ok(quantity.props.required); assert.equal(quantity.props.defaultValue, undefined); assert.equal(quantity.props.value, undefined);
  assert.equal(all(confirmation).filter(n => n.type === 'form').length, 1);
  assert.ok(all(confirmation).some(n => n.type === 'button' && n.props.children === 'Confirmar devolución'));
});

test('stock QR page is read-only, keeps zero-balance labels and fails closed on inaccessible references', async () => {
  const reads = [];
  let data = { id: positionId, item_id: id, container_id: box, quantity: 0, inventory_items: { name: 'Brocas', unit: 'uds' },
    inventory_stock_lots: { code: 'L1', expiration_date: null }, inventory_containers: { name: 'Intervencion', locations: { name: 'Estante 1' } } };
  const QrModal = () => null;
  const { default: page } = load('app/dashboard/stock/[positionId]/page.tsx', {
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/navigation': { notFound: () => { throw Error('NOT_FOUND'); } },
    '@/app/dashboard/qr-modal': { QrModal }, '@/app/dashboard/checklists/scan-model': scan,
    '@/lib/auth/context': { requireAccess: async () => ({ supabase: { from: table => {
      assert.equal(table, 'inventory_stock_positions');
      const q = { select: () => q, eq: (key,value) => { reads.push([key,value]); return q; }, maybeSingle: async () => ({ data, error: null }) }; return q;
    } } }) }
  });
  const tree = await page({ params: Promise.resolve({ positionId }) });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /No quedan existencias/); assert.match(html, /Checklists de esta caja/); assert.match(html, /no registra ninguna comprobación/);
  assert.equal(all(tree).find(n => n.type === QrModal).props.path, scan.stockQrPath(positionId));
  assert.equal(JSON.stringify(reads), JSON.stringify([['id', positionId]]));
  data = null; await assert.rejects(page({ params: Promise.resolve({ positionId }) }), /NOT_FOUND/);
  await assert.rejects(page({ params: Promise.resolve({ positionId: 'bad' }) }), /NOT_FOUND/);
  assert.equal(reads.length, 2);
});

test('unauthenticated stock QR GET retains its destination and refreshed cookies at login, not on actions', async () => {
  let user = null;
  function response(redirect) {
    const values = []; return { redirect, cookies: { getAll: () => values, set: (...args) => values.push(args.length === 1 ? args[0] : { name: args[0], value: args[1], ...args[2] }) } };
  }
  const { middleware } = load('middleware.ts', {
    'next/server': { NextResponse: { next: () => response(), redirect: url => response(url) } },
    '@supabase/ssr': { createServerClient: (_url,_key,options) => ({ auth: { getUser: async () => {
      options.cookies.setAll([{ name: 'session', value: 'renewed', options: { httpOnly: true } }]);
      return { data: { user } };
    } } }) }
  }, { process: { env: {} } });
  const request = method => ({ method, cookies: { getAll: () => [], set() {} }, nextUrl: {
    pathname: scan.stockQrPath(positionId), clone: () => new URL('https://logistica.example' + scan.stockQrPath(positionId))
  } });
  let result = await middleware(request('GET'));
  assert.equal(result.redirect.pathname, '/auth/sign-in');
  assert.equal(result.redirect.searchParams.get('next'), scan.stockQrPath(positionId));
  assert.equal(result.cookies.getAll()[0].value, 'renewed');
  assert.equal((await middleware(request('POST'))).redirect, undefined);
  user = { id }; assert.equal((await middleware(request('GET'))).redirect, undefined);
});
