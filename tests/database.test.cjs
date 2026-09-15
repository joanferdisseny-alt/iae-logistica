const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('RLS, atomic placement, stock movements and account revocation', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  const schema = fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists "pgcrypto";','');
  await db.exec(schema);
  await db.exec("insert into inventory_items(name,slug,category,status) values('Legacy maintenance','legacy-maintenance','tool','maintenance')");
  await db.exec(fs.readFileSync('supabase/migrations/202609140001_security_and_operations.sql','utf8'));
  await t.test('upgrade preserves legacy maintenance as inspection', async () => {
    assert.equal((await db.query("select operational_status from inventory_items where slug='legacy-maintenance'")).rows[0].operational_status,'inspection');
  });
  await db.exec("delete from inventory_items where slug='legacy-maintenance'");
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;`);
  await db.exec(fs.readFileSync('supabase/migrations/202609140003_documents_and_validation.sql','utf8'));
  await db.exec(`grant usage on schema public to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;`);
  const admin='11111111-1111-4111-8111-111111111111';
  const editor='22222222-2222-4222-8222-222222222222';
  const reader='33333333-3333-4333-8333-333333333333';
  const noSite='44444444-4444-4444-8444-444444444444';
  for (const id of [admin,editor,reader,noSite]) await db.query('insert into auth.users values($1,$2,$3)',[id,id+'@example.invalid',{}]);
  const sites=(await db.query('select id,slug from headquarters')).rows;
  const val=sites.find(h=>h.slug==='valencia').id;
  const mel=sites.find(h=>h.slug==='melilla').id;
  await db.query("update profiles set role_id=(select id from app_roles where code='admin') where id=$1",[admin]);
  await db.query("update profiles set role_id=(select id from app_roles where code='editor'),headquarters_id=$2 where id=$1",[editor,val]);
  await db.query('update profiles set headquarters_id=$2 where id=$1',[reader,mel]);
  const item=(await db.query("insert into inventory_items(name,slug,category,headquarters_id,current_stock) values('Taladro','drill','tool',$1,5) returning id",[val])).rows[0].id;
  const foreign=(await db.query("insert into inventory_items(name,slug,category,headquarters_id,current_stock) values('Taladro otra sede','drill2','tool',$1,8) returning id",[mel])).rows[0].id;
  const box=(await db.query("insert into inventory_containers(name,headquarters_id) values('Caja A',$1) returning id",[val])).rows[0].id;
  const otherBox=(await db.query("insert into inventory_containers(name,headquarters_id) values('Caja B',$1) returning id",[mel])).rows[0].id;
  async function as(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
  await t.test('profiles can be read without recursive RLS', async()=>{
    await as(editor);
    assert.equal((await db.query('select * from profiles')).rows.length,1);
    assert.deepEqual((await db.query('select id from inventory_items')).rows.map(r=>r.id),[item]);
  });
  await t.test('no site means no inventory, reader sees only own site',async()=>{
    await as(noSite); assert.equal((await db.query('select * from inventory_items')).rows.length,0);
    await as(reader); assert.deepEqual((await db.query('select id from inventory_items')).rows.map(r=>r.id),[foreign]);
  });
  await t.test('editor cannot move own or other site resources',async()=>{
    await as(editor);
    await assert.rejects(db.query("select place_inventory_item($1,'container',null,$2,5,null)",[item,box]),/administradores/);
    assert.equal((await db.query('update inventory_items set current_stock=0 where id=$1 returning id',[foreign])).rows.length,0);
  });
  await t.test('failed destination preserves original assignment',async()=>{
    await as(admin);
    await db.query("select place_inventory_item($1,'container',null,$2,5,null)",[item,box]);
    await assert.rejects(db.query("select place_inventory_item($1,'container',null,$2,5,null)",[item,otherBox]),/sede/);
    assert.equal((await db.query('select container_id from inventory_container_items where item_id=$1',[item])).rows[0].container_id,box);
  });
  await t.test('stock is atomic, decimal and idempotent with negative prevention',async()=>{
    const request='55555555-5555-4555-8555-555555555555';
    await db.query("select record_inventory_movement($1,'out',1.5,'Practicas',$2)",[item,request]);
    await db.query("select record_inventory_movement($1,'out',1.5,'Practicas',$2)",[item,request]);
    assert.equal(Number((await db.query('select current_stock from inventory_items where id=$1',[item])).rows[0].current_stock),3.5);
    assert.equal(Number((await db.query('select quantity from inventory_container_items where item_id=$1',[item])).rows[0].quantity),3.5);
    await assert.rejects(db.query("select record_inventory_movement($1,'out',10,'Practicas',gen_random_uuid())",[item]),/insuficiente/);
    assert.equal((await db.query('select * from inventory_movements')).rows.length,1);
  });
  await t.test('deactivated profile loses read access and last admin protected',async()=>{
    await db.query('update profiles set is_active=false where id=$1',[editor]);
    await as(editor); assert.equal((await db.query('select * from inventory_items')).rows.length,0);
    await as(admin); await assert.rejects(db.query('update profiles set is_active=false where id=$1',[admin]),/ultimo administrador/);
  });
  await t.test('maintenance state is independent of stock and records history',async()=>{
    await db.query("select update_inventory_item($1,'Taladro','Motor averiado','repair',null,null,2,'Revision taller')",[item]);
    const row=(await db.query('select operational_status,current_stock from inventory_items where id=$1',[item])).rows[0];
    assert.equal(row.operational_status,'repair'); assert.equal(Number(row.current_stock),3.5);
    assert.ok((await db.query("select * from inventory_item_history where event_type='update'")).rows.length);
  });
  await t.test('private documents enforce the item site and active user',async()=>{
    await as(admin);
    await db.query("insert into inventory_attachments(item_id,title,storage_path) values($1,'Manual',$2)",[item,item+'/manual.pdf']);
    await db.query("insert into storage.objects(bucket_id,name) values('inventory-documents',$1)",[item+'/manual.pdf']);
    assert.equal((await db.query('select * from storage.objects')).rows.length,1);
    await as(reader); assert.equal((await db.query('select * from storage.objects')).rows.length,0);
    await as(editor); assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  });
});
