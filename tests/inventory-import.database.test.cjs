const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('general stock import: preview, reuse, receipts, concurrency and permission boundaries', async t => {
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
  const [site, foreign] = (await db.query('select id from headquarters order by name limit 2')).rows.map(r=>r.id);
  const admin=randomUUID(), editor=randomUUID(), reader=randomUUID(), otherAdmin=randomUUID();
  for (const [id,role] of [[admin,'admin'],[editor,'editor'],[reader,'reader'],[otherAdmin,'admin']]) {
    await db.query("insert into auth.users values($1,$2,'{}')",[id,id+'@example.invalid']);
    await db.query('update profiles set role_id=(select id from app_roles where code=$2),headquarters_id=$3 where id=$1',[id,role,site]);
  }
  const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  async function as(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
  const payload = (rows,fields=[]) => ({ fields:[{key:'name',label:'Nombre',type:'text'},{key:'current_stock',label:'Stock',type:'number'},...fields],rows:rows.map(r=>({category:['Material general','Herramientas'],specs:{},quantity:'2',...r})) });
  const preview = (data,ref=randomUUID(),hq=site,loc=null,box=null) => scalar('select preview_inventory_import($1,$2,$3,$4,$5,$6)',[data,hq,loc,box,ref,'stock.csv']);
  const confirm = id => scalar('select confirm_inventory_import($1)',[id]);
  const stock = id => scalar('select current_stock::float from inventory_items where id=$1',[id]);
  const sample=payload([{name:'Broca 8 mm',sku:'BR-8',specs:{marca_import:'Makita'}},{name:'Martillo',sku:'MA-1',quantity:'1'}],[{key:'marca_import',label:'Marca',type:'text'}]);
  let draft,broca,box,loc;
  await as(admin);
  await t.test('preview validates real constraints but leaves catalogue, lots, history and stock untouched',async()=>{
    const count=await scalar('select count(*)::int from inventory_items');
    draft=await preview(sample,'ALBARAN-001');
    assert.equal(draft.plan.lines.length,2); assert.equal(draft.plan.lines[0].action,'create');
    assert.equal(draft.plan.categories.length,2); assert.equal(draft.plan.templates.length,1);
    assert.equal(await scalar('select count(*)::int from inventory_items'),count);
    assert.equal(await scalar("select count(*)::int from inventory_fields where field_key='marca_import'"),0);
    assert.equal(await scalar("select count(*)::int from inventory_categories where name='Material general'"),0);
    assert.equal(await scalar("select count(*)::int from inventory_item_history where event_type='csv_import'"),0);
  });
  await t.test('commit creates hierarchy and fields once, repeating confirmation never adds twice',async()=>{
    assert.deepEqual(await confirm(draft.draftId),draft.plan);
    assert.deepEqual(await confirm(draft.draftId),draft.plan);
    broca=await scalar("select id from inventory_items where sku='BR-8'");
    assert.equal(await stock(broca),2);
    assert.equal(await scalar("select count(*)::int from inventory_fields where field_key='marca_import'"),1);
    await assert.rejects(preview(sample,'albaran-001'),/ya se ha importado/);
  });
  await t.test('existing SKU adds to a different box, preserving old stock positions and metadata',async()=>{
    loc=await scalar("insert into locations(name,code,headquarters_id) values('Almacen','test-almacen',$1) returning id",[site]);
    box=await scalar("insert into inventory_containers(name,code,headquarters_id,location_id) values('Kit rescate','test-kit',$1,$2) returning id",[site,loc]);
    const p=await preview(payload([{sku:'BR-8',category:[],quantity:'3'}]),'ALBARAN-002',site,null,box);
    assert.equal(p.plan.lines[0].action,'add'); assert.equal(p.plan.lines[0].before,2); assert.equal(p.plan.lines[0].after,5);
    await confirm(p.draftId); assert.equal(await stock(broca),5);
    assert.equal(await scalar('select sum(quantity)::float from inventory_stock_positions where item_id=$1 and container_id=$2',[broca,box]),3);
    assert.equal(await scalar('select sum(quantity)::float from inventory_stock_positions where item_id=$1 and container_id is null',[broca]),2);
    assert.equal(await scalar("select technical_specs->>'marca_import' from inventory_items where id=$1",[broca]),'Makita');
  });
  await t.test('name/category/template/specs match is exact; fields or categories alone never identify a product',async()=>{
    const p=await preview(payload([{name:'Broca 8 mm',specs:{marca_import:'Makita'},quantity:'1'}],[{key:'marca_import',label:'Marca',type:'text'}]));
    assert.equal(p.plan.lines[0].item_id,broca); await confirm(p.draftId); assert.equal(await stock(broca),6);
    await assert.rejects(preview(payload([{name:'Broca 8 mm',specs:{}}])),/otras caracteristicas/);
    await assert.rejects(preview(payload([{sku:'BR-8',name:'Otro producto'}])),/nombre no coincide/);
    await assert.rejects(preview(payload([{sku:'BR-8',specs:{marca_import:'Bosch'}}],[{key:'marca_import',label:'Marca',type:'text'}])),/campo marca_import no coincide/);
    const another=await preview(payload([{name:'Broca 10 mm',sku:'BR-10'}]));
    assert.equal(another.plan.lines[0].action,'create'); await confirm(another.draftId);
  });
  await t.test('stale stock or schema cancels the entire confirmation, including earlier new articles',async()=>{
    const stale=await preview(payload([{name:'Nuevo temporal',sku:'TEMP-1'},{sku:'BR-8',quantity:'2'}]));
    const update=await preview(payload([{sku:'BR-8',quantity:'1'}])); await confirm(update.draftId);
    await assert.rejects(confirm(stale.draftId),/han cambiado/);
    assert.equal(await scalar("select count(*)::int from inventory_items where sku='TEMP-1'"),0);
    assert.equal(await stock(broca),7);
    assert.equal(await scalar('select imported_at from inventory_import_drafts where id=$1',[stale.draftId]),null);
  });
  await t.test('duplicate file rows and duplicate receipts from separate drafts cannot double stock',async()=>{
    await assert.rejects(preview(payload([{sku:'BR-8'},{sku:'BR-8'}])),/se repite/);
    await assert.rejects(preview(payload([{name:'Duplicado',sku:'DUP-1'},{name:'Duplicado',sku:'DUP-1'}])),/se repite/);
    const one=await preview(payload([{sku:'BR-8'}]),'SAME-RECEIPT');
    const two=await preview(payload([{sku:'BR-8'}]),'SAME-RECEIPT');
    await confirm(one.draftId); await assert.rejects(confirm(two.draftId),/ya se ha importado/);
    assert.equal(await stock(broca),9);
  });
  await t.test('expiry and serial constraints are validated before any import; failed rows rollback definitions',async()=>{
    const p=await preview(payload([{name:'Pienso',sku:'PI-1',category:['Alimentos'],quantity:'4.5',expiration_date:'2027-04-01',lot_code:'LOTE-1'}],[{key:'expiration_date',label:'Caducidad',type:'date'}]));
    await confirm(p.draftId);
    assert.equal(await scalar("select expiration_date::text from inventory_items where sku='PI-1'"),'2027-04-01');
    await assert.rejects(preview(payload([{sku:'PI-1',category:[],lot_code:'LOTE-1',expiration_date:'2028-04-01'}])),/otra caducidad/);
    await assert.rejects(preview(payload([{name:'Maquina serial',sku:'SER-1',serial_number:'ABC123',quantity:'2'}])),/serial|serie/i);
    await assert.rejects(preview(payload([{name:'Negativo',quantity:'-1'}])),/cantidad/);
    await assert.rejects(preview(payload([{name:'Fecha mala',expiration_date:'2027-02-30'}])),/date|fecha|caducidad/i);
    assert.equal(await scalar("select count(*)::int from inventory_items where sku='SER-1'"),0);
  });
  await t.test('same SKU in other HQ is independent and destinations/IDs cannot cross headquarters',async()=>{
    await assert.rejects(preview(payload([{id:broca,category:[]}]),randomUUID(),foreign),/ID no disponible/);
    await assert.rejects(preview(sample,randomUUID(),foreign,null,box),/Caja no disponible/);
    await assert.rejects(preview(sample,randomUUID(),site,loc,box),/no ambas/);
    const independent=await preview(sample,randomUUID(),foreign); await confirm(independent.draftId);
    assert.equal(await scalar("select count(*)::int from inventory_items where sku='BR-8'"),2);
    assert.equal(await stock(broca),9);
  });
  await t.test('inferred type reuse is unique, honors existing field types and never guesses between duplicate SKUs',async()=>{
    const p=await preview(payload([{name:'Casco rojo',sku:'CAS-1',category:['Proteccion importada'],template:'Cascos de rescate',specs:{color_import:'Rojo'}}],[{key:'color_import',label:'Color',type:'text'}]));
    await confirm(p.draftId);
    const inferred=await preview(payload([{name:'Casco azul',sku:'CAS-2',category:['Proteccion importada'],specs:{color_import:'Azul'}}],[{key:'color_import',label:'Color',type:'text'}]));
    assert.equal(inferred.plan.lines[0].template,'Cascos de rescate'); assert.deepEqual(inferred.plan.templates,[]);
    await confirm(inferred.draftId);
    const byName=await preview(payload([{name:'Casco azul',category:['Proteccion importada'],specs:{color_import:'Azul'}}],[{key:'color_import',label:'Color',type:'text'}]));
    assert.equal(byName.plan.lines[0].action,'add');
    await assert.rejects(preview(payload([{name:'Conflicto',specs:{color_import:'8'}}],[{key:'color_import',label:'Color',type:'number'}])),/ya existe con tipo/);
    await db.exec('reset role');
    await db.query("update inventory_items set sku='CAS-1' where sku='CAS-2'");
    await as(admin);
    await assert.rejects(preview(payload([{sku:'CAS-1',category:[]}])),/SKU duplicado/);
  });
  await t.test('required custom/select/expiry fields and type changes are checked again at commit',async()=>{
    await db.exec('reset role');
    const template=await scalar('select template_id from inventory_items where id=$1',[broca]);
    const field=await scalar("insert into inventory_fields(field_key,label,field_type,options) values('import_restricted','Modelo','select','[\"A\",\"B\"]') returning id");
    await db.query("insert into inventory_template_fields(template_id,field_id,field_key,label,field_type,options,allowed_options,is_required) values($1,$2,'import_restricted','Modelo','select','[\"A\",\"B\"]','[\"A\"]',true)",[template,field]);
    await as(admin);
    const data=payload([{name:'Restringido',sku:'RESTRICT-1',specs:{import_restricted:'A'}}],[{key:'import_restricted',label:'Modelo',type:'select'}]);
    const allowed=await preview(data);
    await assert.rejects(preview(payload([{name:'Sin obligatorio',sku:'RESTRICT-2'}])),/obligatorio/);
    await assert.rejects(preview(payload([{name:'No permitido',sku:'RESTRICT-3',specs:{import_restricted:'B'}}],[{key:'import_restricted',label:'Modelo',type:'select'}])),/Opcion no disponible/);
    await db.exec('reset role');
    await db.query("update inventory_template_fields set allowed_options='[\"B\"]' where template_id=$1 and field_key='import_restricted'",[template]);
    await as(admin);
    await assert.rejects(confirm(allowed.draftId),/Opcion no disponible/);
    assert.equal(await scalar("select count(*)::int from inventory_items where sku='RESTRICT-1'"),0);
    await db.exec('reset role');
    const food=await scalar("select id from inventory_items where sku='PI-1'");
    await db.query("insert into inventory_stock_lots(item_id,code) values($1,'OLD-NO-EXPIRY')",[food]);
    await db.query("update inventory_template_fields set is_required=true where field_key='expiration_date' and template_id=(select template_id from inventory_items where id=$1)",[food]);
    await as(admin);
    await assert.rejects(preview(payload([{sku:'PI-1',category:[],lot_code:'OLD-NO-EXPIRY'}])),/caducidad obligatoria/);
  });
  await t.test('expired previews are rejected without writes; a maximum-size file is previewed without truncation',async()=>{
    const p=await preview(payload([{name:'Vista vencida',sku:'EXP-1',category:['Caducidad prueba']} ]));
    await db.exec('reset role');
    await db.query("update inventory_import_drafts set created_at=now()-interval '8 days' where id=$1",[p.draftId]);
    await as(admin); await assert.rejects(confirm(p.draftId),/ha caducado/);
    const large=await preview(payload(Array.from({length:500},(_,i)=>({name:'Articulo '+i,sku:'BULK-'+i,category:['Prueba volumen'],quantity:'0'}))));
    assert.equal(large.plan.lines.length,500);
    assert.equal(await scalar("select count(*)::int from inventory_items where sku like 'BULK-%'"),0);
    await assert.rejects(preview(payload(Array.from({length:501},(_,i)=>({name:'Articulo '+i})))),/500/);
  });
  await t.test('abandoned previews never pin empty sites or destinations; deleted destinations cannot become unassigned imports',async()=>{
    const emptySite=await scalar("insert into headquarters(name,slug) values('Sede temporal import','import-temporal') returning id");
    const emptyBox=await scalar("insert into inventory_containers(name,code,headquarters_id) values('Caja temporal','import-temporal',$1) returning id",[emptySite]);
    const p=await preview(payload([{name:'Pendiente',sku:'PENDING-1',category:['Temporal']}]),'TEMP-IMPORT',emptySite,null,emptyBox);
    await db.query('delete from inventory_containers where id=$1',[emptyBox]);
    await assert.rejects(confirm(p.draftId),/Caja no disponible/);
    await db.query('delete from headquarters where id=$1',[emptySite]);
    await assert.rejects(confirm(p.draftId),/Sede no disponible/);
    assert.equal(await scalar("select count(*)::int from inventory_items where sku='PENDING-1'"),0);
  });
  await t.test('admin-owned drafts cannot be changed or executed by other users; private executor is inaccessible',async()=>{
    await as(otherAdmin); await assert.rejects(confirm(draft.draftId),/no disponible/);
    for (const id of [editor,reader]) {
      await as(id); await assert.rejects(preview(sample),/Solo administracion/);
      await assert.rejects(confirm(draft.draftId),/Solo administracion/);
      assert.equal(await scalar('select count(*)::int from inventory_import_drafts'),0);
    }
    await as(admin);
    await assert.rejects(db.query("update inventory_import_drafts set payload='{}' where id=$1",[draft.draftId]),/permission denied/);
    await assert.rejects(db.query('select execute_inventory_import($1,$2,null,null,$3,false)',[sample,site,'BYPASS']),/permission denied/);
    await db.exec('reset role');
    for (const fn of ['preview_inventory_import(jsonb,uuid,uuid,uuid,text,text)','confirm_inventory_import(uuid)','execute_inventory_import(jsonb,uuid,uuid,uuid,text,boolean)']) assert.equal(await scalar("select has_function_privilege('anon',$1,'execute')",[fn]),false);
  });
});
