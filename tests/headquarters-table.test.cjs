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
  }).outputText, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return module.exports;
}
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];
const site = { id: 'one', name: 'Valencia', slug: 'valencia', address: 'Calle del Almacén 1', city: 'Valencia', province: 'Valencia', country: 'España', is_active: true };
const sites = [site, { ...site, id: 'two', name: 'Navarra', slug: 'navarra', address: null, city: null, province: null, country: null, is_active: false }];

function harness({ admin = true, rows = {}, failTable, failFrom = 0 } = {}) {
  let selected = null;
  const calls = [];
  const CatalogTable = load('app/dashboard/templates/catalog-table.tsx', { react: {
    ...React, useId: () => 'headquarters', useState: () => [selected, value => { selected = typeof value === 'function' ? value(selected) : value; }]
  } }).CatalogTable;
  const data = { headquarters: sites, profiles: [{ headquarters_id: 'one' }, { headquarters_id: null }], inventory_items: [{ headquarters_id: 'one' }, { headquarters_id: 'one' }], ...rows };
  const form = label => props => React.createElement('button', { type: 'button', 'data-id': props.id ?? props.headquarters?.id }, label);
  const page = load('app/dashboard/headquarters/page.tsx', {
    '@/lib/auth/context': { requireAccess: async () => ({ isAdmin: admin, supabase: { from: table => {
      let from = 0, to = 499;
      const q = { select: () => q, order: () => q, range: (a, b) => { from = a; to = b; calls.push({ table, from: a, to: b }); return q; },
        returns: async () => table === failTable && from >= failFrom ? { data: null, error: { message: 'offline' } } : { data: data[table].slice(from, to + 1), error: null } };
      return q;
    } } }) },
    'next/navigation': { redirect: () => { throw Error('REDIRECT'); } },
    'next/link': ({ children }) => children,
    './forms': { CreateHeadquartersModal: form('Nueva sede'), EditHeadquartersModal: form('Editar'), DeleteHeadquartersForm: form('Eliminar') },
    '../templates/catalog-table': { CatalogTable }
  }).default;
  return { page, calls, table: tree => all(tree).find(node => node.type === CatalogTable), render: props => CatalogTable(props) };
}

test('headquarters use compact table rows, with one expandable detail and existing edit/delete actions', async () => {
  const h = harness(); const page = await h.page(); const props = h.table(page).props;
  assert.equal(JSON.stringify(props.columns.map(c => c.label)), JSON.stringify(['Sede', 'Estado', 'Usuarios', 'Artículos']));
  let tree = h.render(props); let html = renderToStaticMarkup(tree);
  assert.match(html, /<table/); assert.match(html, /Activa/); assert.match(html, /Inactiva/);
  assert.doesNotMatch(html, /Calle del Almacén|Editar|Eliminar/);
  assert.match(renderToStaticMarkup(page), /Nueva sede/);
  const buttons = () => all(tree).filter(node => node.type === 'button');
  let stopped = false;
  buttons()[0].props.onClick({ stopPropagation: () => { stopped = true; } }); tree = h.render(props);
  assert.ok(stopped); assert.equal(buttons()[0].props['aria-expanded'], true);
  html = renderToStaticMarkup(tree); assert.match(html, /Calle del Almacén/); assert.match(html, /Editar/); assert.match(html, /Eliminar/);
  assert.match(html, /data-id="one"/);
  const detail = all(tree).find(node => node.props?.id === buttons()[0].props['aria-controls']);
  assert.equal(detail.props.children.props.colSpan, 4);
  all(tree).find(node => node.type === 'tr' && node.props.className === 'ec-template-summary').props.onClick(); tree = h.render(props);
  assert.equal(buttons()[0].props['aria-expanded'], false); assert.equal(buttons()[1].props['aria-expanded'], true);
  html = renderToStaticMarkup(tree); assert.doesNotMatch(html, /Calle del Almacén/); assert.match(html, /Sin dirección indicada|Sin indicar/);
  buttons()[1].props.onClick({ stopPropagation() {} }); tree = h.render(props);
  assert.ok(buttons().every(node => !node.props['aria-expanded']));
});

test('headquarters access is checked once before queries, and an empty catalogue keeps the creation prompt', async () => {
  const denied = harness({ admin: false }); await assert.rejects(denied.page(), /REDIRECT/); assert.equal(denied.calls.length, 0);
  const h = harness({ rows: { headquarters: [] } }); const html = renderToStaticMarkup(await h.page());
  assert.match(html, /Todavía no hay sedes creadas/); assert.match(html, /Nueva sede/); assert.doesNotMatch(html, /<table/);
});

test('headquarters and counts read every page instead of truncating totals at the Supabase limit', async () => {
  const h = harness({ rows: {
    headquarters: [...Array.from({ length: 500 }, (_, i) => ({ ...site, id: `site-${i}` })), ...sites],
    inventory_items: Array.from({ length: 1001 }, () => ({ headquarters_id: 'one' })),
    profiles: Array.from({ length: 501 }, () => ({ headquarters_id: 'one' }))
  } });
  const props = h.table(await h.page()).props; assert.equal(props.rows.length, 502);
  const row = props.rows.find(row => row.id === 'one');
  assert.equal(row.cells[1].props.children, 501); assert.equal(row.cells[2].props.children, 1001);
  assert.ok(h.calls.some(c => c.table === 'headquarters' && c.from === 500));
  assert.ok(h.calls.some(c => c.table === 'inventory_items' && c.from === 1000));
});

test('failed headquarters reads never show a partial list, and failed counts are unavailable rather than zero', async () => {
  const sitesFailure = harness({ failTable: 'headquarters', failFrom: 500, rows: { headquarters: Array.from({ length: 501 }, (_, i) => ({ ...site, id: String(i) })) } });
  const failed = await sitesFailure.page(); assert.equal(sitesFailure.table(failed), undefined);
  assert.match(renderToStaticMarkup(failed), /No se han podido cargar las sedes/);
  for (const table of ['profiles', 'inventory_items']) {
    const h = harness({ failTable: table }); const page = await h.page();
    assert.match(renderToStaticMarkup(page), /N\/D indica un total no disponible/);
    const row = h.table(page).props.rows[0]; assert.equal(row.cells[table === 'profiles' ? 1 : 2].props['aria-label'], 'No disponible');
  }
});
