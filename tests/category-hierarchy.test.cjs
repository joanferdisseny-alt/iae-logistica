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
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, FormData, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return module.exports;
}
const helpers = load('lib/inventory/categories.ts');
const categories = [
  { code: 'uniformity', name: 'Uniformidad', parent_code: null },
  { code: 'first', name: 'Primera equipacion', parent_code: 'uniformity' },
  { code: 'overalls', name: 'Monos', parent_code: 'first' },
  { code: 'second', name: 'Segunda equipacion', parent_code: 'uniformity' },
  { code: 'tools', name: 'Herramientas', parent_code: null }
];
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];

test('category paths preserve originals and branches include every depth, not siblings', () => {
  const original = JSON.stringify(categories);
  const options = helpers.categoryOptions(categories);
  assert.equal(options.find(c => c.code === 'overalls').name, 'Uniformidad / Primera equipacion / Monos');
  assert.equal(options[0].name, 'Herramientas');
  assert.deepEqual(Array.from(helpers.categoryBranch('first', categories)), ['first', 'overalls']);
  assert.deepEqual(Array.from(helpers.categoryBranch('uniformity', categories)), ['uniformity', 'first', 'second', 'overalls']);
  assert.deepEqual(Array.from(helpers.categoryBranch('deleted', categories)), ['deleted']);
  assert.equal(JSON.stringify(categories), original);
});

test('a damaged or incomplete category graph cannot hang page rendering', () => {
  const damaged = [
    { code: 'a', name: 'A', parent_code: 'b' }, { code: 'b', name: 'B', parent_code: 'a' },
    { code: 'c', name: 'C', parent_code: 'missing' }
  ];
  assert.equal(helpers.categoryOptions(damaged).length, 3);
  assert.deepEqual(Array.from(helpers.categoryBranch('a', damaged)), ['a', 'b']);
  assert.equal(helpers.categoryOptions(damaged).find(c => c.code === 'c').name, 'C');
});

test('category page shows full paths and excludes descendants from edit parent choices', async () => {
  const query = { select() { return this; }, order() { return this; }, range() { return this; },
    returns: async () => ({ data: categories, error: null }) };
  const CreateCategoryModal = () => null;
  const EditCategoryForm = () => null;
  const CatalogTable = () => null;
  const page = load('app/dashboard/templates/categories/page.tsx', {
    '@/lib/inventory/categories': helpers,
    '@/lib/auth/context': { requireAccess: async () => ({ isAdmin: true, supabase: { from: () => query } }) },
    'next/navigation': { redirect: () => { throw Error('Unexpected redirect'); } },
    '@/app/dashboard/templates/forms': { CreateCategoryModal, EditCategoryForm },
    '@/app/dashboard/templates/subnav': { TemplatesSubnav: () => null }, '../catalog-table': { CatalogTable }
  }).default;
  const tree = await page();
  assert.equal(all(tree).find(node => node.type === CreateCategoryModal).props.categories.length, 5);
  const rows = all(tree).find(node => node.type === CatalogTable).props.rows;
  assert.equal(rows.find(row => row.id === 'first').label, 'Uniformidad / Primera equipacion');
  const rootEdit = all(rows.find(row => row.id === 'uniformity').details).find(node => node.type === EditCategoryForm);
  assert.deepEqual(Array.from(rootEdit.props.categories, c => c.code), ['tools']);
  const childEdit = all(rows.find(row => row.id === 'first').details).find(node => node.type === EditCategoryForm);
  assert.ok(childEdit.props.categories.some(c => c.code === 'uniformity'));
  assert.ok(!childEdit.props.categories.some(c => ['first', 'overalls'].includes(c.code)));
});

test('new and edit category popups offer a root option and preserve the selected parent', () => {
  const actions = new Proxy({}, { get: () => () => {} });
  const forms = load('app/dashboard/templates/forms.tsx', {
    react: { ...React, useState: initial => [typeof initial === 'boolean' ? true : initial, () => {}], useActionState: () => [undefined, undefined, false] },
    '@/app/dashboard/actions': actions,
    '@/app/dashboard/dialog-focus': { DialogFocus: ({ children }) => children },
    '@/app/dashboard/action-form': { ActionForm: ({ children }) => React.createElement('form', null, children) },
    'next/link': () => null
  });
  const html = renderToStaticMarkup(forms.CreateCategoryForm({ categories: helpers.categoryOptions(categories) }));
  assert.match(html, /name="parentCode"/);
  assert.match(html, /Ninguna \(categoría principal\)/);
  assert.match(html, /Uniformidad \/ Primera equipacion/);
  const edited = renderToStaticMarkup(forms.EditCategoryForm({
    category: { ...categories[1], description: null },
    categories: helpers.categoryOptions(categories.filter(c => ['tools', 'uniformity', 'second'].includes(c.code)))
  }));
  assert.match(edited, /value="uniformity" selected=""/);
  assert.equal((edited.match(/<form/g) || []).length, 2);
  assert.doesNotMatch(edited, /<form[^]*?<form[^]*?<\/form>[^]*?<\/form>/);
});

function actionHarness({ admin = true, error = null, missing = false } = {}) {
  const writes = [], revalidated = [];
  const query = {
    insert(value) { writes.push(['insert', value]); return this; },
    update(value) { writes.push(['update', value]); return this; },
    delete() { writes.push(['delete']); return this; },
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: missing ? null : { code: 'first' }, error }),
    then: (resolve, reject) => Promise.resolve({ error }).then(resolve, reject)
  };
  const supabase = { from: () => query };
  const actions = load('app/dashboard/actions.ts', {
    'next/cache': { revalidatePath: path => revalidated.push(path) },
    '@/lib/auth/context': { requireAccess: async () => ({ isAdmin: admin, supabase, user: { id: 'admin' } }) },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/supabase/admin': { createAdminClient: () => { throw Error('Unexpected privileged client'); } },
    '@/lib/inventory/validation': {}, '@/lib/inventory/product-source': load('lib/inventory/product-source.ts')
  });
  return { actions, writes, revalidated };
}
const form = parent => {
  const data = new FormData(); data.set('code', 'first'); data.set('name', 'Primera'); data.set('parentCode', parent); return data;
};

test('category mutations persist parent or root and never let non-admins write', async () => {
  for (const admin of [true, false]) {
    const h = actionHarness({ admin });
    const created = await h.actions.createInventoryCategory(undefined, form('uniformity'));
    const updated = await h.actions.updateInventoryCategory(form(''));
    const deleted = await h.actions.deleteInventoryCategory(form(''));
    for (const response of [created, updated, deleted]) assert.equal(Boolean(response.success), admin);
    if (admin) {
      assert.equal(h.writes[0][1].parent_code, 'uniformity');
      assert.equal(h.writes[1][1].parent_code, null);
    } else assert.equal(h.writes.length, 0);
  }
});

test('category constraints and missing records report errors rather than success', async () => {
  for (const [code, message] of [
    ['23503', /categoría superior ya no existe/], ['23505', /Ya existe/],
    ['23514', /sí misma/], ['PGRST204', /upgrade-category-hierarchy/]
  ]) {
    const h = actionHarness({ error: { code, message: 'Database rejection' } });
    assert.match((await h.actions.createInventoryCategory(undefined, form('uniformity'))).error, message);
    assert.match((await h.actions.updateInventoryCategory(form('uniformity'))).error, message);
    assert.equal(h.revalidated.length, 0);
  }
  const used = actionHarness({ error: { code: '23503', message: 'Dependants' } });
  assert.match((await used.actions.deleteInventoryCategory(form(''))).error, /subcategorías, fichas o artículos/);
  const restrict = actionHarness({ error: { code: '23001', message: 'RESTRICT' } });
  assert.match((await restrict.actions.deleteInventoryCategory(form(''))).error, /subcategorías, fichas o artículos/);
  const missing = actionHarness({ missing: true });
  assert.match((await missing.actions.updateInventoryCategory(form(''))).error, /ya no existe/);
  assert.match((await missing.actions.deleteInventoryCategory(form(''))).error, /ya no existe/);
  const invalid = actionHarness();
  assert.ok((await invalid.actions.createInventoryCategory(undefined, form('bad parent'))).error);
  assert.equal(invalid.writes.length, 0);
});
