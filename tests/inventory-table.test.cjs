const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, { module, exports: module.exports, URLSearchParams, console: { error() {} }, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return module.exports;
}
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];
const headquartersId = '11111111-1111-4111-8111-111111111111';
const item = { id: 'drill', name: 'Taladro', category: 'tool', subtype: 'Percutor', current_stock: 4, minimum_stock: 2, unit: 'uds.', status: 'low', operational_status: 'repair', expiration_date: null, maintenance_due_at: '2027-01-01', headquarters_id: headquartersId, headquarters: { name: 'Valencia' } };

function harness({ role = 'admin', rows = {}, failTable, active = true } = {}) {
  let selected = null;
  const calls = [];
  const CatalogTable = load('app/dashboard/templates/catalog-table.tsx', { react: {
    ...React, useId: () => 'inventory', useState: () => [selected, value => { selected = typeof value === 'function' ? value(selected) : value; }]
  } }).CatalogTable;
  const data = {
    inventory_items: [item, { ...item, id: 'other', name: 'Otro material', minimum_stock: null, operational_status: null, headquarters: null }],
    inventory_categories: [{ code: 'tool', name: 'Herramientas' }], inventory_templates: [],
    headquarters: [{ id: headquartersId, name: 'Valencia', is_active: true }],
    locations: [{ id: 'shelf', name: 'Estanteria 1', code: 'E1', parent_location_id: null, headquarters_id: headquartersId }], inventory_containers: [],
    inventory_stock_positions: [
      { item_id: 'drill', quantity: 1, location_id: 'shelf', inventory_containers: null },
      { item_id: 'drill', quantity: 3, location_id: null, inventory_containers: { name: 'Caja rescate', code: 'C1', location_id: 'shelf' } }
    ], ...rows
  };
  const page = load('app/dashboard/inventory/page.tsx', {
    '@/lib/inventory/categories': load('lib/inventory/categories.ts'),
    '@/lib/inventory/expiry-status': load('lib/inventory/expiry-status.ts'),
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/navigation': { redirect: href => { throw Error('REDIRECT:' + href); } },
    '@/app/dashboard/inventory/create-item-modal': { CreateItemModal: () => React.createElement('button', null, 'Nueva ficha') },
    '@/app/dashboard/inventory/notification-preferences-form': { NotificationPreferencesModal: () => React.createElement('button', null, 'Avisos de caducidad') },
    '../templates/catalog-table': { CatalogTable },
    '@/lib/auth/context': { requireAccess: async () => ({
      isAdmin: role === 'admin', roleCode: role, user: { id: 'user' }, profile: { is_active: active, headquarters_id: headquartersId },
      supabase: { from(table) {
        const call = { table, filters: [], from: 0, to: 499 }; calls.push(call);
        const result = () => {
          if (table === failTable) return { data: null, count: null, error: { code: 'offline', message: 'offline' } };
          let list = data[table] ?? [];
          for (const [op, field, value] of call.filters) {
            if (op === 'eq') list = list.filter(row => row[field] === value);
            if (op === 'in') list = list.filter(row => value.includes(row[field]));
            if (op === 'gt') list = list.filter(row => row[field] > value);
            if (op === 'lt') list = list.filter(row => row[field] && row[field] < value);
            if (op === 'or') {
              const today = field.match(/expiration_date.gte.([0-9-]+)/)[1];
              list = list.filter(row => !row.expiration_date || row.expiration_date >= today || row.current_stock === 0);
            }
            if (op === 'ilike') list = list.filter(row => row[field].toLowerCase().includes(value.slice(1,-1).toLowerCase()));
          }
          return { data: list.slice(call.from, call.to + 1), count: list.length, error: null };
        };
        const query = { select: () => query, order: () => query,
          range: (from,to) => { call.from = from; call.to = to; return query; },
          returns: async () => result(), maybeSingle: async () => ({ data: null, error: null }) };
        for (const op of ['eq','ilike','in','gt','lt','or']) query[op] = (field,value) => { call.filters.push([op,field,value]); return query; };
        return query;
      } }
    }) }
  }).default;
  return { page: (params = {}) => page({ searchParams: Promise.resolve(params) }), calls,
    table: tree => all(tree).find(node => node.type === CatalogTable), render: props => CatalogTable(props) };
}

test('inventory is a compact expandable table with stock and both status indicators always visible', async () => {
  const h = harness(); const props = h.table(await h.page()).props;
  assert.equal(JSON.stringify(props.columns.map(c => c.label)), JSON.stringify(['Artículo','Stock','Alerta','Estado']));
  let tree = h.render(props); let html = renderToStaticMarkup(tree);
  assert.match(html, /<table/); assert.match(html, /Stock bajo/); assert.match(html, /En reparación/); assert.match(html, /4 uds\./);
  assert.doesNotMatch(html, /Caja rescate|Ver ficha completa|Estanteria 1|2027-01-01/);
  all(tree).find(n => n.type === 'button').props.onClick({ stopPropagation() {} });
  tree = h.render(props); html = renderToStaticMarkup(tree);
  assert.match(html, /Herramientas/); assert.match(html, /Valencia/); assert.match(html, /1 uds\./); assert.match(html, /3 uds\./);
  assert.match(html, /Caja rescate/); assert.match(html, /Estanteria 1/); assert.match(html, /2027-01-01/);
  assert.match(html, /href="\/dashboard\/inventory\/drill"/); assert.match(html, /colSpan="4"/i);
  all(tree).filter(n => n.type === 'button')[1].props.onClick({ stopPropagation() {} });
  html = renderToStaticMarkup(h.render(props)); assert.doesNotMatch(html, /Caja rescate/); assert.match(html, /Sin configurar/); assert.match(html, /Sin existencias/);
});

test('expiry filters and badges use the current date even if no stock mutation refreshed SQL status', async () => {
  const rows = { inventory_items: [
    { ...item, id: 'expired', status: 'ok', expiration_date: '2000-01-01' },
    { ...item, id: 'future', status: 'ok', expiration_date: '2999-01-01' },
    { ...item, id: 'empty', status: 'low', current_stock: 0, expiration_date: '2000-01-01' }
  ] };
  const h = harness({ rows });
  const expired = h.table(await h.page({ status: 'expired' })).props;
  assert.equal(expired.rows.length, 1);
  assert.equal(expired.rows[0].id, 'expired');
  assert.match(renderToStaticMarkup(h.render(expired)), /Caducado/);
  const valid = h.table(await h.page({ status: 'ok' })).props;
  assert.deepEqual(Array.from(valid.rows, row => row.id), ['future']);
  const low = h.table(await h.page({ status: 'low' })).props;
  assert.deepEqual(Array.from(low.rows, row => row.id), ['empty']);
});

test('search is applied in the database across all items and pagination retains every filter', async () => {
  const rows = { inventory_items: Array.from({ length: 251 }, (_, i) => ({ ...item, id: String(i), name: i === 250 ? 'Broca especial' : 'Taladro ' + i })) };
  const search = harness({ rows }); const tree = await search.page({ q: 'Broca especial' });
  assert.equal(search.table(tree).props.rows[0].label, 'Broca especial');
  const h = harness({ rows }); const page = await h.page({ page: '2', q: 'Taladro', category: 'tool', status: 'low', operational_status: 'repair', headquarters: headquartersId });
  assert.equal(h.table(page).props.rows.length, 50);
  const query = h.calls.find(c => c.table === 'inventory_items'); assert.equal(query.from, 50); assert.equal(query.to, 99);
  const next = all(page).find(n => n.props?.rel === 'next').props.href;
  const params = new URL(next, 'https://local.example').searchParams;
  for (const [key,value] of Object.entries({ page: '3', q: 'Taladro', category: 'tool', status: 'low', operational_status: 'repair', headquarters: headquartersId })) assert.equal(params.get(key), value);
});

test('roles keep site scoping and creation/alert permissions; empty and failed reads are explicit', async () => {
  for (const role of ['admin','editor','reader']) {
    const h = harness({ role }); const page = await h.page(); const html = renderToStaticMarkup(page);
    assert.equal(html.includes('Nueva ficha'), role !== 'reader'); assert.equal(html.includes('Avisos de caducidad'), role === 'admin');
    if (role !== 'admin') assert.ok(h.calls.find(c => c.table === 'inventory_items').filters.some(([op,key,value]) => op === 'eq' && key === 'headquarters_id' && value === headquartersId));
  }
  const empty = harness({ rows: { inventory_items: [] } }); assert.match(renderToStaticMarkup(await empty.page()), /No hay artículos que coincidan/);
  for (const failTable of ['inventory_items','inventory_stock_positions']) {
    const h = harness({ failTable }); const tree = await h.page(); assert.equal(h.table(tree), undefined); assert.match(renderToStaticMarkup(tree), /No se (han podido|pudo) cargar/);
  }
  const inactive = harness({ active: false }); assert.match(renderToStaticMarkup(await inactive.page()), /Acceso bloqueado/); assert.equal(inactive.calls.length, 0);
});

test('category filter includes descendants at every depth before pagination, without including siblings', async () => {
  const h = harness({ rows: {
    inventory_categories: [
      { code: 'tool', name: 'Herramientas', parent_code: null },
      { code: 'drills', name: 'Taladros', parent_code: 'tool' },
      { code: 'battery', name: 'Bateria', parent_code: 'drills' },
      { code: 'clothing', name: 'Ropa', parent_code: null }
    ],
    inventory_items: [item, { ...item, id: 'battery', category: 'battery' }, { ...item, id: 'jacket', category: 'clothing' }]
  } });
  const tree = await h.page({ category: 'tool' });
  assert.deepEqual(Array.from(h.table(tree).props.rows, row => row.id), ['drill', 'battery']);
  assert.match(renderToStaticMarkup(tree), /Herramientas \/ Taladros \/ Bateria/);
  assert.deepEqual(Array.from(h.table(await h.page({ category: 'drills' })).props.rows, row => row.id), ['battery']);
});
