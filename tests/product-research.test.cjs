const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    Date, FormData, TextDecoder, Uint8Array, AbortSignal, ...globals });
  return module.exports;
}
const model = load('lib/inventory/product-research.ts');
const code = '3017620422003';
const source = { provider: 'upcitemdb', code, fetchedAt: '2026-09-16T10:00:00.000Z', reviewed: true };
const upc = { code: 'OK', items: [{ ean: code, title: 'Brocas', brand: 'Marca', model: 'SDS', weight: '400 g', description: '<b>Acero</b>', expiration_date: '2030-01-01' }] };
const food = { status: 'success', result: { id: 'product_found' }, product: { code, product_name: 'Food', product_name_es: 'Comida', brands: 'Marca', quantity: '400 g', ingredients_text_es: 'Arroz', expiration_date: '2030-01-01' } };
const candidate = model.parseProductResponse('upcitemdb', code, upc);
const id = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';

test('online lookup validates GTIN check digit and does not reinterpret internal codes or strip package indicators', () => {
  for (const value of [code, '4002293401102', '0885909456017', '885909456017', '96385074']) assert.equal(model.validProductCode(value), true, value);
  for (const value of ['', 'https://example.org', '00123', '0'.repeat(13), '3017620422004', ' 3017620422003', '<script>']) assert.equal(model.validProductCode(value), false, value);
  const equivalent = { code: 'OK', items: [{ ean: '0885909456017', title: 'Device' }] };
  assert.ok(model.parseProductResponse('upcitemdb', '885909456017', equivalent));
  assert.equal(model.parseProductResponse('upcitemdb', code, equivalent), null);
  assert.equal(model.parseProductResponse('upcitemdb', '20008236914225', { code: 'OK', items: [{ upc: '008236914221', title: 'Single unit' }] }), null);
});

test('providers require exact product identity and reject ambiguous or malformed payloads; facts are text only', () => {
  assert.equal(candidate.facts.find(f => f.key === 'description').value, 'Acero');
  assert.equal(candidate.facts.some(f => f.key === 'expiration_date'), false);
  assert.equal(model.parseProductResponse('upcitemdb', code, { ...upc, items: [upc.items[0], upc.items[0]] }), null);
  for (const payload of [null, {}, { code: 'ERROR' }, { code: 'OK', items: [{ title: 'Wrong' }] }]) assert.equal(model.parseProductResponse('upcitemdb', code, payload), null);
  assert.equal(model.parseProductResponse('openfoodfacts', code, food).facts[0].value, 'Comida');
  assert.equal(model.parseProductResponse('openfoodfacts', code, { ...food, product: { ...food.product, code: '4002293401102' } }), null);
  assert.match(model.parseProductResponse('openfoodfacts', code, food).url, /^https:\/\/world.openfoodfacts.org\/product\/\d+$/);
});

test('only configured, compatible product fields are prefilled; stock, expiry, lot, units and serial stay manual', () => {
  const fields = [
    { key: 'item_name', label: 'Nombre', type: 'text' }, { key: 'brand', label: 'Marca', type: 'select', options: ['Marca', 'Otra'] },
    { key: 'weight', label: 'Peso', type: 'number' }, { key: 'model', label: 'Modelo', type: 'textarea' },
    ...['current_stock', 'minimum_stock', 'expiration_date', 'lot_code', 'serial_number', 'location_id', 'unit', 'sku', 'maintenance_due_at', 'operational_status'].map(key => ({ key, label: key, type: 'text' }))
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(model.suggestedProductValues({ fields }, candidate))), { item_name: 'Brocas', brand: 'Marca', model: 'SDS' });
  assert.equal(model.compatibleFactValue({ key: 'custom', label: 'Peso', type: 'number' }, { key: 'weight', value: '1.25' }), '1.25');
  assert.equal(model.compatibleFactValue({ key: 'custom', label: 'Caducidad', type: 'text' }, { key: 'name', value: 'bad' }), '');
  assert.equal(model.compatibleFactValue({ key: 'brand', label: 'Marca', type: 'select', options: ['Otra'] }, { key: 'brand', value: 'Marca' }), '');
  assert.equal(model.compatibleFactValue({ key: 'size', label: 'Medida', type: 'select', options: ['38'] }, { key: 'size', value: '3/8' }), '');
  assert.equal(model.productSourceSchema.safeParse({ ...source, url: 'javascript:alert(1)' }).success, false);
  assert.equal(model.productSourceSchema.safeParse({ ...source, reviewed: false }).success, false);
});

function server(fetch, env = { PRODUCT_LOOKUP_CONTACT: 'catalog@example.invalid' }) {
  return load('lib/inventory/product-research-server.ts', { 'server-only': {}, './product-research': model }, { fetch, process: { env } });
}
test('requests use only fixed provider URLs and code, reject redirects, bound time and cache/deduplicate successes', async () => {
  const calls = [];
  const api = server(async (url, options) => { calls.push({ url, options }); return Response.json(upc); });
  const results = await Promise.all([api.fetchProductResearch('upcitemdb', code), api.fetchProductResearch('upcitemdb', code)]);
  assert.ok(results.every(r => r.candidate));
  await api.fetchProductResearch('upcitemdb', code);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, `https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`);
  assert.equal(calls[0].options.redirect, 'error'); assert.ok(calls[0].options.signal);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.ok((await api.fetchProductResearch('upcitemdb', 'INTERNAL')).error); assert.equal(calls.length, 1);
});
test('provider limits, network failures, invalid JSON and oversized streams are errors, never an empty successful result', async () => {
  let calls = 0;
  const limited = server(async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '3600' } }); });
  assert.match((await limited.fetchProductResearch('upcitemdb', code)).error, /cuota/);
  assert.ok((await limited.fetchProductResearch('upcitemdb', code)).error); assert.equal(calls, 1);
  for (const fetch of [async () => { throw Error('offline'); }, async () => new Response('{'), async () => Response.json({ code: 'SERVER_ERR' }),
    async () => new Response('a'.repeat(262145)), async () => new Response('', { headers: { 'content-length': '300000' } })]) {
    const result = await server(fetch).fetchProductResearch('upcitemdb', code);
    assert.ok(result.error); assert.equal(result.notFound, undefined);
  }
  assert.equal((await server(async () => Response.json({ code: 'OK', items: [] })).fetchProductResearch('upcitemdb', code)).notFound, true);
  const api = server(async () => Response.json(food));
  assert.ok((await api.fetchProductResearch('openfoodfacts', code)).candidate);
  let withoutContactCalls = 0;
  const withoutContact = server(async () => { withoutContactCalls++; return Response.json(food); }, {});
  assert.match((await withoutContact.fetchProductResearch('openfoodfacts', code)).error, /PRODUCT_LOOKUP_CONTACT/); assert.equal(withoutContactCalls, 0);
  for (let i = 0; i < 6; i++) assert.equal(api.allowProductResearch(id, 1), true);
  assert.equal(api.allowProductResearch(id, 2), false); assert.equal(api.allowProductResearch(id, 60002), true);
});

function actionHarness({ admin = false, local = null, dbError = null, denied = false, limit = true } = {}) {
  const queries = [], requests = [];
  const query = { select: () => query, eq: (...v) => { queries.push(v); return query; }, maybeSingle: async () => ({ data: local, error: dbError }) };
  const actions = load('app/dashboard/receiving/product-research-action.ts', {
    '@/lib/inventory/product-research': model,
    '@/lib/inventory/product-research-server': { allowProductResearch: () => limit, fetchProductResearch: async (...args) => { requests.push(args); return { candidate }; } },
    '@/lib/auth/context': { requireAccess: async () => { if (denied) throw Error('denied'); return { supabase: { from: () => query }, user: { id }, profile: { headquarters_id: id }, isAdmin: admin }; } }
  });
  return { actions, queries, requests };
}
test('research authenticates and checks site/local catalog before making any external call, with no mutation methods', async () => {
  const input = { code, site: id, provider: 'upcitemdb' };
  const good = actionHarness(); assert.ok((await good.actions.researchProduct(input)).candidate);
  assert.equal(good.requests.length, 1); assert.ok(good.queries.some(q => q[0] === 'headquarters_id' && q[1] === id));
  for (const options of [{ local: { id } }, { dbError: {} }, { limit: false }]) {
    const h = actionHarness(options); assert.ok((await h.actions.researchProduct(input)).error); assert.equal(h.requests.length, 0);
  }
  for (const changes of [{ site: foreign }, { code: 'abc' }, { provider: 'https://attacker.invalid' }]) {
    const h = actionHarness(); assert.ok((await h.actions.researchProduct({ ...input, ...changes })).error); assert.equal(h.requests.length, 0);
  }
  const denied = actionHarness({ denied: true }); await assert.rejects(denied.actions.researchProduct(input)); assert.equal(denied.requests.length, 0);
});

test('saving reviewed draft uses one atomic provenance RPC with zero stock, manual creation stays on the existing path', async () => {
  const calls = [];
  let error = null;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id, code: 'tool', category_code: 'tool', inventory_template_fields: [{ is_required: true, inventory_fields: { field_key: 'item_name', field_type: 'text', options: [] } }] } }) };
  const actions = load('app/dashboard/actions.ts', {
    'next/cache': { revalidatePath: () => {} }, '@/lib/supabase/server': {}, '@/lib/supabase/admin': {},
    '@/lib/inventory/product-research': model, '@/lib/inventory/validation': load('lib/inventory/validation.ts'),
    '@/lib/auth/context': { requireAccess: async () => ({ roleCode: 'editor', user: { id }, profile: { headquarters_id: id }, supabase: { from: () => query, rpc: async (name, args) => { calls.push({ name, args }); return { data: error ? null : id, error }; } } }) }
  });
  const form = new FormData(); for (const [key, value] of Object.entries({ templateCode: 'tool', headquartersId: foreign, receivingId: id, templateField_item_name: 'Brocas', productSource: JSON.stringify(source) })) form.set(key, value);
  assert.equal((await actions.createInventoryItem(undefined, form)).itemId, id);
  assert.equal(calls[0].name, 'create_inventory_record_from_product'); assert.equal(calls[0].args.p_record.current_stock, 0);
  assert.equal(calls[0].args.p_record.headquarters_id, id); assert.equal(calls[0].args.p_source.code, code);
  error = { code: 'PGRST202', message: 'Missing migration' };
  assert.match((await actions.createInventoryItem(undefined, form)).error, /upgrade-product-research/);
  form.set('productSource', JSON.stringify({ ...source, reviewed: false }));
  assert.match((await actions.createInventoryItem(undefined, form)).error, /fuente/); assert.equal(calls.length, 2);
  form.delete('productSource'); error = null;
  assert.equal((await actions.createInventoryItem(undefined, form)).itemId, id); assert.equal(calls.at(-1).name, 'create_inventory_record_once');
});

function hooks() {
  const slots = [], effects = []; let index = 0;
  const slot = initial => { const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return slots[i]; };
  const react = {
    useState: initial => { const h = slot(initial); return [h.value, value => { h.value = typeof value === 'function' ? value(h.value) : value; }]; },
    useRef: initial => slot(() => ({ current: initial })).value,
    useEffect: (fn, deps) => { const h = slot(null); if (!h.deps || deps.some((v, i) => v !== h.deps[i])) { h.deps = deps; effects.push(() => { h.cleanup?.(); h.cleanup = fn(); }); } },
    useActionState: (fn, initial) => { const h = slot(initial); return [h.value, async form => { h.value = await fn(h.value, form); return h.value; }, false]; }
  };
  return { react, render: (Component, props) => { index = 0; const tree = Component(props); while (effects.length) effects.shift()(); return tree; }, unmount: () => slots.forEach(h => h.cleanup?.()) };
}
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];

test('research UI requires explicit lookup and reviewed mapping; reader cannot open article creation', async () => {
  let requests = 0, draft;
  const ui = hooks();
  const module = load('app/dashboard/receiving/product-research.tsx', {
    react: ui.react, '@/lib/inventory/product-research': model,
    './product-research-action': { researchProduct: async () => { requests++; return { candidate }; } }
  });
  const props = { code, site: id, templates: [{ code: 'tool', name: 'Herramienta', fields: [{ key: 'item_name', label: 'Nombre', type: 'text' }] }], canCreate: true, onDraft: value => { draft = value; }, disabled: false };
  let tree = ui.render(module.ProductResearch, props);
  assert.equal(requests, 0); assert.equal(all(tree).some(n => n.type === 'select'), false);
  all(tree).find(n => n.type === 'button').props.onClick(); tree = ui.render(module.ProductResearch, props);
  assert.equal(requests, 0);
  all(tree).find(n => n.type === 'button' && n.props.children === 'Consultar código').props.onClick();
  await new Promise(resolve => setImmediate(resolve)); tree = ui.render(module.ProductResearch, props);
  assert.equal(requests, 1); assert.equal(draft, undefined);
  const mapping = all(tree).find(n => typeof n.type === 'function');
  // Component closes over the same mocked React module; reset hooks for a separate mount.
  const mappingUI = hooks(); Object.assign(ui.react, mappingUI.react);
  let mapped = mappingUI.render(mapping.type, mapping.props);
  assert.equal(all(mapped).find(n => n.type === 'button').props.disabled, true);
  all(mapped).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  mapped = mappingUI.render(mapping.type, mapping.props);
  assert.equal(all(mapped).find(n => n.type === 'button').props.disabled, false);
  all(mapped).find(n => n.type === 'button').props.onClick(); assert.equal(draft.values.item_name, 'Brocas'); assert.equal(draft.source.reviewed, true); assert.equal(draft.variant.brand, 'Marca');

  const readerUI = hooks(); Object.assign(ui.react, readerUI.react);
  let reader = readerUI.render(module.ProductResearch, { ...props, canCreate: false });
  all(reader).find(n => n.type === 'button').props.onClick(); reader = readerUI.render(module.ProductResearch, { ...props, canCreate: false });
  all(reader).find(n => n.type === 'button' && n.props.children === 'Consultar código').props.onClick();
  await new Promise(resolve => setImmediate(resolve)); reader = readerUI.render(module.ProductResearch, { ...props, canCreate: false });
  assert.equal(all(reader).some(n => typeof n.type === 'function'), false);
});

test('creation form only renders configured fields, prefills matching template and preserves exact payload after uncertain response', async () => {
  const ui = hooks(), saved = new Map(), calls = [], created = [];
  let fail = true;
  const module = load('app/dashboard/inventory/create-item-form.tsx', {
    react: ui.react, '@/lib/inventory/product-research': model, '../checklists/id': { newChecklistId: () => id },
    '@/app/dashboard/actions': { createInventoryItem: async (_, form) => { calls.push([...form.entries()]); if (fail) throw Error('offline'); return { itemId: id, itemName: 'Brocas' }; } }
  }, { sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } });
  const props = { canChooseHeadquarters: false, containers: [], locations: [], headquarters: [], userHeadquartersId: id,
    templates: [{ code: 'tool', category: 'tool', fields: [{ key: 'item_name', label: 'Nombre', type: 'text' }] }, { code: 'other', category: 'tool', fields: [{ key: 'item_name', label: 'Nombre', type: 'text' }] }],
    onCreated: (...args) => created.push(args), draftKey: 'pending', initialProductDraft: { templateCode: 'tool', values: { item_name: 'Brocas' }, source } };
  let tree = ui.render(module.CreateInventoryItemForm, props);
  assert.equal(all(tree).find(n => n.props?.name === 'templateField_item_name').props.defaultValue, 'Brocas');
  assert.equal(all(tree).some(n => n.props?.name === 'templateField_current_stock'), false);
  const form = new FormData(); form.set('templateField_item_name', 'Corrección manual'); form.set('productSource', JSON.stringify(source));
  await tree.props.action(form); tree = ui.render(module.CreateInventoryItemForm, props);
  assert.equal(all(tree).find(n => n.type === 'fieldset').props.disabled, true); assert.ok(saved.has('pending'));
  fail = false; await tree.props.action(new FormData());
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].some(([key]) => key === 'templateField_current_stock'), false);
  assert.equal(created.length, 1); assert.equal(saved.has('pending'), false);
  all(tree).find(n => n.props?.name === 'templateCodeSelector').props.onChange({ target: { value: 'other' } }); tree = ui.render(module.CreateInventoryItemForm, props);
  assert.equal(all(tree).find(n => n.props?.name === 'templateField_item_name').props.defaultValue, '');
  assert.equal(all(tree).some(n => n.props?.name === 'productSource'), false);
});
