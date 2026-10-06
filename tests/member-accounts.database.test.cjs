const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('member accounts: reconcile legacy records, atomic provisioning, retries and permissions', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role authenticated; create role anon;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',encrypted_password text default '');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated,anon;
    alter default privileges in schema public grant execute on functions to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;`);
  const install = fs.readFileSync('supabase/install.sql','utf8').replace('create extension if not exists "pgcrypto";','')
    .replace("if not exists(select 1 from iae_internal.migrations where version='202610060002_member_accounts.sql') then",'if false then');
  await db.exec(install);
  const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  const [site, foreign] = (await db.query('select id from headquarters order by id limit 2')).rows.map(r => r.id);
  const admin = randomUUID(), reader = randomUUID(), legacy = randomUUID(), orphan = randomUUID();
  for (const [id,role,base] of [[admin,'admin',null],[reader,'reader',site]]) {
    await db.query("insert into auth.users(id,email,encrypted_password) values($1,$2,'existing-hash')",[id,id+'@example.org']);
    await db.query('update profiles set role_id=(select id from app_roles where code=$2),headquarters_id=$3,full_name=$2 where id=$1',[id,role,base]);
  }
  await db.query("insert into volunteers(id,external_code,full_name,email,headquarters_id) values($1,'OLD-001','Nombre antiguo',$2,$3),($4,'LEGACY-NO-EMAIL','Persona sin correo',null,$3)",[legacy,reader+'@example.org',site,orphan]);
  const item = await scalar("insert into inventory_items(name,slug,category,headquarters_id) values('Polo','member-polo','material',$1) returning id",[site]);
  const delivery = randomUUID();
  await db.query("insert into volunteer_deliveries(id,volunteer_id,item_id,material,quantity,historical,notes,payload,created_by) values($1,$2,$3,'Polo',2,true,'Antigua','{}',$4)",[delivery,legacy,item,admin]);
  await db.exec(fs.readFileSync('supabase/upgrade-member-accounts.sql','utf8'));
  const as = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); };
  const prepare = (id,rows) => scalar("select prepare_member_accounts($1,'usuarios.csv',$2)",[id,JSON.stringify(rows)]);
  const row = (extra={}) => ({ name:'Persona nueva',email:'new@example.org',site,role:'volunteer',...extra });
  const claim = id => scalar('select claim_member_provision($1)',[id]);
  let request, batch, personId;
  await t.test('one read-only preview compares all requested emails against Auth without a first-page limit', async () => {
    await as(admin);
    const input=Array.from({length:499},(_,i)=>'missing-'+i+'@example.org');input.push(reader.toUpperCase()+'@EXAMPLE.ORG');
    const result=await db.query('select * from preview_member_accounts($1)',[JSON.stringify(input)]);
    assert.equal(result.rows.length,500);assert.equal(result.rows.at(-1).existing,true);
    assert.equal(result.rows.filter(r=>r.existing).length,1);
    assert.equal(await scalar('select count(*)::int from member_imports'),0);
    await as(reader);await assert.rejects(db.query('select * from preview_member_accounts($1)',[JSON.stringify(input)]),/Solo administracion/);
    await db.exec('reset role');
  });
  await t.test('backfill keeps legacy identity and deliveries; every existing account has one volunteer, even global admin', async () => {
    assert.equal(await scalar('select profile_id from volunteers where id=$1',[legacy]),reader);
    assert.equal(await scalar('select volunteer_id from volunteer_deliveries where id=$1',[delivery]),legacy);
    assert.equal(await scalar('select count(*)::int from volunteers where profile_id is not null'),2);
    assert.equal(await scalar('select count(*)::int from volunteers where profile_id is null'),1);
    assert.equal(await scalar('select headquarters_id from volunteers where profile_id=$1',[admin]),null);
    await db.exec(fs.readFileSync('supabase/upgrade-member-accounts.sql','utf8'));
    assert.equal(await scalar('select count(*)::int from volunteers'),3);
  });
  await t.test('preparation is all-or-nothing and repeated request IDs are safe', async () => {
    await as(admin); batch=randomUUID();
    assert.equal(await prepare(batch,[row()]),batch); assert.equal(await prepare(batch,[row()]),batch);
    await assert.rejects(prepare(batch,[row({name:'Cambios'})]),/reutilizado/);
    await assert.rejects(prepare(randomUUID(),[row(),row({email:' NEW@EXAMPLE.ORG '})]),/correos repetidos/);
    await assert.rejects(prepare(randomUUID(),[row(),row({email:'bad'})]),/correo y nombre/);
    assert.equal(await scalar('select count(*)::int from member_imports'),1);
    assert.equal(await scalar('select count(*)::int from member_provision_requests'),1);
    request=await scalar('select id from member_provision_requests where batch_id=$1',[batch]);
  });
  await t.test('a leased row creates account, authorized role/site and volunteer in one database transaction', async () => {
    const leased = await claim(request); assert.equal(leased.profile_id,null);
    await assert.rejects(claim(request),/procesando/);
    await db.exec('reset role'); personId=randomUUID();
    await db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,'new@example.org',$2)",[personId,JSON.stringify({iae_provision_request:request})]);
    assert.equal(await scalar('select headquarters_id from profiles where id=$1',[personId]),site);
    assert.equal(await scalar('select r.code from profiles p join app_roles r on r.id=p.role_id where p.id=$1',[personId]),'volunteer');
    assert.equal(await scalar('select count(*)::int from volunteers where profile_id=$1',[personId]),1);
    await as(admin);
    await scalar("select finish_member_provision($1,$2,false,'SMTP unavailable')",[request,leased.token]);
    const retry=await claim(request); assert.equal(retry.profile_id,personId);
    await scalar('select finish_member_provision($1,$2,true,null)',[request,retry.token]);
    assert.equal((await claim(request)).done,true);
    assert.equal(await scalar('select state from member_provision_requests where id=$1',[request]),'created');
  });
  await t.test('existing accounts keep password, role, headquarters and name; no activation email is needed', async () => {
    const id=randomUUID(); await prepare(id,[row({email:reader+'@example.org',role:'admin',site:foreign})]);
    const r=await scalar('select id from member_provision_requests where batch_id=$1',[id]);
    assert.equal((await claim(r)).done,true);
    assert.equal(await scalar('select mail_status from member_provision_requests where id=$1',[r]),'not_needed');
    assert.equal(await scalar('select headquarters_id from profiles where id=$1',[reader]),site);
    assert.equal(await scalar('select full_name from profiles where id=$1',[reader]),'reader');
  });
  await t.test('legacy record with missing email can be completed without replacing its identity', async () => {
    const id=randomUUID(); await prepare(id,[row({email:'legacy@example.org',code:'LEGACY-NO-EMAIL',volunteer_id:orphan})]);
    const r=await scalar('select id from member_provision_requests where batch_id=$1',[id]); await claim(r);
    await db.exec('reset role'); const account=randomUUID();
    await db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,'legacy@example.org',$2)",[account,JSON.stringify({iae_provision_request:r})]);
    assert.equal(await scalar('select profile_id from volunteers where id=$1',[orphan]),account);
    assert.equal(await scalar('select count(*)::int from volunteers where profile_id=$1',[account]),1);
  });
  await t.test('profile and Auth email updates synchronize; volunteer edits cannot unlink or change email independently', async () => {
    await db.query("update profiles set full_name='Nombre actualizado',headquarters_id=$2 where id=$1",[reader,foreign]);
    await db.query("update auth.users set email='updated@example.org' where id=$1",[reader]);
    assert.equal(await scalar('select email from volunteers where id=$1',[legacy]),'updated@example.org');
    assert.equal(await scalar('select headquarters_id from volunteers where id=$1',[legacy]),foreign);
    await as(admin);
    await scalar("select save_volunteer($1,'OLD-001','Nombre compartido','updated@example.org',$2,$3)",[legacy,site,reader]);
    assert.equal(await scalar('select full_name from profiles where id=$1',[reader]),'Nombre compartido');
    await assert.rejects(scalar("select save_volunteer($1,'OLD-001','Prueba','fake@example.org',$2,$3)",[legacy,site,reader]),/correo/);
    await assert.rejects(scalar("select save_volunteer(null,'NEW','Prueba',null,$1,null)",[site]),/Crea la cuenta/);
    assert.equal(await scalar('select volunteer_id from volunteer_deliveries where id=$1',[delivery]),legacy);
  });
  await t.test('personal metadata never grants privileges and broken provisioning rolls the Auth insertion back', async () => {
    await db.exec('reset role'); const id=randomUUID();
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'attacker@example.org',$2)",[id,JSON.stringify({role:'admin',headquarters_id:site,iae_provision_request:request,full_name:'X'})]);
    assert.equal(await scalar('select r.code from profiles p join app_roles r on r.id=p.role_id where p.id=$1',[id]),'volunteer');
    assert.equal(await scalar('select headquarters_id from profiles where id=$1',[id]),null);
    await as(admin); const b=randomUUID(); await prepare(b,[row({email:'broken@example.org',code:'UNIQUE-TEST'})]);
    const r=await scalar('select id from member_provision_requests where batch_id=$1',[b]); await claim(r);
    await db.exec('reset role'); await db.query("update volunteers set external_code='UNIQUE-TEST' where profile_id=$1",[id]);
    await assert.rejects(db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,'broken@example.org',$2)",[randomUUID(),JSON.stringify({iae_provision_request:r})]),/duplicate key/);
    assert.equal(await scalar("select count(*)::int from auth.users where email='broken@example.org'"),0);
  });
  await t.test('RLS and functions deny non-admin provisioning and other personal files; inactive access is revoked', async () => {
    await as(reader);
    assert.equal(await scalar('select count(*)::int from volunteers'),1);
    assert.equal(await scalar('select profile_id from volunteers'),reader);
    assert.equal(await scalar('select count(*)::int from member_imports'),0);
    await assert.rejects(prepare(randomUUID(),[row()]),/Solo administracion/);
    await assert.rejects(claim(request),/Solo administracion/);
    await assert.rejects(db.query("update volunteers set full_name='hack'"),/permission denied/);
    await db.exec('reset role'); await db.query('update profiles set is_active=false where id=$1',[reader]);
    assert.equal(await scalar('select is_active from volunteers where profile_id=$1',[reader]),false);
    await as(reader); assert.equal(await scalar('select count(*)::int from volunteers'),0);
    await db.exec('reset role;set role anon'); await assert.rejects(claim(request),/permission denied/);
  });
});
