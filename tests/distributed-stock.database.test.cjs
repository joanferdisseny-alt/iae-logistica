const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('distributed stock migration, quantities, lots, permissions and checklists', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role authenticated; create role anon; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated,anon;
    alter default privileges in schema public grant execute on functions to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists "pgcrypto";',''));
  const files = fs.readdirSync('supabase/migrations').filter(f => /^202609/.test(f)).sort();
  for (const file of files.filter(f => f < '202609160001_distributed_stock.sql')) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  const ids = Array.from({ length:4 },(_,i) => `00000000-0000-4000-8000-00000000000${i+1}`);
  const [admin,editor,reader,foreign] = ids;
  for (const id of ids) await db.query("insert into auth.users values($1,$2,'{}')", [id,id+'@test.invalid']);
  const sites = (await db.query('select id from headquarters order by slug limit 2')).rows.map(r => r.id);
  const [site,otherSite] = sites;
  await db.query('update profiles set headquarters_id=$1',[site]);
  await db.query("update profiles set role_id=(select id from app_roles where code='admin') where id=$1",[admin]);
  await db.query("update profiles set role_id=(select id from app_roles where code='editor') where id=$1",[editor]);
  await db.query('update profiles set headquarters_id=$1 where id=$2',[otherSite,foreign]);
  const location = (await db.query("insert into locations(name,headquarters_id) values('Armario',$1) returning id",[site])).rows[0].id;
  const box = (await db.query("insert into inventory_containers(name,headquarters_id,location_id) values('Intervencion',$1,$2) returning id",[site,location])).rows[0].id;
  const box2 = (await db.query("insert into inventory_containers(name,headquarters_id) values('Practicas',$1) returning id",[site])).rows[0].id;
  const foreignBox = (await db.query("insert into inventory_containers(name,headquarters_id) values('Ajena',$1) returning id",[otherSite])).rows[0].id;
  const item = (await db.query("insert into inventory_items(name,slug,category,headquarters_id,current_stock,expiration_date,lot_code) values('Brocas','brocas-dist','consumable',$1,30,'2027-01-01','A') returning id",[site])).rows[0].id;
  await db.query('insert into inventory_container_items(container_id,item_id,quantity) values($1,$2,30)',[box,item]);
  await db.exec(fs.readFileSync('supabase/migrations/202609160001_distributed_stock.sql','utf8'));
  await db.exec('grant usage on schema public to authenticated,anon');
  const as = async (id, role='authenticated') => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id ?? '']); await db.exec(`set role ${role}`); };
  const total = async () => Number((await db.query('select current_stock from inventory_items where id=$1',[item])).rows[0].current_stock);
  const positions = async () => (await db.query('select * from inventory_stock_positions where item_id=$1 order by id',[item])).rows;
  const lot = (await db.query('select id from inventory_stock_lots where item_id=$1',[item])).rows[0].id;
  let source = (await positions())[0].id;
  let seq=1;
  const uuid = () => `10000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;
  const move = (v={}) => db.query('select manage_inventory_stock($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as balance',
    [v.request ?? uuid(),v.item ?? item,v.action ?? 'transfer',v.source ?? source,v.lot ?? lot,v.location ?? null,v.box ?? null,v.quantity ?? 1,v.notes ?? 'Movimiento test',v.code ?? null,v.expiry ?? null,v.expected ?? null]);
  await t.test('migration preserves total, legacy box and lot/expiry without duplicating stock', async () => {
    const rows = await positions(); assert.equal(rows.length,1); assert.equal(Number(rows[0].quantity),30);
    assert.equal(rows[0].container_id,box); assert.equal(await total(),30);
    const saved = (await db.query('select * from inventory_stock_lots where id=$1',[lot])).rows[0];
    assert.equal(saved.code,'A'); assert.equal(saved.expiration_date.toISOString().slice(0,10),'2027-01-01');
  });
  await t.test('one article can occupy two boxes and a direct location; retries never duplicate transfers', async () => {
    await as(admin);
    const request=uuid(); const values={request,box:box2,quantity:4};
    await move(values); await move(values);
    await move({location,quantity:18});
    assert.equal(await total(),30);
    const rows=await positions();
    assert.equal(Number(rows.find(p=>p.container_id===box).quantity),8);
    assert.equal(Number(rows.find(p=>p.container_id===box2).quantity),4);
    assert.equal(Number(rows.find(p=>p.location_id===location).quantity),18);
    assert.equal((await db.query('select * from inventory_container_items where item_id=$1',[item])).rows.length,2);
    assert.equal((await db.query('select location_id from inventory_items where id=$1',[item])).rows[0].location_id,null);
    await assert.rejects(move({...values,quantity:5}),/reutilizado/);
    await assert.rejects(db.query("select place_inventory_item($1,'container',null,$2,30,null)",[item,box]),/Existencias/);
    await assert.rejects(db.query("select record_inventory_movement($1,'out',1,'Consumo',gen_random_uuid())",[item]),/ubicacion concreta/);
  });
  await t.test('out/adjustment affect only their source; insufficient, cross-site and invalid moves roll back', async () => {
    await move({action:'out',quantity:2}); assert.equal(await total(),28);
    await move({action:'adjustment',quantity:5}); assert.equal(await total(),27);
    for (const values of [{quantity:6,box:box2},{box:foreignBox},{location,box:box2},{quantity:'1.0001',box:box2},{quantity:-1,box:box2},{quantity:'NaN',box:box2},{box}]) await assert.rejects(move(values));
    assert.equal(await total(),27);
    const rows=await positions(); assert.equal(Number(rows.find(p=>p.location_id===location).quantity),18);
    const request=uuid();
    await Promise.all([move({request,box:box2,quantity:1}),move({request,box:box2,quantity:1})]);
    assert.equal(Number((await positions()).find(p=>p.container_id===box).quantity),4);
    await assert.rejects(move({action:'adjustment',quantity:100,expected:5}),/ha cambiado/);
    const withdrawals=await Promise.allSettled([move({action:'out',quantity:3}),move({action:'out',quantity:3})]);
    assert.equal(withdrawals.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(withdrawals.filter(r=>r.status==='rejected').length,1);
    await move({action:'in',box,quantity:3});
  });
  let lot2;
  await t.test('different lots keep quantities and expiry; checklist snapshots only this box and each lot', async () => {
    await move({action:'new_lot',code:'B',expiry:'2026-10-01',box,quantity:3});
    lot2=(await db.query("select id from inventory_stock_lots where item_id=$1 and code='B'",[item])).rows[0].id;
    assert.equal(await total(),30);
    assert.equal((await db.query('select expiration_date::text from inventory_items where id=$1',[item])).rows[0].expiration_date,'2026-10-01');
    const checklist=uuid();
    await db.query("select create_container_checklist($1,$2,'practice','Practicas','2026-09-15','Equipo')",[checklist,box]);
    const lines=(await db.query('select * from container_checklist_items where checklist_id=$1 order by lot_code',[checklist])).rows;
    assert.deepEqual(lines.map(l=>[l.lot_code,Number(l.expected_quantity)]),[['A',4],['B',3]]);
    const lotSource=(await positions()).find(p=>p.lot_id===lot2).id;
    await move({action:'out',source:lotSource,quantity:3});
    assert.equal((await db.query('select expiration_date::text from inventory_items where id=$1',[item])).rows[0].expiration_date,'2027-01-01');
    assert.equal(Number((await db.query('select expected_quantity from container_checklist_items where id=$1',[lines[1].id])).rows[0].expected_quantity),3);
    await move({action:'edit_lot',lot:lot2,code:'B-corrected',expiry:'2028-01-01',quantity:0});
    assert.equal((await db.query('select lot_code from container_checklist_items where id=$1',[lines[1].id])).rows[0].lot_code,'B');
  });
  await t.test('RLS and RPC permissions prevent cross-site reads, reader/editor writes and bypassing totals', async () => {
    for (const actor of [editor,reader]) {
      await as(actor); assert.ok((await positions()).length);
      await assert.rejects(move(),/administracion/);
      for (const table of ['inventory_stock_positions','inventory_stock_lots','inventory_items','inventory_container_items'])
        await assert.rejects(db.exec(`delete from ${table}`),/permission denied/);
    }
    await as(foreign); assert.equal((await positions()).length,0);
    assert.equal((await db.query('select * from inventory_stock_lots')).rows.length,0);
    await as(null,'anon'); await assert.rejects(move(),/permission denied/);
    await as(admin); await assert.rejects(db.query('select sync_inventory_stock($1)',[item]),/permission denied/);
    await assert.rejects(db.exec('update inventory_items set current_stock=100'),/permission denied/);
  });
  await t.test('new editor receipts initialize stock atomically; serial-number tools cannot split or multiply', async () => {
    await db.exec('reset role');
    const template=(await db.query("insert into inventory_templates(code,name,category_code) values('stock-test','Test','tool') returning id")).rows[0].id;
    await as(editor);
    const record={name:'Taladro serie',slug:'serial-dist',template_id:template,headquarters_id:site,current_stock:1,serial_number:'S-1'};
    const serial=(await db.query('select create_inventory_record($1::jsonb,$2) as id',[JSON.stringify(record),box2])).rows[0].id;
    await as(admin);
    const s=(await db.query('select * from inventory_stock_positions where item_id=$1',[serial])).rows[0];
    await assert.rejects(move({item:serial,source:s.id,lot:s.lot_id,quantity:0.5,box}),/dividir/);
    await assert.rejects(move({action:'in',item:serial,lot:s.lot_id,quantity:1,box:box2}),/serie/);
    await move({item:serial,source:s.id,lot:s.lot_id,quantity:1,box});
    assert.equal(Number((await db.query('select current_stock from inventory_items where id=$1',[serial])).rows[0].current_stock),1);
    await assert.rejects(db.query('select create_inventory_record($1::jsonb)',[JSON.stringify({...record,slug:'invalid',current_stock:1.0001})]),/Cantidad/);
  });
});
