const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('box return checklists: RLS, frozen contents, saved checks and immutable closure',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role authenticated; create role anon;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated,anon;
    alter default privileges in schema public grant execute on functions to authenticated,anon;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync('supabase/install.sql','utf8').replace('create extension if not exists "pgcrypto";',''));
  await db.exec('grant usage on schema public to authenticated,anon');
  const ids=Array.from({length:7},(_,n)=>`00000000-0000-4000-8000-00000000000${n+1}`);
  const [admin,author,peer,contact,foreign,inactive,noSite]=ids;
  for (const id of ids) await db.query("insert into auth.users values($1,$2,'{}')",[id,id+'@example.invalid']);
  const sites=(await db.query('select id from headquarters order by slug limit 2')).rows.map(r=>r.id);
  const [site,otherSite]=sites;
  await db.query('update profiles set headquarters_id=$1',[site]);
  await db.query("update profiles set full_name='Responsable',is_logistics_contact=true where id=$1",[contact]);
  await db.query("update profiles set role_id=(select id from app_roles where code='admin') where id=$1",[admin]);
  await db.query('update profiles set headquarters_id=$1 where id=$2',[otherSite,foreign]);
  await db.query('update profiles set is_active=false where id=$1',[inactive]);
  await db.query('update profiles set headquarters_id=null where id=$1',[noSite]);
  const box=(await db.query("insert into inventory_containers(name,headquarters_id) values('Caja rescate',$1) returning id",[site])).rows[0].id;
  const foreignBox=(await db.query("insert into inventory_containers(name,headquarters_id) values('Caja otra sede',$1) returning id",[otherSite])).rows[0].id;
  const emptyBox=(await db.query("insert into inventory_containers(name,headquarters_id) values('Vacia',$1) returning id",[site])).rows[0].id;
  const drill=(await db.query("insert into inventory_items(name,slug,category,headquarters_id,current_stock,unit) values('Taladro','check-drill','tool',$1,1,'uds') returning id",[site])).rows[0].id;
  const bits=(await db.query("insert into inventory_items(name,slug,category,headquarters_id,current_stock,unit) values('Brocas','check-bits','consumable',$1,10,'uds') returning id",[site])).rows[0].id;
  await db.query('insert into inventory_container_items(container_id,item_id,quantity) values($1,$2,1),($1,$3,10)',[box,drill,bits]);
  await db.exec(`insert into inventory_stock_lots(item_id,code) select id,'Inicial' from inventory_items;
    insert into inventory_stock_positions(item_id,lot_id,container_id,quantity)
      select l.item_id,l.id,c.container_id,c.quantity from inventory_stock_lots l join inventory_container_items c on c.item_id=l.item_id;`);
  async function as(id,role='authenticated') {
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']); await db.exec(`set role ${role}`);
  }
  let counter=10;
  const uuid=()=>`10000000-0000-4000-8000-${String(counter++).padStart(12,'0')}`;
  const create=(id=uuid(),target=box)=>db.query("select create_container_checklist($1,$2,'practice','Entrenamiento','2026-09-15','Equipo A') as id",[id,target]);
  const save=(line,revision,result='ok',quantity=null,notes='')=>db.query('select save_checklist_item($1,$2,$3,$4,$5)',[line,revision,result,quantity,notes]);
  const close=(id,returned=true,summary='',cancel=false)=>db.query('select close_container_checklist($1,$2,$3,$4) as status',[id,returned,summary,cancel]);
  let checklist,lines;
  await t.test('author can snapshot own box once; empty and cross-site creation cannot persist',async()=>{
    await as(author);
    const id=uuid(); checklist=(await create(id)).rows[0].id;
    assert.equal((await create(id)).rows[0].id,checklist);
    lines=(await db.query('select * from container_checklist_items where checklist_id=$1 order by item_name',[checklist])).rows;
    assert.equal(lines.length,2); assert.equal(lines[0].item_name,'Brocas');
    assert.equal(Number(lines[0].expected_quantity),10); assert.ok(lines.every(l=>l.result==='pending'));
    await assert.rejects(create(),/revision abierta/);
    await assert.rejects(create(uuid(),foreignBox),/tu sede/);
    const emptyId=uuid(); await assert.rejects(create(emptyId,emptyBox),/vacia/);
    assert.equal((await db.query('select id from container_checklists where id=$1',[emptyId])).rows.length,0);
    for (const actor of [inactive,noSite]) { await as(actor); await assert.rejects(create(),/activa|sede/); }
  });
  await t.test('reads are site-scoped and direct writes and anonymous RPCs are forbidden',async()=>{
    await as(foreign); assert.equal((await db.query('select * from container_checklists')).rows.length,0);
    assert.equal((await db.query('select * from container_checklist_items')).rows.length,0);
    await assert.rejects(save(lines[0].id,0),/No puedes/);
    await as(peer); assert.equal((await db.query('select * from container_checklists')).rows.length,1);
    await assert.rejects(save(lines[0].id,0),/No puedes/);
    for (const actor of [admin,author]) {
      await as(actor);
      for (const statement of ["update container_checklists set status='complete'",'delete from container_checklists',"update container_checklist_items set expected_quantity=0",'delete from container_checklist_items']) await assert.rejects(db.exec(statement),/permission denied/);
    }
    await as(null,'anon'); await assert.rejects(create(),/permission denied/);
    await assert.rejects(db.query('select * from container_checklists'),/permission denied/);
  });
  await t.test('per-line checks require notes and valid quantities; stale writes and premature closure fail',async()=>{
    await as(author);
    await assert.rejects(close(checklist),/pendientes/);
    for (const [quantity,notes] of [[11,'Faltan'],[-1,'Faltan'],[1.0001,'Faltan'],[9,''],[10,'Faltan']]) await assert.rejects(save(lines[0].id,0,'missing',quantity,notes),/cantidad|Cantidad|nota/);
    await as(contact);
    const results=await Promise.allSettled([save(lines[1].id,0),save(lines[1].id,0)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    const checked=(await db.query('select * from container_checklist_items where id=$1',[lines[1].id])).rows[0];
    assert.equal(checked.checked_by,contact); assert.equal(checked.checked_by_name,'Responsable'); assert.equal(checked.revision,1);
  });
  await t.test('stock changes never change expected contents; closing with shortages does not adjust stock',async()=>{
    await as(admin);
    await db.query("select record_inventory_movement($1,'out',2,'Consumo entrenamiento',$2)",[bits,uuid()]);
    assert.equal(Number((await db.query('select expected_quantity from container_checklist_items where id=$1',[lines[0].id])).rows[0].expected_quantity),10);
    await as(author); await save(lines[0].id,0,'consumed',8,'Dos brocas gastadas');
    assert.equal((await close(checklist)).rows[0].status,'issues');
    assert.equal(Number((await db.query('select current_stock from inventory_items where id=$1',[bits])).rows[0].current_stock),8);
    await assert.rejects(save(lines[0].id,1),/cerrada/);
    await assert.rejects(close(checklist),/cerrada/);
  });
  await t.test('all verified plus returned box closes complete; unreturned box is always an issue',async()=>{
    await as(author);
    const complete=(await create()).rows[0].id;
    const fresh=(await db.query('select * from container_checklist_items where checklist_id=$1',[complete])).rows;
    assert.equal(Number(fresh.find(l=>l.item_id===bits).expected_quantity),8);
    for (const line of fresh) await save(line.id,0);
    assert.equal((await close(complete)).rows[0].status,'complete');
    const notReturned=(await create()).rows[0].id;
    for (const line of (await db.query('select * from container_checklist_items where checklist_id=$1',[notReturned])).rows) await save(line.id,0);
    await assert.rejects(close(notReturned,false),/donde queda/);
    assert.equal((await close(notReturned,false,'Caja en el vehiculo')).rows[0].status,'issues');
  });
  await t.test('cancellation keeps history and account revocation takes immediate effect',async()=>{
    await as(author); const id=(await create()).rows[0].id;
    await assert.rejects(close(id,false,'',true),/motivo/);
    assert.equal((await close(id,false,'Creada por error',true)).rows[0].status,'cancelled');
    assert.equal((await db.query('select * from container_checklist_items where checklist_id=$1',[id])).rows.length,2);
    await as(admin); await db.query('update profiles set is_active=false where id=$1',[author]);
    await as(author); assert.equal((await db.query('select * from container_checklists')).rows.length,0);
    await assert.rejects(save(lines[0].id,1),/No puedes/);
  });
});
