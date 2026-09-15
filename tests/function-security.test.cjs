const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const sql = path => fs.readFileSync(path, 'utf8');

test('function hardening removes explicit Supabase ACL grants without breaking RPCs or triggers', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role; create role auth_backend;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,auth_backend;
    grant execute on function auth.uid() to authenticated,anon;
    grant insert on auth.users to auth_backend;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;`);
  await db.exec(sql('supabase/schema.sql').replace('create extension if not exists "pgcrypto";', ''));
  for (const file of ['202609140001_security_and_operations.sql','202609140002_logistics_requests.sql','202609140003_documents_and_validation.sql']) {
    await db.exec(sql(`supabase/migrations/${file}`));
  }
  await db.exec('grant usage on schema public to authenticated,anon; grant select,insert,update,delete on public.inventory_items,public.inventory_fields,public.profiles to authenticated;');
  assert.equal((await db.query("select has_function_privilege('anon','public.user_role()','execute') as allowed")).rows[0].allowed,true);
  await db.exec(sql('supabase/fix-security-warnings-2026-09-15.sql'));
  await db.exec(sql('supabase/fix-security-warnings-2026-09-15.sql'));
  const functions = (await db.query(`select p.proname, p.prorettype='trigger'::regtype as trigger,
    has_function_privilege('anon',p.oid,'execute') as anonymous,
    has_function_privilege('authenticated',p.oid,'execute') as signed_in,
    p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows;
  const allowed = ['can_manage_logistics_requests','create_inventory_record','place_inventory_item','record_inventory_movement','update_catalog_field','update_inventory_item','user_headquarters_id','user_role'];
  await t.test('anonymous has no execution rights; signed-in rights are an explicit allowlist', async () => {
    assert.ok(functions.every(f => !f.anonymous));
    assert.ok(functions.filter(f => f.trigger).every(f => !f.signed_in));
    assert.deepEqual(functions.filter(f => f.signed_in).map(f => f.proname).sort(),allowed);
    for (const name of ['set_updated_at','protect_field_key']) assert.ok(functions.find(f => f.proname===name).proconfig.some(c => c.startsWith('search_path=')));
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.user_role()'), /permission denied/);
    await assert.rejects(db.query("select public.create_inventory_record('{}'::jsonb)"), /permission denied/);
    await db.exec('reset role');
  });
  const admin='11111111-1111-4111-8111-111111111111';
  const editor='22222222-2222-4222-8222-222222222222';
  const reader='33333333-3333-4333-8333-333333333333';
  await t.test('Auth backend still creates profiles through the private trigger', async () => {
    await db.exec('set role auth_backend');
    for (const id of [admin,editor,reader]) await db.query("insert into auth.users values($1,$2,'{}')", [id,`${id}@example.invalid`]);
    await db.exec('reset role');
    assert.equal((await db.query('select * from profiles')).rows.length,3);
  });
  const site=(await db.query('select id from headquarters order by slug limit 1')).rows[0].id;
  await db.query('update profiles set headquarters_id=$1',[site]);
  await db.query("update profiles set role_id=(select id from app_roles where code='admin') where id=$1",[admin]);
  await db.query("update profiles set role_id=(select id from app_roles where code='editor') where id=$1",[editor]);
  const template=(await db.query("insert into inventory_templates(code,name,category_code) values('security_test','Security test','tool') returning id")).rows[0].id;
  const field=(await db.query("insert into inventory_fields(field_key,label,field_type) values('security_test','Test','text') returning id")).rows[0].id;
  async function as(id) {
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated');
  }
  let item;
  await t.test('editor creation and administrator operations still work, reader mutations do not', async () => {
    await as(editor);
    assert.equal((await db.query('select public.user_role() as role')).rows[0].role,'editor');
    const record={name:'Taladro',slug:'test-drill',template_id:template,headquarters_id:site,current_stock:4,unit:'uds'};
    item=(await db.query('select public.create_inventory_record($1::jsonb) as id',[JSON.stringify(record)])).rows[0].id;
    await assert.rejects(db.query("select public.record_inventory_movement($1,'out',1,'Test',gen_random_uuid())",[item]),/administradores/);
    await as(reader);
    await assert.rejects(db.query('select public.create_inventory_record($1::jsonb)',[JSON.stringify(record)]),/permiso/);
    await assert.rejects(db.query("select public.update_catalog_field($1,'test','Test','text','[]'::jsonb)",[field]),/permiso/);
    await as(admin);
    assert.equal(Number((await db.query("select public.record_inventory_movement($1,'out',1,'Test',gen_random_uuid()) as balance",[item])).rows[0].balance),3);
    await db.query("select public.place_inventory_item($1,'none')",[item]);
    await db.query("select public.update_inventory_item($1,'Taladro editado',null,'repair',null,null,1,'Revision')",[item]);
    await db.query("select public.update_catalog_field($1,'security_test','Etiqueta nueva','text','[]'::jsonb)",[field]);
    assert.equal((await db.query('select operational_status from inventory_items where id=$1',[item])).rows[0].operational_status,'repair');
    await assert.rejects(db.query('update profiles set is_active=false where id=$1',[admin]),/ultimo administrador/);
  });
  await t.test('later article migration and the current installer keep new triggers private',async () => {
    await db.exec('reset role');
    await db.exec(sql('supabase/migrations/202609150001_request_articles.sql'));
    const result=(await db.query("select has_function_privilege('anon','public.guard_logistics_request_article()','execute') as anon,has_function_privilege('authenticated','public.guard_logistics_request_article()','execute') as signed_in")).rows[0];
    assert.equal(result.anon,false); assert.equal(result.signed_in,false);
  });
});
