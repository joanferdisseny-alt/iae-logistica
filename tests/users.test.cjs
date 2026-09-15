const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(`app/dashboard/users/${file}`, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return module.exports;
}
const model = load('model.ts');
const id = '11111111-1111-4111-8111-111111111111';
const site = '22222222-2222-4222-8222-222222222222';
const plain = value => JSON.parse(JSON.stringify(value));
function findAll(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...findAll(node.props?.children, predicate)];
}
function pageHarness(options = {}) {
  const calls = [];
  const empty = () => null;
  const access = { isAdmin: options.isAdmin ?? true, user: { id }, supabase: {
    from(table) {
      calls.push(['from', table]);
      return {
        select(...args) { calls.push([table, 'select', ...args]); return this; },
        order(...args) { calls.push([table, 'order', ...args]); return this; },
        eq(...args) { calls.push([table, 'eq', ...args]); return this; },
        ilike(...args) { calls.push([table, 'ilike', ...args]); return this; },
        range(...args) { calls.push([table, 'range', ...args]); return this; },
        async returns() {
          if (options.fail === table) return { data: null, error: { message: 'offline' } };
          if (table === 'app_roles') return { data: [{ id, code: 'reader', name: 'Lector' }], error: null };
          if (table === 'headquarters') return { data: [{ id: site, name: 'Valencia', is_active: true }], error: null };
          return { data: [{ id, full_name: null, is_active: true, headquarters_id: site, is_logistics_contact: false,
            notification_preferences: null, app_roles: { code: 'reader', name: 'Lector' }, headquarters: { name: 'Valencia' } }], error: null, count: options.count ?? 100 };
        }
      };
    }
  } };
  const page = load('page.tsx', {
    './model': model, '@/lib/auth/context': { requireAccess: async () => access },
    'next/navigation': { redirect: href => { throw new Error(`REDIRECT:${href}`); } },
    'next/link': { default: empty }, '@/app/dashboard/create-user-form': { CreateUserModal: empty },
    '@/app/dashboard/templates/catalog-table': { CatalogTable: empty },
    './user-details': { EditUserModal: empty, UserContact: empty }
  }).default;
  return { calls, page: params => page({ searchParams: Promise.resolve(params ?? {}) }) };
}

test('user filters normalize invalid parameters, escape SQL wildcards and preserve pagination filters', () => {
  const filters = model.parseUserFilters({ page: '-1', q: '  Ana  ', site: 'bad', status: 'bad' });
  assert.deepEqual(plain(filters), { q: 'Ana', page: 1, site: '', status: '' });
  assert.equal(model.parseUserFilters({ q: ['a','b'], page: '1.2' }).q, '');
  assert.equal(model.parseUserFilters({ q: 'x'.repeat(200) }).q.length, 120);
  assert.equal(model.escapeUserSearch('Ana%_\\'), 'Ana\\%\\_\\\\');
  const params = new URL(model.userListHref({ q: 'Ana & Luis', site, status: 'inactive' }, 3), 'https://test.invalid').searchParams;
  assert.equal(params.get('q'), 'Ana & Luis');
  assert.equal(params.get('site'), site);
  assert.equal(params.get('status'), 'inactive');
  assert.equal(params.get('page'), '3');
});

test('user table paginates profiles in the database and never lists all auth accounts', async () => {
  const h = pageHarness();
  const tree = await h.page({ page: '3', q: 'Ana%_', site, status: 'inactive' });
  assert.ok(h.calls.some(call => JSON.stringify(call) === JSON.stringify(['profiles', 'range', 50, 74])));
  assert.ok(h.calls.some(call => JSON.stringify(call) === JSON.stringify(['profiles', 'ilike', 'full_name', '%Ana\\%\\_%'])));
  assert.ok(h.calls.some(call => JSON.stringify(call) === JSON.stringify(['profiles', 'eq', 'headquarters_id', site])));
  assert.ok(h.calls.some(call => JSON.stringify(call) === JSON.stringify(['profiles', 'eq', 'is_active', false])));
  const table = findAll(tree, node => Array.isArray(node.props?.rows))[0];
  assert.equal(table.props.columns.length, 4);
  assert.equal(table.props.rows[0].cells.length, 3);
  assert.equal(table.props.rows[0].label, 'Usuario sin nombre');
  assert.equal(h.calls.filter(call => call[0] === 'from').length, 3);
});

test('user list denies non-admin access before queries and fails explicitly on incomplete catalogues', async () => {
  const denied = pageHarness({ isAdmin: false });
  await assert.rejects(denied.page(), /REDIRECT/);
  assert.equal(denied.calls.length, 0);
  for (const fail of ['profiles', 'headquarters', 'app_roles']) await assert.rejects(pageHarness({ fail }).page(), /No se pueden cargar/);
  await assert.rejects(pageHarness({ count: 26 }).page({ page: '99', q: 'Ana' }), /REDIRECT:.*page=2&q=Ana/);
});

function contactHarness(options = {}) {
  const calls = [];
  const action = load('contact-action.ts', {
    '@/lib/auth/context': { requireAccess: async () => {
      if (options.inactive) throw new Error('INACTIVE');
      return { isAdmin: options.isAdmin ?? true };
    } },
    '@/lib/supabase/admin': { createAdminClient() {
      calls.push('admin');
      return { auth: { admin: { getUserById: async value => {
        calls.push(value);
        return { data: { user: { id, email: 'test@example.org', app_metadata: { secret: 'not-returned' } } }, error: options.error };
      } } } };
    } }
  }).getUserContact;
  return { action, calls };
}
test('on-demand email retrieval checks current admin permissions and returns only the requested email', async () => {
  for (const options of [{ isAdmin: false }, {}]) {
    const h = contactHarness(options);
    assert.ok((await h.action(options.isAdmin === false ? id : 'bad')).error);
    assert.equal(h.calls.length, 0);
  }
  const inactive = contactHarness({ inactive: true });
  await assert.rejects(inactive.action(id), /INACTIVE/);
  assert.equal(inactive.calls.length, 0);
  const h = contactHarness();
  assert.deepEqual(plain(await h.action(id)), { email: 'test@example.org' });
  assert.deepEqual(h.calls, ['admin', id]);
  assert.ok((await contactHarness({ error: { message: 'private backend details' } }).action(id)).error);
});

test('user edit popup has one form for all access fields and prevents self-deactivation in the UI', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { EditUserModal } = load('user-details.tsx', {
    '@/app/dashboard/action-form': { ActionForm: ({ children }) => React.createElement('form', null, children) },
    '@/app/dashboard/actions': { updateUserAccess: async () => {} },
    '@/app/dashboard/inventory/notification-preferences-form': { NotificationPreferencesModal: () => null },
    './contact-action': { getUserContact: async () => ({ email: 'test@example.org' }) }
  });
  const html = renderToStaticMarkup(React.createElement(EditUserModal, {
    member: { id, full_name: 'Ana', app_roles: { code: 'admin', name: 'Administrador' }, headquarters_id: null, is_active: true, is_logistics_contact: true },
    roles: [{ id, code: 'admin', name: 'Administrador' }], headquarters: [], isSelf: true
  }));
  assert.equal((html.match(/<form/g) ?? []).length, 1);
  for (const name of ['profileId', 'roleCode', 'headquartersId', 'isActive', 'isLogisticsContact']) assert.ok(html.includes(`name="${name}"`));
  assert.match(html, /<option value="false" disabled="">Inactivo/);
  assert.match(html, /Todas las sedes/);
  assert.match(html, /<dialog[^>]+aria-labelledby=/);
});
