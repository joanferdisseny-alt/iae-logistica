const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function loadTypeScript(file, resolve = require) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  return module.exports;
}
const { handleNotificationCron, notificationKey, escapeHtml } = loadTypeScript('lib/notifications/cron.ts');
const env = { CRON_SECRET: 'test-secret', RESEND_API_KEY: 're_fake', ALERTS_FROM_EMAIL: 'Logistica <alerts@example.org>' };
const request = (headers = { authorization: 'Bearer test-secret' }) => new Request('https://example.org/api/cron/expiry-alerts', { headers });
const preference = (id = 'p1', role = 'reader', headquarters = 'hq1') => ({
  profile_id: id, notification_email: `${id}@example.org`, expiry_warning_days: 14,
  email_notifications_enabled: true,
  profiles: { is_active: true, is_logistics_contact: true, headquarters_id: headquarters, app_roles: { code: role } }
});
const item = (overrides = {}) => ({
  id: 'i1', name: 'Material', headquarters_id: 'hq1', location_id: null,
  expiration_date: '2026-09-01', maintenance_due_at: null, status: 'ok', operational_status: null,
  current_stock: 10, minimum_stock: 2, unit: 'uds.', inventory_container_items: [], ...overrides
});

function database(seed = {}, faults = {}) {
  const tables = { notification_preferences: [preference()], inventory_items: [item()], inventory_stock_positions: [], locations: [], alerts: [], notification_events: [], ...structuredClone(seed) };
  const calls = [];
  const unique = (table, row) => table === 'alerts'
    ? JSON.stringify([row.item_id, row.alert_type, row.trigger_date])
    : JSON.stringify([row.profile_id, row.item_id, row.alert_type, row.sent_for_date]);
  return {
    tables, calls,
    from(table) {
      const call = { table, operation: 'read', filters: [], range: null };
      calls.push(call);
      const query = {
        select(fields) { call.select = fields; return query; },
        eq(key, value) { call.filters.push([key, value]); return query; },
        order(key) { call.order = key; return query; },
        range(start, end) { call.range = [start, end]; return query; },
        limit(value) { call.limit = value; return query; },
        returns() { return query; },
        upsert(value, options) { call.operation = 'upsert'; call.value = value; call.options = options; return query; },
        insert(value) { call.operation = 'insert'; call.value = value; return query; },
        then(resolve, reject) {
          return Promise.resolve().then(async () => {
            const fault = faults[`${table}:${call.operation}`];
            if (fault) {
              const error = typeof fault === 'function' ? await fault(call) : fault;
              if (error) return { data: null, error };
            }
            if (call.operation !== 'read') {
              const previous = tables[table].find((row) => unique(table, row) === unique(table, call.value));
              if (previous) {
                if (call.operation === 'insert') return { data: null, error: { code: '23505' } };
                assert.equal(call.options.ignoreDuplicates, true, 'Existing alert states must not be overwritten');
                return { data: [], error: null };
              }
              const row = { id: `${table}-${tables[table].length}`, ...call.value };
              tables[table].push(row);
              return { data: [row], error: null };
            }
            let rows = tables[table].filter((row) => call.filters.every(([key, value]) => row[key] === value));
            if (call.order) rows = rows.toSorted((a, b) => String(a[call.order]).localeCompare(String(b[call.order])));
            if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
            if (call.limit) rows = rows.slice(0, call.limit);
            return { data: structuredClone(rows), error: null };
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

function provider() {
  const requests = [];
  const accepted = new Map();
  return {
    requests, accepted,
    async fetch(url, options) {
      assert.equal(url, 'https://api.resend.com/emails');
      assert.ok(options.signal);
      requests.push(options);
      const key = options.headers['Idempotency-Key'];
      assert.ok(key);
      assert.equal(JSON.parse(options.body).to.length, 1);
      if (accepted.has(key) && accepted.get(key) !== options.body) return Response.json({}, { status: 409 });
      accepted.set(key, options.body);
      return Response.json({ id: `email-${key}` });
    }
  };
}

async function run(db = database(), mail = provider(), overrides = {}, req = request()) {
  const response = await handleNotificationCron(req, {
    env, createClient: () => db, fetch: mail.fetch, now: () => new Date('2026-09-14T07:00:00Z'), ...overrides
  });
  return { status: response.status, body: await response.json(), db, mail };
}

test('missing/blank cron secret fails closed before admin or email', async () => {
  for (const secret of [undefined, '', '   ', 'bad\nsecret']) {
    const result = await run(undefined, undefined, {
      env: { ...env, CRON_SECRET: secret }, createClient: () => assert.fail('admin must not load')
    }, request({}));
    assert.equal(result.status, 503);
    assert.equal(result.mail.requests.length, 0);
    assert.equal(result.db.calls.length, 0);
  }
});

test('bad credentials return 401 before configuration/admin; alternate secret header works', async () => {
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-cron-secret': 'wrong' }]) {
    const result = await run(undefined, undefined, { env: { CRON_SECRET: env.CRON_SECRET }, createClient: () => assert.fail('admin must not load') }, request(headers));
    assert.equal(result.status, 401);
  }
  assert.equal((await run(undefined, undefined, {}, request({ 'x-cron-secret': env.CRON_SECRET }))).status, 200);
});

test('invalid provider config never creates alerts/events or calls admin', async () => {
  for (const invalid of [{ RESEND_API_KEY: undefined }, { RESEND_API_KEY: ' ' }, { ALERTS_FROM_EMAIL: undefined }, { ALERTS_FROM_EMAIL: 'invalid' }, { ALERTS_FROM_EMAIL: 'alerts@example.org\nBcc: x@example.org' }]) {
    const result = await run(undefined, undefined, { env: { ...env, ...invalid }, createClient: () => assert.fail('admin must not load') });
    assert.equal(result.status, 503);
    assert.equal(result.db.tables.notification_events.length, 0);
    assert.equal(result.mail.requests.length, 0);
  }
});

test('route defers admin module import until authentication and provider validation', async () => {
  let imported = 0;
  const route = loadTypeScript('app/api/cron/expiry-alerts/route.ts', (name) => {
    if (name === '@/lib/notifications/cron') return { handleNotificationCron: (req, deps) => handleNotificationCron(req, { ...deps, env }) };
    if (name === '@/lib/supabase/admin') { imported++; throw new Error('no real admin access'); }
    throw new Error(`Unexpected dependency: ${name}`);
  });
  assert.equal((await route.GET(request({}))).status, 401);
  assert.equal(imported, 0);
  const authorized = await route.GET(request());
  assert.equal(authorized.status, 500);
  assert.equal(imported, 1);
  assert.equal((await authorized.json()).failures[0].stage, 'admin_client_configuration');
});

test('overdue expiry, low stock and overdue maintenance each get their own email/event', async () => {
  const result = await run(database({ inventory_items: [item({ current_stock: 2, maintenance_due_at: '2026-08-20' })] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.acceptedEmails, 3);
  assert.equal(result.body.recordedEvents, 3);
  assert.equal(result.body.generatedAlerts, 3);
  assert.deepEqual(result.db.tables.notification_events.map((row) => [row.alert_type, row.sent_for_date]), [
    ['expiry', '2026-09-01'], ['low_stock', '2026-09-14'], ['maintenance', '2026-08-20']
  ]);
});

test('future boundaries and maintenance status without a due date', async () => {
  const result = await run(database({ inventory_items: [
    item({ id: 'boundary', expiration_date: '2026-09-28' }),
    item({ id: 'later', expiration_date: '2026-09-29', maintenance_due_at: '2026-09-15' }),
    item({ id: 'repair', expiration_date: null, status: 'maintenance' })
  ] }));
  assert.equal(result.body.acceptedEmails, 2);
  assert.deepEqual(result.db.tables.notification_events.map((row) => [row.item_id, row.alert_type]), [['boundary', 'expiry'], ['repair', 'maintenance']]);
});

test('alerts are generated without any subscribed users and resolved alerts remain resolved', async () => {
  const db = database({ notification_preferences: [], alerts: [{ id: 'a1', item_id: 'i1', alert_type: 'expiry', trigger_date: '2026-09-01', status: 'resolved' }] });
  let result = await run(db);
  assert.equal(result.body.generatedAlerts, 0);
  assert.equal(db.tables.alerts[0].status, 'resolved');
  db.tables.inventory_items.push(item({ id: 'i2' }));
  result = await run(db);
  assert.equal(result.body.generatedAlerts, 1);
  assert.equal(result.mail.requests.length, 0);
});

test('only active subscribed admins/contacts; reader/editor contacts see only their headquarters', async () => {
  const inactive = preference('inactive', 'admin', null);
  inactive.profiles.is_active = false;
  const disabled = { ...preference('disabled'), email_notifications_enabled: false };
  const result = await run(database({ notification_preferences: [
    preference('admin', 'admin', null), preference('reader'), preference('editor', 'editor', 'hq2'),
    preference('unassigned', 'reader', null), inactive, disabled, { ...preference('missing'), profiles: null }
  ], inventory_items: [item(), item({ id: 'i2', headquarters_id: 'hq2' }), item({ id: 'i3', headquarters_id: null })] }));
  assert.equal(result.body.acceptedEmails, 5);
  assert.deepEqual(result.db.tables.notification_events.map((row) => `${row.profile_id}:${row.item_id}`).sort(), ['admin:i1', 'admin:i2', 'admin:i3', 'editor:i2', 'reader:i1']);
});

test('recipient email and warning window validation is explicit, no event for invalid preferences', async () => {
  for (const invalid of [{ notification_email: null }, { notification_email: 'bad' }, { expiry_warning_days: 0 }, { expiry_warning_days: 366 }, { expiry_warning_days: 1.5 }]) {
    const result = await run(database({ notification_preferences: [{ ...preference(), ...invalid }] }));
    assert.equal(result.status, 500);
    assert.equal(result.body.failures[0].stage, 'recipient_configuration');
    assert.equal(result.db.tables.notification_events.length, 0);
    assert.equal(result.mail.requests.length, 0);
  }
});

test('each recipient uses their own expiry horizon, including all overdue items', async () => {
  const result = await run(database({ notification_preferences: [{ ...preference('short'), expiry_warning_days: 1 }, { ...preference('long'), expiry_warning_days: 30 }], inventory_items: [item(), item({ id: 'future', expiration_date: '2026-10-10' })] }));
  assert.equal(result.body.acceptedEmails, 3);
  assert.ok(!result.db.tables.notification_events.some((row) => row.profile_id === 'short' && row.item_id === 'future'));
});

test('HTML escaping covers item, unit, location path and effective box; ignores stale direct placement', async () => {
  const result = await run(database({ inventory_items: [item({ name: '<img src=x onerror=alert(1)>', unit: '"<&', location_id: 'stale', inventory_container_items: [{ inventory_containers: { name: "Kit '<script>", headquarters_id: 'hq1', location_id: 'shelf' } }] })], locations: [
    { id: 'room', name: 'Almacen & central', headquarters_id: 'hq1', parent_location_id: null },
    { id: 'shelf', name: '<Estante>', headquarters_id: 'hq1', parent_location_id: 'room' }
  ] }));
  assert.equal(result.status, 200);
  const html = JSON.parse(result.mail.requests[0].body).html;
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Almacen &amp; central &gt; &lt;Estante&gt; &gt; Caja: Kit &#39;&lt;script&gt;'));
  assert.ok(html.includes('&quot;&lt;&amp;'));
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('cross-headquarters box, location cycles and missing locations do not leak location data', async () => {
  for (const seed of [
    { inventory_items: [item({ inventory_container_items: [{ inventory_containers: { name: 'Private', headquarters_id: 'hq2', location_id: null } }] })] },
    { inventory_items: [item({ location_id: 'loop' })], locations: [{ id: 'loop', name: 'Loop', headquarters_id: 'hq1', parent_location_id: 'loop' }] },
    { inventory_items: [item({ location_id: 'missing' })] }
  ]) {
    const result = await run(database(seed));
    assert.equal(result.status, 500);
    assert.equal(result.body.failures[0].stage, 'item_location_integrity');
    assert.equal(result.mail.requests.length, 0);
    assert.equal(result.db.tables.notification_events.length, 0);
  }
});

test('database read/write failures are explicit and never marked sent', async () => {
  for (const [operation, stage] of [
    ['notification_preferences:read', 'preferences_read'], ['inventory_items:read', 'inventory_read'],
    ['locations:read', 'locations_read'], ['alerts:upsert', 'alert_write'], ['notification_events:read', 'events_read']
  ]) {
    const result = await run(database({}, { [operation]: { code: 'DB_ERROR' } }));
    assert.equal(result.status, 500);
    assert.equal(result.body.failures[0].stage, stage);
    assert.equal(result.mail.requests.length, 0);
    assert.equal(result.db.tables.notification_events.length, 0);
  }
});

test('provider errors, conflicts, timeouts and malformed success do not create events', async () => {
  for (const fetch of [
    async () => Response.json({}, { status: 429 }), async () => Response.json({}, { status: 409 }),
    async () => Response.json({}, { status: 500 }), async () => { throw new Error('timeout'); },
    async () => new Response('invalid json'), async () => Response.json({}), async () => Response.json({ id: '' })
  ]) {
    const result = await run(undefined, undefined, { fetch });
    assert.equal(result.status, 500);
    assert.equal(result.body.failures[0].stage, 'email_provider');
    assert.equal(result.body.acceptedEmails, 0);
    assert.equal(result.db.tables.notification_events.length, 0);
  }
});

test('sequential retries do not resend, keys are stable and isolated by user/item/type/date', async () => {
  const db = database();
  const mail = provider();
  await run(db, mail);
  const retry = await run(db, mail);
  assert.equal(retry.body.alreadyNotified, 1);
  assert.equal(mail.requests.length, 1);
  const key = notificationKey('p1', 'i1', 'expiry', '2026-09-01');
  assert.equal(key, mail.requests[0].headers['Idempotency-Key']);
  assert.ok(key.length < 256);
  const keys = new Set([key, notificationKey('p2', 'i1', 'expiry', '2026-09-01'), notificationKey('p1', 'i2', 'expiry', '2026-09-01'), notificationKey('p1', 'i1', 'maintenance', '2026-09-01'), notificationKey('p1', 'i1', 'expiry', '2026-09-02')]);
  assert.equal(keys.size, 5);
});

test('concurrent runs use same provider key and tolerate duplicate event insertion', async () => {
  const db = database();
  const mail = provider();
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const fetch = async (...args) => {
    arrivals++;
    if (arrivals === 2) release();
    await barrier;
    return mail.fetch(...args);
  };
  const results = await Promise.all([run(db, mail, { fetch }), run(db, mail, { fetch })]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  assert.equal(mail.requests.length, 2);
  assert.equal(mail.accepted.size, 1);
  assert.equal(db.tables.notification_events.length, 1);
  assert.equal(results.reduce((sum, result) => sum + result.body.recordedEvents, 0), 1);
});

test('acceptance followed by database failure is explicit and retry reuses the same provider payload/key', async () => {
  let fail = true;
  const db = database({}, { 'notification_events:insert': () => fail ? { code: '08006' } : null });
  const mail = provider();
  const first = await run(db, mail);
  assert.equal(first.status, 500);
  assert.equal(first.body.acceptedEmails, 1);
  assert.equal(first.body.recordedEvents, 0);
  assert.equal(first.body.failures[0].stage, 'event_write_after_acceptance');
  fail = false;
  const retry = await run(db, mail, { now: () => new Date('2026-09-15T06:59:00Z') });
  assert.equal(retry.status, 200);
  assert.equal(mail.accepted.size, 1);
  assert.equal(db.tables.notification_events.length, 1);
});

test('provider payload changes return explicit conflict, never rotate key to bypass deduplication', async () => {
  const db = database({}, { 'notification_events:insert': { code: '08006' } });
  const mail = provider();
  await run(db, mail);
  db.tables.inventory_items[0].name = 'Changed';
  const retry = await run(db, mail);
  assert.equal(retry.body.failures[0].code, 'http_409');
  assert.equal(mail.accepted.size, 1);
  assert.equal(db.tables.notification_events.length, 0);
});

test('pagination processes items and preferences beyond the first page', async () => {
  const prefs = Array.from({ length: 501 }, (_, index) => preference(`p${String(index).padStart(4, '0')}`, 'reader', 'elsewhere'));
  prefs[500].profiles.headquarters_id = 'hq1';
  const items = Array.from({ length: 501 }, (_, index) => item({ id: `i${String(index).padStart(4, '0')}`, expiration_date: null }));
  items[500].expiration_date = '2026-09-01';
  const result = await run(database({ notification_preferences: prefs, inventory_items: items }));
  assert.equal(result.status, 200);
  assert.equal(result.body.recordedEvents, 1);
  assert.equal(result.db.tables.notification_events[0].profile_id, 'p0500');
  assert.equal(result.db.tables.notification_events[0].item_id, 'i0500');
  assert.ok(result.db.calls.some((call) => call.table === 'inventory_items' && call.range?.[0] === 500));
});

test('daily stock reminders get a new UTC date, expiry does not repeat next day', async () => {
  const db = database({ inventory_items: [item({ current_stock: 0 })] });
  const mail = provider();
  await run(db, mail);
  await run(db, mail, { now: () => new Date('2026-09-15T07:00:00Z') });
  assert.equal(mail.accepted.size, 3);
  assert.equal(db.tables.notification_events.filter((row) => row.alert_type === 'expiry').length, 1);
  assert.equal(db.tables.notification_events.filter((row) => row.alert_type === 'low_stock').length, 2);
});

test('operational repair/inspection trigger maintenance; retired stock and stale legacy status do not', async () => {
  const result = await run(database({ inventory_items: [
    item({ id: 'repair', expiration_date: null, operational_status: 'repair' }),
    item({ id: 'inspection', expiration_date: null, operational_status: 'inspection' }),
    item({ id: 'retired', current_stock: 0, maintenance_due_at: '2026-01-01', operational_status: 'retired' }),
    item({ id: 'available', expiration_date: null, status: 'maintenance', operational_status: 'available' })
  ] }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.db.tables.notification_events.map((row) => [row.item_id, row.alert_type]), [['inspection', 'maintenance'], ['repair', 'maintenance']]);
});

test('logistics contacts can receive notifications without editor/admin privileges', async () => {
  const contact = preference('contact', 'reader', 'hq1');
  contact.profiles.is_logistics_contact = true;
  const result = await run(database({ notification_preferences: [contact], inventory_items: [item(), item({ id: 'other', headquarters_id: 'hq2' })] }));
  assert.equal(result.body.acceptedEmails, 1);
  assert.equal(result.db.tables.notification_events[0].item_id, 'i1');
});

test('single-object box embedding resolves its location instead of silently ignoring it', async () => {
  const result = await run(database({ inventory_items: [item({ inventory_container_items: {
    inventory_containers: { name: 'Caja unica', headquarters_id: 'hq1', location_id: 'room' }
  } })], locations: [{ id: 'room', name: 'Almacen', headquarters_id: 'hq1', parent_location_id: null }] }));
  assert.equal(result.status, 200);
  assert.ok(JSON.parse(result.mail.requests[0].body).html.includes('Almacen &gt; Caja: Caja unica'));
});

test('non-contact readers/editors never receive emails; admin does not need the contact flag', async () => {
  const admin = preference('admin', 'admin', null);
  admin.profiles.is_logistics_contact = false;
  const ordinaryReader = preference('ordinary-reader');
  ordinaryReader.profiles.is_logistics_contact = false;
  const ordinaryEditor = preference('ordinary-editor', 'editor');
  ordinaryEditor.profiles.is_logistics_contact = false;
  const missingFlag = preference('missing-flag');
  delete missingFlag.profiles.is_logistics_contact;
  const result = await run(database({ notification_preferences: [admin, ordinaryReader, ordinaryEditor, missingFlag] }));
  assert.equal(result.status, 200);
  assert.equal(result.body.skippedRecipients, 3);
  assert.deepEqual(result.db.tables.notification_events.map((row) => row.profile_id), ['admin']);
  assert.ok(result.db.calls.find((call) => call.table === 'notification_preferences').select.includes('is_logistics_contact'));
});

test('contacts without email or disabled preferences are never implicitly subscribed', async () => {
  const noEmail = { ...preference('no-email'), notification_email: '' };
  const disabled = { ...preference('disabled-contact'), email_notifications_enabled: false };
  const result = await run(database({ notification_preferences: [noEmail, disabled] }));
  assert.equal(result.status, 500);
  assert.equal(result.body.failures[0].stage, 'recipient_configuration');
  assert.equal(result.mail.requests.length, 0);
  assert.equal(result.db.tables.notification_events.length, 0);
  assert.ok(result.db.calls.every((call) => call.table !== 'notification_preferences' || call.operation === 'read'));
  assert.equal(result.db.tables.notification_preferences.length, 2);
  assert.equal(result.db.tables.notification_preferences[0].notification_email, '');
  const absent = await run(database({ notification_preferences: [] }));
  assert.equal(absent.status, 200);
  assert.equal(absent.db.tables.notification_preferences.length, 0);
  assert.equal(absent.mail.requests.length, 0);
});

test('distributed lots notify each due date with only its quantities and locations; exhausted lots are ignored', async () => {
  const position = (id, code, date, quantity, box, location=null) => ({
    id, item_id:'i1', quantity, location_id:location,
    inventory_containers: box ? { name:box, headquarters_id:'hq1', location_id:'room' } : null,
    inventory_stock_lots:{ code, expiration_date:date }
  });
  const db = database({ inventory_items:[item({ expiration_date:'2026-09-15',current_stock:30,minimum_stock:null })],
    locations:[{ id:'room',name:'Almacen',headquarters_id:'hq1',parent_location_id:null }],
    inventory_stock_positions:[
      position('s1','Lote-A','2026-09-15',8,'Intervencion'),
      position('s2','Lote-A','2026-09-15',4,'Practicas'),
      position('s3','Lote-B','2026-09-20',18,null,'room'),
      position('s4','AGOTADO','2026-09-01',0,'Vacia'),
      position('s5','FUTURO','2028-09-01',2,'Reserva')
    ] });
  const result = await run(db);
  assert.equal(result.status,200);
  assert.equal(result.mail.requests.length,2);
  const first = JSON.parse(result.mail.requests[0].body).html;
  const second = JSON.parse(result.mail.requests[1].body).html;
  assert.match(first,/Intervencion/); assert.match(first,/Practicas/); assert.match(first,/Lote-A/);
  assert.doesNotMatch(first,/Lote-B|AGOTADO|FUTURO/);
  assert.match(second,/Lote-B/); assert.match(second,/18/); assert.doesNotMatch(second,/Lote-A/);
  assert.equal((await run(db,result.mail)).mail.requests.length,2);
});

test('distributed location failures and unreadable stock prevent unsafe or incomplete notifications', async () => {
  const wrong = await run(database({inventory_stock_positions:[{
    id:'s1',item_id:'i1',quantity:1,location_id:null,inventory_stock_lots:{code:'A',expiration_date:'2026-09-15'},
    inventory_containers:{name:'Otra sede',headquarters_id:'hq2',location_id:null}
  }]}));
  assert.equal(wrong.status,500); assert.equal(wrong.mail.requests.length,0);
  const unavailable = await run(database({}, {'inventory_stock_positions:read':{code:'42P01'}}));
  assert.equal(unavailable.status,500); assert.equal(unavailable.mail.requests.length,0);
  assert.equal(unavailable.body.failures[0].stage,'stock_positions_read');
});
