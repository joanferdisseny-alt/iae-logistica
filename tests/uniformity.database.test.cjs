const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('uniformity and personal portal: atomic imports, deliveries, returns and isolation', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role authenticated; create role anon;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated,anon;
    alter default privileges in schema public grant execute on functions to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync('supabase/install.sql','utf8').replace('create extension if not exists "pgcrypto";',''));
  const admin=randomUUID(), volunteer=randomUUID(), other=randomUUID(), reader=randomUUID(), editor=randomUUID();
  const sites = (await db.query('select id from headquarters order by name limit 2')).rows;
  assert.equal(sites.length,2);
  const site=sites[0].id, foreign=sites[1].id;
  for (const [id,role,hq] of [[admin,'admin',site],[volunteer,'volunteer',site],[other,'volunteer',foreign],[reader,'reader',site],[editor,'editor',site]]) {
    await db.query("insert into auth.users values($1,$2,'{}')",[id,id+'@example.invalid']);
    await db.query('update profiles set role_id=(select id from app_roles where code=$2),headquarters_id=$3,full_name=$2 where id=$1',[id,role,hq]);
  }
  async function as(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
  const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  const sample = [
    {section:'first',garment:'MONO',size:'M',quantity:10,source:'Hoja1!D3'},
    {section:'first',garment:'MONO',size:'L',quantity:0,source:'Hoja1!E3'},
    {section:'second',garment:'POLO',size:'XL',quantity:5,source:'Hoja1!F16'}
  ];
  const draft = rows => scalar("insert into uniformity_import_drafts(filename,file_hash,rows) values('stock.xlsx',$1,$2) returning id",['a'.repeat(64),JSON.stringify(rows)]);
  const runImport = (id,hq=site,loc=null,box=null) => scalar('select import_uniformity_stock($1,$2,$3,$4)',[id,hq,loc,box]);
  let batch, draftId, mono, zero, position, person, foreignPerson, historical, issued;
  await as(admin);

  await t.test('one atomic import creates hierarchy, garment templates, only existing sizes and exact stock',async()=>{
    draftId=await draft(sample); batch=await runImport(draftId);
    assert.equal(await scalar('select count(*)::int from uniformity_import_lines where import_id=$1',[batch]),3);
    assert.equal(await scalar('select total_quantity from uniformity_imports where id=$1',[batch]),15);
    assert.equal(await scalar("select parent_code from inventory_categories where code='uniformidad_primera'"),'uniformidad');
    assert.equal(await scalar("select count(*)::int from inventory_templates where code like 'uniformidad_%'"),2);
    const items=(await db.query("select id,name,current_stock,template_id from inventory_items where sku like 'UNI-%' order by name")).rows;
    assert.equal(items.length,3);
    mono=items.find(i=>i.name==='MONO · M').id; zero=items.find(i=>i.name==='MONO · L').id;
    assert.equal(await scalar('select current_stock from inventory_items where id=$1',[mono]),'10.000');
    assert.equal(Number(await scalar('select current_stock from inventory_items where id=$1',[zero])),0);
    position=await scalar('select id from inventory_stock_positions where item_id=$1',[mono]);
    assert.deepEqual(await scalar("select allowed_options from inventory_template_fields where template_id=$1 and field_key='uniformidad_talla'",[items.find(i=>i.id===mono).template_id]),['L','M']);
    await assert.rejects(db.query("select create_inventory_record($1::jsonb,null,0,'Prueba de talla')",[JSON.stringify({name:'MONO XS',slug:'invalid-size',template_id:items.find(i=>i.id===mono).template_id,headquarters_id:site,technical_specs:{uniformidad_talla:'XS'},unit:'unidades'})]),/Opcion no disponible/);
  });
  await t.test('same draft or normalized content is idempotent; changed imports rollback rather than replacing stock',async()=>{
    assert.equal(await runImport(draftId),batch);
    const repeat=await draft([...sample].reverse().map(r=>({...r,source:'CSV!A2'})));
    assert.equal(await runImport(repeat),batch);
    await assert.rejects(runImport(draftId,foreign),/otra sede/);
    const bad=await draft([{section:'first',garment:'NEW',size:'M',quantity:99,source:'A1'}, {...sample[0],quantity:12}]);
    await assert.rejects(runImport(bad),/Ya existe/);
    assert.equal(await scalar("select count(*)::int from inventory_items where name like 'NEW%'"),0);
    assert.equal(await scalar('select count(*)::int from uniformity_imports'),1);
    assert.equal(Number(await scalar('select current_stock from inventory_items where id=$1',[mono])),10);
    const malformed=await draft([{...sample[0],quantity:-2}]); await assert.rejects(runImport(malformed),/Filas/);
    const duplicate=await draft([sample[0],sample[0]]); await assert.rejects(runImport(duplicate),/duplicadas/);
    const otherBatch=await runImport(await draft(sample),foreign);
    assert.notEqual(otherBatch,batch);
  });
  await t.test('non-admins cannot import or link accounts; mismatched headquarters cannot be linked',async()=>{
    await assert.rejects(db.query('select save_volunteer(null,$1,$2,null,$3,$4)',['V001','Persona',site,other]),/no pertenece/);
    person=await scalar('select save_volunteer(null,$1,$2,null,$3,$4)',['V001','Persona',site,volunteer]);
    foreignPerson=await scalar('select save_volunteer(null,$1,$2,null,$3,$4)',['V002','Persona dos',foreign,other]);
    for (const id of [volunteer,reader,editor]) {
      await as(id); await assert.rejects(runImport(draftId),/Solo administracion/);
      await assert.rejects(db.query('select save_volunteer(null,$1,$2,null,$3,null)',['V003','Persona',site]),/Solo administracion/);
      await assert.rejects(draft(sample),/row-level security/);
    }
    await as(admin);
  });
  const deliver = (id,qty,history,src,owner=person,item=mono) => scalar('select record_volunteer_delivery($1,$2,$3,$4,$5,$6,$7,$8)',[id,owner,item,qty,history,history?null:'2026-01-01',src,'Entrega documentada']);
  const giveBack = (id,delivery,qty,dest=position) => scalar('select return_volunteer_delivery($1,$2,$3,$4,$5)',[id,delivery,qty,dest,'Revisado y reutilizable']);
  await t.test('historical deliveries never change available stock; new issues are atomic and retry-safe',async()=>{
    historical=randomUUID(); await deliver(historical,3,true,null); await deliver(historical,3,true,null);
    assert.equal(Number(await scalar('select current_stock from inventory_items where id=$1',[mono])),10);
    issued=randomUUID(); await deliver(issued,2,false,position); await deliver(issued,2,false,position);
    assert.equal(Number(await scalar('select current_stock from inventory_items where id=$1',[mono])),8);
    await assert.rejects(deliver(issued,4,false,position),/reutilizado/);
    await assert.rejects(deliver(randomUUID(),20,false,position));
    await assert.rejects(deliver(randomUUID(),1,true,null,foreignPerson),/sede/);
    assert.equal(await scalar('select count(*)::int from volunteer_deliveries'),2);
    assert.equal(Number(await scalar('select current_stock from inventory_items where id=$1',[mono])),8);
  });
  await t.test('returns add to the selected stock exactly once and cannot exceed outstanding clothing',async()=>{
    const id=randomUUID(); await giveBack(id,issued,1); await giveBack(id,issued,1);
    assert.equal(Number(await scalar('select current_stock from inventory_items where id=$1',[mono])),9);
    assert.equal(await scalar('select returned_quantity from volunteer_deliveries where id=$1',[issued]),1);
    await assert.rejects(giveBack(randomUUID(),issued,2),/superior/);
    const wrong=await scalar('select id from inventory_stock_positions where item_id=$1',[zero]);
    await assert.rejects(giveBack(randomUUID(),issued,1,wrong),/mismo articulo/);
    assert.equal(await scalar('select count(*)::int from volunteer_returns'),1);
  });
  await t.test('personal role only reads own profile/deliveries, not stock, other people or operational data',async()=>{
    await db.query('update profiles set is_logistics_contact=true where id=$1',[volunteer]);
    await as(volunteer);
    assert.equal(await scalar('select user_role()'),null); assert.equal(await scalar('select user_headquarters_id()'),null);
    assert.equal(await scalar('select portal_headquarters_id()'),site);
    assert.equal(await scalar('select is_logistics_contact from profiles where id=$1',[volunteer]),false);
    assert.deepEqual((await db.query('select id from volunteers')).rows.map(r=>r.id),[person]);
    assert.equal(await scalar('select count(*)::int from volunteer_deliveries'),2);
    for (const table of ['inventory_items','inventory_stock_positions','inventory_containers','locations','uniformity_imports']) assert.equal(await scalar(`select count(*)::int from ${table}`),0,table);
    assert.equal(await scalar('select count(*)::int from headquarters'),1);
    await assert.rejects(deliver(randomUUID(),1,true,null),/Solo administracion/);
    await assert.rejects(giveBack(randomUUID(),issued,1),/Solo administracion/);
    await assert.rejects(db.query('update volunteer_deliveries set quantity=100 where id=$1',[issued]),/permission denied/);
    await as(other); assert.equal(await scalar('select count(*)::int from volunteer_deliveries'),0);
    await as(reader); assert.ok(await scalar('select count(*)::int from inventory_items')>0); assert.equal(await scalar('select count(*)::int from volunteers'),1);
    assert.equal(await scalar('select profile_id from volunteers'),reader);
  });
  await t.test('volunteer can request material in own site and cancel own request, never manage others or reference hidden stock',async()=>{
    await as(volunteer);
    const request=await scalar("insert into logistics_requests(headquarters_id,material,quantity) values($1,'Polo talla M',1) returning id",[site]);
    assert.equal(await scalar('select count(*)::int from logistics_request_history where request_id=$1',[request]),1);
    await assert.rejects(db.query("insert into logistics_requests(headquarters_id,material,quantity) values($1,'Polo',1)",[foreign]),/row-level security/);
    await assert.rejects(db.query("insert into logistics_requests(headquarters_id,material,quantity,item_id) values($1,'Polo',1,$2)",[site,mono]),/Articulo no disponible/);
    await assert.rejects(db.query("update logistics_requests set status='accepted' where id=$1",[request]),/row-level security/);
    await db.query("update logistics_requests set status='cancelled' where id=$1",[request]);
    await as(other); assert.equal(await scalar('select count(*)::int from logistics_requests'),0);
    await as(admin); assert.equal(await scalar('select count(*)::int from logistics_requests'),1);
    await db.query('update profiles set is_active=false where id=$1',[volunteer]);
    await as(volunteer); assert.equal(await scalar('select count(*)::int from volunteers'),0);
    assert.equal(await scalar('select count(*)::int from volunteer_deliveries'),0);
    assert.equal(await scalar('select count(*)::int from logistics_requests'),0);
  });
  await t.test('anonymous execution and direct writes remain forbidden',async()=>{
    await db.exec('reset role');
    for (const fn of ['import_uniformity_stock(uuid,uuid,uuid,uuid)','save_volunteer(uuid,text,text,text,uuid,uuid)','record_volunteer_delivery(uuid,uuid,uuid,integer,boolean,date,uuid,text)','return_volunteer_delivery(uuid,uuid,integer,uuid,text)']) {
      assert.equal(await scalar("select has_function_privilege('anon',$1,'execute')",[fn]),false);
    }
    for (const table of ['volunteers','volunteer_deliveries','volunteer_returns','uniformity_imports']) assert.equal(await scalar("select has_table_privilege('authenticated',$1,'insert')",[table]),false);
  });
  if (process.env.UNIFORMITY_XLSX) await t.test('provided warehouse workbook imports completely in an isolated database',async()=>{
    const ts=require('typescript'), mod={exports:{}};
    new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/uniformity/import.ts','utf8'), {
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
    }).outputText)(require,mod,mod.exports);
    const preview=await mod.exports.readUniformityFile(fs.readFileSync(process.env.UNIFORMITY_XLSX),'stock.xlsx');
    assert.equal(preview.rows.length,54); assert.equal(preview.garments,14); assert.equal(preview.total,558); assert.equal(preview.omitted,44);
    await as(admin);
    const hq=await scalar("insert into headquarters(name,slug) values('Workbook test','workbook-test') returning id");
    const id=await runImport(await draft(preview.rows),hq);
    assert.equal(await scalar('select total_quantity from uniformity_imports where id=$1',[id]),558);
    assert.equal(await scalar('select count(*)::int from inventory_items where headquarters_id=$1',[hq]),54);
    assert.equal(await scalar('select count(distinct template_id)::int from inventory_items where headquarters_id=$1',[hq]),14);
    assert.equal(Number(await scalar('select sum(current_stock) from inventory_items where headquarters_id=$1',[hq])),558);
    assert.equal(await scalar("select count(*)::int from inventory_items where headquarters_id=$1 and name='CHALECO TERMICO · L' and current_stock=0",[hq]),1);
    assert.equal(await scalar("select count(*)::int from inventory_items where headquarters_id=$1 and name='MONO INTERVENCIÓN · XXL'",[hq]),0);
  });
});
