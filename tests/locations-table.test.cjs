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
  }).outputText, { module, exports: module.exports, console: { error() {} }, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return module.exports;
}
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];
const link = ({ children, ...props }) => React.createElement('a', props, children);
const location = { id: 'shelf', name: 'Estanteria 1', code: 'E1', location_type: 'shelf', description: 'Zona de rescate', parent_location_id: null, headquarters_id: 'hq', headquarters: { name: 'Valencia' } };
const box = { id: 'box', name: 'Kit rescate', code: 'K1', container_type: 'intervention', description: 'Herramientas', location_id: 'shelf', headquarters_id: 'hq', headquarters: { name: 'Valencia' } };

function harness({ admin = true, active = true, headquartersId = 'hq', rows = {}, failTable, failFrom = 0 } = {}) {
  let selected = null;
  const calls = [];
  const data = { headquarters: [{ id: 'hq', name: 'Valencia', is_active: true }], locations: [location], inventory_containers: [box], inventory_container_items: [{ id: 'entry', container_id: 'box', quantity: 4, notes: 'Acero', inventory_items: { id: 'drill', name: 'Brocas', unit: 'uds.' } }], ...rows };
  const CatalogTable = load('app/dashboard/templates/catalog-table.tsx', { react: {
    ...React, useId: () => 'locations', useState: () => [selected, value => { selected = typeof value === 'function' ? value(selected) : value; }]
  } }).CatalogTable;
  const button = label => () => React.createElement('button', null, label);
  const view = load('app/dashboard/locations/locations-view.tsx', {
    'next/link': link,
    '@/lib/auth/context': { requireAccess: async () => ({ isAdmin: admin, profile: { is_active: active, headquarters_id: headquartersId }, supabase: { from(table) {
      let start = 0, end = 499, ids;
      const query = {
        select: () => query, order: () => query,
        eq: (column, value) => { calls.push({ table, column, value }); return query; },
        in: (_, values) => { ids = values; return query; },
        range: (from, to) => { start = from; end = to; calls.push({ table, from, to }); return query; },
        returns: async () => table === failTable && start >= failFrom ? { data: null, error: { message: 'offline' } } : { data: data[table].filter(row => !ids || ids.includes(row.container_id)).slice(start, end + 1), error: null }
      }; return query;
    } } }) },
    '@/app/dashboard/locations/forms': {
      CreateContainerForm: button('Crear caja'), CreateLocationForm: button('Crear ubicacion'),
      DeleteContainerForm: button('Eliminar caja'), DeleteLocationForm: button('Eliminar ubicacion'),
      EditContainerModal: button('Editar caja'), EditLocationModal: button('Editar ubicacion'),
      LocationModal: ({ trigger }) => React.createElement('button', null, trigger)
    },
    '@/app/dashboard/qr-modal': { QrModal: button('QR de caja') },
    '../templates/catalog-table': { CatalogTable }, './subnav': { LocationsSubnav: () => null }
  }).LocationsView;
  return { view, calls, table: tree => all(tree).find(node => node.type === CatalogTable), render: props => CatalogTable(props), select: id => { selected = id; } };
}

test('location navigation uses independent routes and the same subnav styling as templates', () => {
  for (const pathname of ['/dashboard/locations', '/dashboard/locations/physical']) {
    const { LocationsSubnav } = load('app/dashboard/locations/subnav.tsx', { 'next/link': link, 'next/navigation': { usePathname: () => pathname } });
    const tree = LocationsSubnav();
    const links = all(tree).filter(node => node.type === link);
    assert.equal(links.length, 2);
    assert.equal(links.filter(node => node.props['aria-current'] === 'page').length, 1);
    assert.equal(links.find(node => node.props.className.includes('is-active')).props.href, pathname);
    assert.match(renderToStaticMarkup(tree), /Cajas \/ kits/);
    assert.match(renderToStaticMarkup(tree), /Ubicaciones físicas/);
  }
  const LocationsView = () => null;
  assert.equal(load('app/dashboard/locations/page.tsx', { './locations-view': { LocationsView } }).default().props.view, 'containers');
  assert.equal(load('app/dashboard/locations/physical/page.tsx', { '../locations-view': { LocationsView } }).default().props.view, 'physical');
});

test('boxes render one compact table and expand to quantities, hierarchy, QR, checklists and admin actions', async () => {
  const h = harness(); const page = await h.view({ view: 'containers' }); const props = h.table(page).props;
  assert.equal(props.rows.length, 1); assert.equal(props.columns[0].label, 'Caja / kit');
  let html = renderToStaticMarkup(h.render(props));
  assert.match(html, /<table/); assert.doesNotMatch(html, /Brocas|Editar caja|QR de caja/);
  h.select('box'); html = renderToStaticMarkup(h.render(props));
  assert.match(html, /4 uds\./); assert.match(html, /Estanteria 1/); assert.match(html, /Editar caja/); assert.match(html, /Eliminar caja/);
  assert.match(html, /QR de caja/); assert.match(html, /Ver caja y checklists/); assert.match(html, /href="\/dashboard\/inventory\/drill"/);
  assert.match(renderToStaticMarkup(page), /Nueva caja/); assert.doesNotMatch(renderToStaticMarkup(page), /Nueva ubicación/);
});

test('physical locations have their own table and do not fetch box contents', async () => {
  const h = harness({ failTable: 'inventory_containers' });
  const page = await h.view({ view: 'physical' }); const props = h.table(page).props;
  assert.equal(props.columns[0].label, 'Ubicación');
  assert.ok(!h.calls.some(c => c.from !== undefined && ['inventory_containers', 'inventory_container_items'].includes(c.table)));
  h.select('shelf'); const html = renderToStaticMarkup(h.render(props));
  assert.match(html, /Ruta completa/); assert.match(html, /Editar ubicacion/); assert.match(html, /Eliminar ubicacion/);
  assert.match(renderToStaticMarkup(page), /Nueva ubicación/); assert.doesNotMatch(renderToStaticMarkup(page), /Nueva caja/);
});

test('readers are scoped to their headquarters and cannot create, edit or delete in either view', async () => {
  for (const view of ['containers', 'physical']) {
    const h = harness({ admin: false }); const page = await h.view({ view });
    h.select(view === 'containers' ? 'box' : 'shelf');
    assert.doesNotMatch(renderToStaticMarkup(page), /Nueva caja|Nueva ubicación|Editar|Eliminar/);
    for (const table of ['locations', 'inventory_containers']) assert.ok(h.calls.some(c => c.table === table && c.column === 'headquarters_id' && c.value === 'hq'));
  }
  for (const options of [{ active: false }, { admin: false, headquartersId: null }]) {
    const h = harness(options); const page = await h.view({ view: 'containers' });
    assert.equal(h.calls.length, 0); assert.match(renderToStaticMarkup(page), /Acceso bloqueado/);
  }
});

test('location pagination reads beyond 500 rows and failures do not expose a partial table', async () => {
  const rows = { locations: Array.from({ length: 501 }, (_, i) => ({ ...location, id: String(i) })) };
  const h = harness({ rows }); assert.equal(h.table(await h.view({ view: 'physical' })).props.rows.length, 501);
  assert.ok(h.calls.some(c => c.table === 'locations' && c.from === 500));
  const failed = harness({ rows, failTable: 'locations', failFrom: 500 }); const page = await failed.view({ view: 'physical' });
  assert.equal(failed.table(page), undefined); assert.match(renderToStaticMarkup(page), /No se muestra un listado parcial/);
});
