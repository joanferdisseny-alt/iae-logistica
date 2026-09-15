const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

test('barcode receiving: atomic distributions, variants, retries, cataloging and site isolation',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated,anon;
    alter default privileges in schema public grant execute on functions to authenticated,anon;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text);alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync('supabase/install.sql','utf8').replace('create extension if not exists "pgcrypto";',''));
  const [admin,editor,reader,foreign]=Array.from({length:4},()=>randomUUID());
  for(const id of [admin,editor,reader,foreign])await db.query("insert into auth.users values($1,$2,'{}')",[id,id+'@test.invalid']);
  const [site,other]=(await db.query('select id from headquarters order by slug limit 2')).rows.map(r=>r.id);
  await db.query('update profiles set headquarters_id=$1',[site]);
  await db.query("update profiles set role_id=(select id from app_roles where code='admin') where id=$1",[admin]);
  await db.query("update profiles set role_id=(select id from app_roles where code='editor') where id=$1",[editor]);
  await db.query('update profiles set headquarters_id=$1 where id=$2',[other,foreign]);
  const location=(await db.query("insert into locations(name,headquarters_id) values('Armario',$1) returning id",[site])).rows[0].id;
  const box=(await db.query("insert into inventory_containers(name,headquarters_id) values('Intervencion',$1) returning id",[site])).rows[0].id;
  const foreignBox=(await db.query("insert into inventory_containers(name,headquarters_id) values('Ajena',$1) returning id",[other])).rows[0].id;
  const item=(await db.query("insert into inventory_items(name,slug,category,headquarters_id,current_stock) values('Brocas','barcode-brocas','consumable',$1,0) returning id",[site])).rows[0].id;
  const template=(await db.query("insert into inventory_templates(code,name,category_code) values('barcode-test','Prueba recepcion','consumable') returning id")).rows[0].id;
  await db.exec('grant usage on schema public to authenticated,anon');
  const as=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`);};
  const link=(code='0012345678905',brand='Marca A',units='5',itemId=item)=>db.query("select link_inventory_barcode($1,$2,$3,'SDS', $4) as id",[itemId,code,brand,units]);
  let barcode;
  const receive=(changes={})=>{
    const v={id:randomUUID(),barcode,packs:2,lot:'B-123',expiry:'2027-04-01',allocations:[{location_id:location,quantity:'4'},{container_id:box,quantity:'6'}],notes:'Compra test',...changes};
    return db.query('select receive_inventory_barcode($1,$2,$3,$4,$5,$6,$7) as balance',[v.id,v.barcode,v.packs,v.lot,v.expiry,JSON.stringify(v.allocations),v.notes]);
  };
  const total=async()=>Number((await db.query('select current_stock from inventory_items where id=$1',[item])).rows[0].current_stock);
  await t.test('barcode mapping preserves leading zeros and checks brand equivalence and pack size',async()=>{
    await as(admin);barcode=(await link()).rows[0].id;
    assert.equal((await link()).rows[0].id,barcode);
    for(const args of [['0012345678905','Marca B'],['0012345678905','Marca A','10'],['bad code'],['NEW','Marca A','NaN'],['NEW','Marca A','0'],['NEW','Marca A','1.0001']])await assert.rejects(link(...args));
    assert.equal((await db.query('select code from inventory_barcodes where id=$1',[barcode])).rows[0].code,'0012345678905');
    assert.equal((await db.query('select * from inventory_variants')).rows.length,1);
  });
  await t.test('one confirmation receives all destinations and duplicate/concurrent retries add stock once',async()=>{
    const id=randomUUID();await Promise.all([receive({id}),receive({id})]);assert.equal(await total(),10);
    await assert.rejects(receive({id,packs:3}),/reutilizado/);
    const positions=(await db.query('select quantity,container_id,location_id from inventory_stock_positions where item_id=$1 order by quantity',[item])).rows;
    assert.deepEqual(positions.map(p=>Number(p.quantity)),[4,6]);
    assert.equal((await db.query('select count(*)::int as n from inventory_receipts')).rows[0].n,1);
    assert.equal((await db.query('select expiration_date::text from inventory_items where id=$1',[item])).rows[0].expiration_date,'2027-04-01');
  });
  await t.test('a failed later destination rolls back the entire receipt including earlier rows and lot creation',async()=>{
    const lotCount=(await db.query('select count(*)::int as n from inventory_stock_lots')).rows[0].n;
    for(const changes of [
      {allocations:[{location_id:location,quantity:4},{container_id:foreignBox,quantity:6}]},
      {allocations:[{location_id:location,container_id:box,quantity:10}]},
      {allocations:[{quantity:9}]},{allocations:[{quantity:'10.0001'}]},
      {allocations:[{quantity:11},{quantity:-1}]},{allocations:[{quantity:'NaN'}]},
      {packs:'NaN'},{packs:'Infinity'},{packs:1.5},{allocations:[]}
    ])await assert.rejects(receive(changes));
    assert.equal(await total(),10);assert.equal((await db.query('select count(*)::int as n from inventory_stock_lots')).rows[0].n,lotCount);
  });
  await t.test('brands stay separate by lot and box; checklist captures each brand, lot and expiry',async()=>{
    const second=(await link('SECOND','Marca B','1')).rows[0].id;
    await receive({barcode:second,packs:3,expiry:'2027-06-01',allocations:[{container_id:box,quantity:3}]});
    assert.equal(await total(),13);
    const brands=(await db.query('select v.brand,sum(s.quantity) as quantity from inventory_stock_positions s join inventory_stock_lots l on l.id=s.lot_id join inventory_variants v on v.id=l.variant_id group by v.brand order by v.brand')).rows;
    assert.deepEqual(brands.map(r=>[r.brand,Number(r.quantity)]),[['Marca A',10],['Marca B',3]]);
    const check=randomUUID();await db.query("select create_container_checklist($1,$2,'practice','Practica','2026-09-15','Equipo')",[check,box]);
    const lines=(await db.query('select lot_code,expected_quantity from container_checklist_items where checklist_id=$1 order by lot_code',[check])).rows;
    assert.equal(lines.length,2);assert.match(lines[0].lot_code,/Marca A/);assert.match(lines[1].lot_code,/Marca B/);
    assert.deepEqual(lines.map(l=>Number(l.expected_quantity)),[6,3]);
  });
  await t.test('RLS and grants prevent foreign reads, editor receipts and anonymous RPCs',async()=>{
    for(const user of [editor,reader]){await as(user);await assert.rejects(link('OTHER'));await assert.rejects(receive());assert.equal((await db.query('select * from inventory_barcodes')).rows.length,2);}
    await as(foreign);for(const table of ['inventory_barcodes','inventory_variants','inventory_receipts'])assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
    await as(admin);await assert.rejects(db.query("update inventory_barcodes set units_per_pack=100"));await assert.rejects(db.query("delete from inventory_receipts"));
    await as(null,'anon');await assert.rejects(link());await assert.rejects(receive());
  });
  await t.test('all active roles can request cataloging once in their site, without affecting stock',async()=>{
    await as(reader);const id=randomUUID();
    const request=()=>db.query('select request_barcode_cataloging($1,$2,$3,$4,2) as id',[id,site,'UNKNOWN','Brocas nuevas sin ficha']);
    const first=(await request()).rows[0].id;assert.equal((await request()).rows[0].id,first);
    assert.equal((await db.query('select * from logistics_requests where id=$1',[first])).rows[0].status,'pending');
    await assert.rejects(db.query("select request_barcode_cataloging($1,$2,'X','Nuevo material',1)",[randomUUID(),other]));
    await as(admin);assert.equal(await total(),13);
  });
  await t.test('new article catalog creation is idempotent, zero-stock and respects editor site',async()=>{
    await as(editor);const id=randomUUID();const record={name:'Nuevo material',slug:'receiving-new',template_id:template,category:'consumable',headquarters_id:site,current_stock:0,technical_specs:{}};
    const create=(value=record)=>db.query('select create_inventory_record_once($1,$2) as id',[id,JSON.stringify(value)]);
    const itemId=(await create()).rows[0].id;assert.equal((await create()).rows[0].id,itemId);
    await assert.rejects(create({...record,name:'Otro'}));await assert.rejects(create({...record,headquarters_id:other}));await assert.rejects(create({...record,current_stock:1}));
    assert.equal(Number((await db.query('select current_stock from inventory_items where id=$1',[itemId])).rows[0].current_stock),0);
  });
  await t.test('serialized tools reject multi-unit or fractional placement atomically',async()=>{
    await as(admin);const record={name:'Taladro',slug:'receiving-drill',template_id:template,category:'consumable',headquarters_id:site,current_stock:0,serial_number:'SER-123',technical_specs:{}};
    const serialItem=(await db.query('select create_inventory_record_once($1,$2) as id',[randomUUID(),JSON.stringify(record)])).rows[0].id;
    const serialCode=(await link('SERIAL','Marca S','1',serialItem)).rows[0].id;
    await assert.rejects(receive({barcode:serialCode}));
    await assert.rejects(receive({barcode:serialCode,packs:1,allocations:[{quantity:0.5,container_id:box},{quantity:0.5,location_id:location}]}));
    await receive({barcode:serialCode,packs:1,allocations:[{quantity:1,container_id:box}]});
  });
  await t.test('required expiry fields cannot be bypassed through the receipt RPC',async()=>{
    await db.exec('reset role');
    const field=(await db.query("insert into inventory_fields(field_key,label,field_type) values('expiration_date','Caducidad','date') on conflict(field_key) do update set field_type='date' returning id")).rows[0].id;
    await db.query("insert into inventory_template_fields(template_id,field_id,field_key,label,field_type,is_required) values($1,$2,'expiration_date','Caducidad','date',true)",[template,field]);
    await as(admin);
    const serialCode=(await db.query("select id from inventory_barcodes where code='SERIAL'")).rows[0].id;
    await assert.rejects(receive({barcode:serialCode,expiry:null,packs:1,allocations:[{quantity:1}]}),/exige fecha/);
  });
});
