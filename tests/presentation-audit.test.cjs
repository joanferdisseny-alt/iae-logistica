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
  }).outputText, { module, exports: module.exports, FormData, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return module.exports;
}
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];
const Link = ({ children, ...props }) => React.createElement('a', props, children);

test('public landing explains current roles without promising editor stock mutations', () => {
  const Page = load('app/page.tsx', { 'next/link': Link }).default;
  const html = renderToStaticMarkup(Page());
  for (const role of ['Administrador', 'Editor', 'Lector']) assert.ok(html.includes(role));
  assert.doesNotMatch(html, /Base inicial|Modelo inicial|Ruta de construcción|Operador|Registra entradas\/salidas/);
  assert.match(html, /crea fichas de artículos/);
});

test('dashboard only offers administration to admins and exposes operational sections to all roles', async () => {
  for (const role of ['admin', 'editor', 'reader']) {
    const page = load('app/dashboard/page.tsx', {
      'next/link': Link,
      '@/lib/auth/context': { requireAccess: async () => ({ isAdmin: role === 'admin' }) }
    }).default;
    const html = renderToStaticMarkup(await page());
    for (const route of ['templates', 'users', 'headquarters']) {
      assert.equal(html.includes(`href="/dashboard/${route}"`), role === 'admin');
    }
    for (const route of ['inventory', 'locations', 'requests', 'receiving', 'checklists']) {
      assert.ok(html.includes(`href="/dashboard/${route}"`));
    }
  }
});

function templateHarness({ isAdmin = true, failSecondPage = false } = {}) {
  const calls = [];
  const TemplateTable = () => null;
  const CreateTemplateModal = () => null;
  const AssignFieldToTemplateModal = () => null;
  const page = load('app/dashboard/templates/page.tsx', {
    '@/lib/inventory/categories': load('lib/inventory/categories.ts'),
    'next/link': Link,
    'next/navigation': { redirect: href => { throw new Error('REDIRECT:' + href); } },
    './subnav': { TemplatesSubnav: () => null },
    './template-table': { TemplateTable },
    './forms': { CreateTemplateModal, AssignFieldToTemplateModal, EditTemplateForm: () => null, RemoveTemplateFieldForm: () => null },
    '@/lib/auth/context': { requireAccess: async () => ({ isAdmin, supabase: {
      from(table) {
        const call = { table, from: 0, to: 499 }; calls.push(call);
        const builder = { select: () => builder, order: () => builder,
          range: (from, to) => { call.from = from; call.to = to; return builder; },
          returns: async () => failSecondPage && call.from > 0 ? { data: null, error: { message: 'offline' } } : {
            error: null, data: Array.from({ length: 501 }, (_, i) => ({
              id: String(i), code: String(i), name: `Entry ${i}`, field_key: `field_${i}`, label: `Field ${i}`,
              category_code: 'tools', inventory_categories: null, inventory_template_fields: []
            })).slice(call.from, call.to + 1)
          }
        };
        return builder;
      }
    } }) }
  }).default;
  return { page, calls, TemplateTable, CreateTemplateModal, AssignFieldToTemplateModal };
}

test('templates and both option catalogues are fetched beyond one Supabase page', async () => {
  const h = templateHarness(); const tree = await h.page();
  const table = all(tree).find(node => node.type === h.TemplateTable);
  assert.equal(table.props.rows.length, 501);
  assert.equal(all(tree).find(node => node.type === h.CreateTemplateModal).props.categories.length, 501);
  const assign = all(table.props.rows[0].details).find(node => node.type === h.AssignFieldToTemplateModal);
  assert.equal(assign.props.fields.length, 501);
  for (const name of ['inventory_templates', 'inventory_categories', 'inventory_fields']) {
    assert.deepEqual(h.calls.filter(call => call.table === name).map(call => call.from), [0, 500]);
  }
});

test('a failed later catalogue page cannot show a misleading partial list', async () => {
  await assert.rejects(templateHarness({ failSecondPage: true }).page(), /No se han podido cargar/);
});

test('non-admins are redirected before querying configuration catalogues', async () => {
  const h = templateHarness({ isAdmin: false });
  await assert.rejects(h.page(), /REDIRECT:\/dashboard/);
  assert.equal(h.calls.length, 0);
});

test('expiry uses Madrid calendar days, including the UTC midnight boundary', () => {
  const { inventoryToday, currentInventoryStatus, filterInventoryStatus } = load('lib/inventory/expiry-status.ts');
  assert.equal(inventoryToday(new Date('2026-09-29T22:30:00Z')), '2026-09-30');
  assert.equal(inventoryToday(new Date('2026-01-01T22:30:00Z')), '2026-01-01');
  assert.equal(currentInventoryStatus({ status: 'ok', current_stock: 1, expiration_date: '2026-09-30' }, '2026-09-30'), 'ok');
  assert.equal(currentInventoryStatus({ status: 'ok', current_stock: 1, expiration_date: '2026-09-29' }, '2026-09-30'), 'expired');
  const calls = [];
  const query = Object.fromEntries(['eq', 'gt', 'lt', 'or'].map(op => [op, (...args) => calls.push([op, ...args])]));
  filterInventoryStatus(query, 'expired', '2026-09-30');
  assert.deepEqual(calls, [['gt', 'current_stock', 0], ['lt', 'expiration_date', '2026-09-30']]);
});

test('category mutations refresh their own page and saved recipient preferences refresh users', async () => {
  for (const fail of [false, true]) {
    const revalidated = [];
    const result = { data: [], error: fail ? { message: 'Rejected' } : null };
    const builder = {
      select: () => builder, eq: () => builder, insert: () => builder,
      update: () => builder, delete: () => builder, upsert: () => builder,
      maybeSingle: async () => ({ data: { code: 'tools', is_active: true }, error: result.error }),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
    };
    const supabase = { from: () => builder };
    const actions = load('app/dashboard/actions.ts', {
      'next/cache': { revalidatePath: path => revalidated.push(path) },
      '@/lib/supabase/server': { createClient: async () => supabase },
      '@/lib/members/provision': { provisionMember: () => { throw new Error('Unexpected provisioning'); } },
      '@/lib/auth/context': { requireAccess: async () => ({ isAdmin: true, supabase, user: { id: '11111111-1111-4111-8111-111111111111' } }) },
      '@/lib/inventory/validation': {},
      '@/lib/inventory/product-source': load('lib/inventory/product-source.ts')
    });
    const category = new FormData(); category.set('code', 'tools'); category.set('name', 'Herramientas');
    for (const [name, args] of [
      ['createInventoryCategory', [undefined, category]], ['updateInventoryCategory', [category]], ['deleteInventoryCategory', [category]]
    ]) {
      revalidated.length = 0;
      const response = await actions[name](...args);
      assert.equal(Boolean(response.success), !fail, name);
      assert.equal(revalidated.includes('/dashboard/templates/categories'), !fail, name);
    }
    revalidated.length = 0;
    const preferences = new FormData(); preferences.set('notificationEmail', 'audit@example.org'); preferences.set('expiryWarningDays', '14');
    const response = await actions.saveNotificationPreferences(undefined, preferences);
    assert.equal(Boolean(response.success), !fail);
    assert.equal(revalidated.includes('/dashboard/users'), !fail);
  }
});
