const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(path, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  } }).outputText, { module, exports: module.exports, require: name => mocks[name] ?? require(name) });
  return module.exports;
}
const navigation = load('lib/navigation.ts');
test('four ERP areas preserve every operational route and isolate volunteer navigation', () => {
  const areas = navigation.workspaceAreas('admin');
  assert.deepEqual(Array.from(areas, area => area.id), ['catalog', 'warehouse', 'people', 'settings']);
  assert.equal(areas.flatMap(area => area.links).length, 14);
  const reader = navigation.workspaceAreas('reader');
  assert.ok(reader.flatMap(area => area.links).every(link => !link.adminOnly));
  assert.deepEqual(Array.from(navigation.workspaceAreas('volunteer').flatMap(area => area.links), link => link.href), ['/dashboard/personal', '/dashboard/requests']);
});
test('deep item and QR routes activate the right area without changing their URLs', () => {
  const areas = navigation.workspaceAreas('admin');
  for (const [path, selected] of [
    ['/dashboard/inventory/example-id', '/dashboard/inventory'],
    ['/dashboard/stock/position-qr', '/dashboard/inventory'],
    ['/dashboard/locations/physical', '/dashboard/locations/physical'],
    ['/dashboard/locations/containers/example-id', '/dashboard/locations'],
    ['/dashboard/templates/fields', '/dashboard/templates/fields'],
    ['/dashboard/checklists/example-id', '/dashboard/checklists']
  ]) assert.equal(navigation.currentWorkspaceLink(areas, path).link.href, selected);
  assert.equal(navigation.currentWorkspaceLink(areas, '/dashboard'), undefined);
});
test('shell exposes accessible mobile dialog and only permitted tabs, without eager link prefetch', () => {
  const { DashboardShell } = load('app/dashboard/shell.tsx', {
    '@/lib/navigation': navigation,
    'next/link': ({ children, prefetch, ...props }) => React.createElement('a', { ...props, 'data-prefetch': String(prefetch) }, children),
    'next/navigation': { usePathname: () => '/dashboard/templates/fields' }
  });
  const html = role => renderToStaticMarkup(React.createElement(DashboardShell, { roleCode: role, roleName: role, userLabel: 'Persona de prueba', signOutAction: async () => {}, children: 'Contenido' }));
  assert.match(html('admin'), /<dialog[^>]*aria-label="Navegación"/);
  assert.match(html('admin'), /aria-current="page"[^>]*>Campos/);
  assert.match(html('admin'), /data-prefetch="false"/);
  assert.doesNotMatch(html('reader'), /href="\/dashboard\/(templates|users|imports|headquarters)/);
  assert.doesNotMatch(html('volunteer'), /href="\/dashboard\/(inventory|locations|receiving|users)/);
});

function optionsHarness(role = 'admin', failTable) {
  const calls = [];
  const hq = 'hq';
  const data = {
    headquarters: [{ id: hq, name: 'Valencia' }],
    locations: [{ id: 'shelf', name: 'Armario', code: 'A', headquarters_id: hq }, { id: 'rack', name: 'Estante', headquarters_id: hq, parent_location_id: 'shelf' }],
    inventory_containers: [], inventory_categories: [{ code: 'clothing', name: 'Ropa' }],
    inventory_templates: Array.from({ length: 501 }, (_, i) => ({ id: String(i), code: 'template' + i, name: 'Prenda', category_code: 'clothing', inventory_template_fields: [
      { sort_order: 0, is_required: true, allowed_options: ['M'], inventory_fields: { field_key: 'size', label: 'Talla', field_type: 'select', options: ['S', 'M', 'L'] } }
    ] }))
  };
  const requireAccess = async () => ({ roleCode: role, isAdmin: role === 'admin', profile: { headquarters_id: hq }, user: { id: 'me', email: 'admin@example.org' }, supabase: {
    from(table) {
      const call = { table, filters: [], from: 0, to: 499 }; calls.push(call);
      const query = { select: () => query, eq: (field, value) => { call.filters.push([field, value]); return query; }, order: () => query,
        range: (from, to) => { call.from = from; call.to = to; return query; },
        returns: async () => ({ data: failTable === table ? null : (data[table] ?? []).slice(call.from, call.to + 1), error: failTable === table ? {} : null }),
        maybeSingle: async () => ({ data: null, error: failTable === table ? {} : null }) };
      return query;
    }
  } });
  return { calls, ...load('app/dashboard/inventory/options.ts', {
    '@/lib/auth/context': { requireAccess }, '@/lib/read-all': load('lib/read-all.ts'), '@/lib/inventory/categories': load('lib/inventory/categories.ts')
  }) };
}
test('lazy creation options retain full pagination, allowed sizes and location hierarchy', async () => {
  const h = optionsHarness();
  const options = await h.loadCreateItemOptions();
  assert.equal(options.templates.length, 501);
  assert.deepEqual(Array.from(options.templates[0].fields[0].options), ['M']);
  assert.equal(options.locations[1].name, 'Armario · A / Estante');
  assert.equal(options.canChooseHeadquarters, true);
});
test('lazy form reads recheck role and enforce site scopes instead of trusting the button', async () => {
  const reader = optionsHarness('reader');
  await assert.rejects(reader.loadCreateItemOptions(), /permiso/);
  await assert.rejects(reader.loadOwnAlertOptions(), /administrador/);
  assert.equal(reader.calls.length, 0);
  const editor = optionsHarness('editor'); await editor.loadCreateItemOptions();
  for (const table of ['headquarters', 'locations', 'inventory_containers']) {
    assert.ok(editor.calls.find(call => call.table === table).filters.some(([field, value]) => field === (table === 'headquarters' ? 'id' : 'headquarters_id') && value === 'hq'));
  }
  const admin = optionsHarness(); await admin.loadOwnAlertOptions();
  assert.deepEqual(admin.calls[0].filters, [['profile_id', 'me']]);
});
test('an incomplete lazy catalogue fails explicitly, never returns truncated selectable options', async () => {
  await assert.rejects(optionsHarness('admin', 'inventory_templates').loadCreateItemOptions(), /datos completos/);
  await assert.rejects(optionsHarness('admin', 'notification_preferences').loadOwnAlertOptions(), /avisos/);
});
