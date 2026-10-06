const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('size catalogue: upgrade preserves inventory and groups before search/pagination with RLS', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role authenticated; create role anon;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated,anon;
    alter default privileges in schema public grant execute on functions to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync('supabase/install.sql','utf8').replace('create extension if not exists "pgcrypto";','')
    .replace("if not exists(select 1 from iae_internal.migrations where version='202610060003_size_catalog.sql') then", 'if false then'));
  const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  const [site, foreign] = (await db.query('select id from headquarters order by name limit 2')).rows.map(row => row.id);
  const admin=randomUUID(), reader=randomUUID(), volunteer=randomUUID();
  for (const [id,role] of [[admin,'admin'],[reader,'reader'],[volunteer,'volunteer']]) {
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.invalid']);
    await db.query('update profiles set role_id=(select id from app_roles where code=$2),headquarters_id=$3 where id=$1',[id,role,site]);
  }
  const as = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); };
  await as(admin);
  const rows = [
    {section:'first',garment:'MONO',size:'M',quantity:10,source:'A1'},
    {section:'first',garment:'MONO',size:'L',quantity:0,source:'A2'},
    {section:'second',garment:'MONO',size:'M',quantity:3,source:'A3'}
  ];
  const importRows = async (hq, input=rows) => {
    const draft=await scalar("insert into uniformity_import_drafts(filename,file_hash,rows) values('stock.csv',$1,$2) returning id",['a'.repeat(64),JSON.stringify(input)]);
    return scalar('select import_uniformity_stock($1,$2)',[draft,hq]);
  };
  await importRows(site); await importRows(foreign);
  await db.exec('reset role');
  const snapshot = async () => {
    const result = {};
    for (const table of ['inventory_items','inventory_stock_lots','inventory_stock_positions','inventory_movements','inventory_item_history','uniformity_import_lines']) {
      result[table]=(await db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows;
    }
    return result;
  };
  const before=await snapshot();
  await db.exec(fs.readFileSync('supabase/upgrade-size-catalog.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/upgrade-size-catalog.sql','utf8'));
  assert.deepEqual(await snapshot(), before);

  await t.test('legacy variants become one garment per site and equipment category; zero remains, absent sizes stay absent', async () => {
    await as(admin);
    const products=(await db.query('select * from inventory_catalog_items order by name')).rows;
    assert.equal(products.length,4);
    assert.equal(products.reduce((total,row)=>total+Number(row.current_stock),0),26);
    const mono=products.find(row=>row.headquarters_id===site && row.category==='uniformidad_primera');
    assert.equal(mono.name,'MONO'); assert.equal(Number(mono.current_stock),10); assert.equal(mono.size_count,2);
    assert.deepEqual(mono.variants.map(v=>v.size).sort(),['L','M']);
    assert.equal(mono.variants.find(v=>v.size==='L').quantity,0);
    for (const variant of mono.variants) {
      assert.equal(await scalar('select id from inventory_catalog_items where item_ids @> array[$1::uuid]',[variant.id]),mono.id);
      assert.equal(await scalar('select quantity from uniformity_import_lines where item_id=$1',[variant.id]),variant.quantity);
    }
  });
  await t.test('new imports are grouped without rerunning migrations; other articles with the same name stay independent', async () => {
    await importRows(site,[{section:'first',garment:'POLO',size:'S',quantity:8,source:'A4'}]);
    await db.exec('reset role');
    await db.query(`insert into inventory_items(name,slug,category,headquarters_id,technical_specs)
      values('MONO','unrelated-one','material',$1,'{"uniformidad_talla":"M"}'),
            ('MONO','unrelated-two','material',$1,'{"uniformidad_talla":"L"}')`,[site]);
    await as(admin);
    assert.equal(await scalar("select count(*)::int from inventory_catalog_items where name='MONO' and not is_size_group"),2);
    assert.equal(await scalar("select count(*)::int from inventory_catalog_items where name='POLO' and is_size_group"),1);
    const filtered=(await db.query("select * from inventory_catalog_items where search_text ilike '%MONO · M%' and headquarters_id=$1 order by id limit 1 offset 1",[site])).rows;
    assert.equal(filtered.length,1); assert.equal(filtered[0].name,'MONO');
    assert.equal(await scalar("select count(*)::int from inventory_catalog_items where search_text ilike '%MONO · M%' and headquarters_id=$1",[site]),2);
  });
  await t.test('a mixed garment retains a warning and filters for every constituent operational state', async () => {
    await db.exec('reset role');
    await db.query("update inventory_items set operational_status='repair',minimum_stock=12,status='low' where name='MONO · M' and headquarters_id=$1 and category='uniformidad_primera'",[site]);
    await as(admin);
    const product=(await db.query("select * from inventory_catalog_items where headquarters_id=$1 and category='uniformidad_primera' and name='MONO'",[site])).rows[0];
    assert.equal(product.status,'low'); assert.equal(product.operational_status,'mixed');
    assert.deepEqual(product.operational_statuses.sort(),['available','repair']);
    assert.equal(await scalar("select count(*)::int from inventory_catalog_items where headquarters_id=$1 and operational_statuses @> array['repair']",[site]),1);
  });
  await t.test('catalogue cannot expose another site or volunteer stock, permit anonymous reads, or modify quantities', async () => {
    await as(reader);
    const products=(await db.query('select * from inventory_catalog_items')).rows;
    assert.ok(products.length>0); assert.ok(products.every(p=>p.headquarters_id===site));
    await assert.rejects(db.query('update inventory_catalog_items set current_stock=0'),/permission denied|cannot update view/);
    await as(volunteer); assert.equal(await scalar('select count(*)::int from inventory_catalog_items'),0);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from inventory_catalog_items'),/permission denied/);
    await db.exec('reset role');
    await db.query('update profiles set is_active=false where id=$1',[reader]);
    await as(reader); assert.equal(await scalar('select count(*)::int from inventory_catalog_items'),0);
  });
});
