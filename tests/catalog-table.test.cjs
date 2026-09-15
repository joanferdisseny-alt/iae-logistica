const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return module.exports;
}
function harness() {
  let selected = null;
  return load('app/dashboard/templates/catalog-table.tsx', { react: {
    ...React, useId: () => 'catalog', useState: () => [selected, value => { selected = typeof value === 'function' ? value(selected) : value; }]
  } }).CatalogTable;
}
function findAll(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...findAll(node.props?.children, predicate)];
}
const buttons = tree => findAll(tree, node => node.type === 'button');
const details = tree => findAll(tree, node => node.type === 'tr' && node.props.className === 'ec-template-expanded-row');

for (const kind of ['fields', 'categories']) {
  const props = {
    columns: (kind === 'fields' ? ['Campo', 'Clave', 'Tipo'] : ['Categoría', 'Código']).map(label => ({ label })),
    caption: 'Selecciona un registro', emptyMessage: 'Crea el primer registro',
    rows: ['one', 'two'].map(id => ({ id, label: id, cells: kind === 'fields' ? ['clave_' + id, 'Texto'] : ['codigo_' + id],
      details: React.createElement('button', { type: 'button' }, 'Editar ' + id) }))
  };
  test(`${kind}: compact semantic table keeps detail actions hidden until selection`, () => {
    const render = harness();
    const tree = render(props);
    assert.match(renderToStaticMarkup(tree), /<table/);
    assert.doesNotMatch(renderToStaticMarkup(tree), /Editar/);
    assert.equal(buttons(tree).length, 2);
    assert.ok(details(tree).every(row => row.props.hidden));
    let stopped = false;
    buttons(tree)[0].props.onClick({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    const open = render(props);
    assert.match(renderToStaticMarkup(open), /Editar one/);
    assert.doesNotMatch(renderToStaticMarkup(open), /Editar two/);
    assert.equal(buttons(open)[0].props['aria-expanded'], true);
    assert.equal(buttons(open)[0].props['aria-controls'], details(open)[0].props.id);
    assert.equal(details(open)[0].props.children.props.colSpan, props.columns.length);
    const summaries = findAll(open, node => node.type === 'tr' && node.props.className?.startsWith('ec-template-summary'));
    summaries[1].props.onClick();
    assert.deepEqual(details(render(props)).map(row => row.props.hidden), [true, false]);
    const refreshed = { ...props, rows: props.rows.map(row => ({ ...row, label: row.label + ' actualizado' })) };
    assert.equal(details(render(refreshed))[1].props.hidden, false);
    findAll(render(refreshed), node => node.type === 'tr' && node.props.className?.startsWith('ec-template-summary'))[1].props.onClick();
    assert.ok(details(render(props)).every(row => row.props.hidden));
    assert.doesNotMatch(renderToStaticMarkup(render({ ...props, rows: [] })), /<table/);
  });

  function pageHarness({ isAdmin = true, fail = false, many = false } = {}) {
    const ranges = [];
    const row = kind === 'fields'
      ? { id: 'one', label: 'Material', field_key: 'material', field_type: 'select', options: null }
      : { code: 'tools', name: 'Herramientas', description: null };
    const query = { select() { return this; }, order() { return this; }, range(a,b) { ranges.push([a,b]); return this; },
      async returns() { return fail ? { data: null, error: { message: 'offline' } } : {
        data: many && ranges.length === 1 ? Array.from({ length:500 }, (_,i) => ({ ...row, id: String(i), code: String(i) })) : [row], error: null
      }; } };
    const empty = () => null;
    const page = load(`app/dashboard/templates/${kind}/page.tsx`, {
      '@/lib/auth/context': { requireAccess: async () => ({ isAdmin, supabase: { from: () => query } }) },
      'next/navigation': { redirect: () => { throw new Error('REDIRECT'); } },
      '@/app/dashboard/templates/forms': { CreateFieldCatalogModal: empty, EditFieldForm: empty, CreateCategoryModal: empty, EditCategoryForm: empty },
      '@/app/dashboard/templates/special-keys-modal': { SpecialKeysModal: empty },
      '@/app/dashboard/templates/subnav': { TemplatesSubnav: empty },
      '../catalog-table': { CatalogTable: empty }
    }).default;
    return { page, ranges };
  }
  test(`${kind}: page denies non-admins and reports read failure instead of an empty catalogue`, async () => {
    const denied = pageHarness({ isAdmin: false });
    await assert.rejects(denied.page(), /REDIRECT/);
    assert.equal(denied.ranges.length, 0);
    await assert.rejects(pageHarness({ fail: true }).page(), /catálogo/);
  });
  test(`${kind}: complete catalogue paginates and nullable details still render`, async () => {
    const h = pageHarness({ many: true });
    const tree = await h.page();
    assert.deepEqual(h.ranges, [[0,499], [500,999]]);
    const table = findAll(tree, node => Array.isArray(node.props?.rows))[0];
    assert.equal(table.props.rows.length, 501);
    const html = renderToStaticMarkup(table.props.rows[500].details);
    assert.match(html, kind === 'fields' ? /Sin opciones/ : /Sin descripción/);
  });
}
