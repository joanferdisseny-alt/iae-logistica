const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('category hierarchy upgrade preserves catalogues and enforces tree integrity and admin permissions', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role authenticated; create role anon;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    alter default privileges in schema public grant all on tables to authenticated,anon;
    alter default privileges in schema public grant execute on functions to authenticated,anon;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8').replace('create extension if not exists "pgcrypto";', ''));
  for (const file of fs.readdirSync('supabase/migrations').filter(file => /^202609.*\.sql$/.test(file)).sort()) {
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  const before = (await db.query('select code,name,description from inventory_categories order by code')).rows;
  const fieldCount = (await db.query('select count(*)::int as n from inventory_fields')).rows[0].n;
  const migration = fs.readFileSync('supabase/migrations/202610010001_category_hierarchy.sql', 'utf8');
  await db.exec(migration); await db.exec(migration);
  assert.deepEqual((await db.query('select code,name,description from inventory_categories order by code')).rows, before);
  assert.ok((await db.query('select parent_code from inventory_categories')).rows.every(c => c.parent_code === null));
  assert.equal((await db.query('select count(*)::int as n from inventory_fields')).rows[0].n, fieldCount);

  const admin = '11111111-1111-4111-8111-111111111111';
  const editor = '22222222-2222-4222-8222-222222222222';
  const reader = '33333333-3333-4333-8333-333333333333';
  for (const [id, role] of [[admin, 'admin'], [editor, 'editor'], [reader, 'reader']]) {
    await db.query("insert into auth.users values($1,$2,'{}')", [id, id + '@example.invalid']);
    await db.query("update profiles set role_id=(select id from app_roles where code=$2),headquarters_id=(select id from headquarters limit 1) where id=$1", [id, role]);
  }
  async function as(id) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  }
  await as(admin);
  await db.exec(`insert into inventory_categories(code,name) values('uniformity','Uniformidad');
    insert into inventory_categories(code,name,parent_code) values('first','Primera','uniformity'),('second','Segunda','uniformity');
    insert into inventory_categories(code,name,parent_code) values('overalls','Monos','first');`);

  await t.test('cycles, unknown parents and non-empty deletion are rejected atomically', async () => {
    await assert.rejects(db.exec("update inventory_categories set parent_code='overalls' where code='uniformity'"), { code: '23514' });
    await assert.rejects(db.exec("update inventory_categories set parent_code=code where code='first'"), { code: '23514' });
    await assert.rejects(db.exec("insert into inventory_categories(code,name,parent_code) values('self','Self','self')"), { code: '23514' });
    await assert.rejects(db.exec("update inventory_categories set parent_code='missing' where code='second'"), { code: '23503' });
    await assert.rejects(db.exec("delete from inventory_categories where code='uniformity'"), error => ['23503', '23001'].includes(error.code));
    await assert.rejects(db.exec("update inventory_categories set parent_code=case when code='first' then 'second' else 'first' end where code in ('first','second')"), { code: '23514' });
    assert.equal((await db.query("select parent_code from inventory_categories where code='first'")).rows[0].parent_code, 'uniformity');
    assert.equal((await db.query("select parent_code from inventory_categories where code='uniformity'")).rows[0].parent_code, null);
    await db.exec("update inventory_categories set parent_code='second' where code='overalls'");
    await db.exec("update inventory_categories set parent_code=null where code='overalls'");
    await db.exec("delete from inventory_categories where code='overalls'");
  });

  await t.test('existing template references still prevent deletion of a leaf category', async () => {
    await db.exec("insert into inventory_templates(code,name,category_code) values('uniform_test','Uniform test','first')");
    await assert.rejects(db.exec("delete from inventory_categories where code='first'"), { code: '23503' });
    await db.exec("delete from inventory_templates where code='uniform_test'");
    await db.exec("delete from inventory_categories where code='first'");
  });

  await t.test('moving a populated branch and promoting it to root preserves descendants, templates, stock and IDs', async () => {
    await as(admin);
    await db.exec(`insert into inventory_categories(code,name,description) values
      ('move_branch','Familia original','Descripcion conservada'),('move_destination','Destino',null);
      insert into inventory_categories(code,name,parent_code) values('move_child','Hija','move_branch');
      insert into inventory_templates(code,name,category_code) values('move_template','Ficha de prueba','move_child');`);
    const template=(await db.query("select id from inventory_templates where code='move_template'")).rows[0].id;
    const site=(await db.query('select id from headquarters limit 1')).rows[0].id;
    const item=(await db.query('select create_inventory_record($1::jsonb,null,5,$2) as id', [JSON.stringify({
      name:'Articulo conservado', slug:'move-test-item', template_id:template, headquarters_id:site, unit:'unidades'
    }), 'Stock para comprobar jerarquia'])).rows[0].id;
    const before=(await db.query('select to_jsonb(i) as row from inventory_items i where id=$1',[item])).rows;
    const positions=(await db.query('select to_jsonb(p) as row from inventory_stock_positions p where item_id=$1 order by id',[item])).rows;
    const assertPreserved = async () => {
      assert.deepEqual((await db.query('select to_jsonb(i) as row from inventory_items i where id=$1',[item])).rows,before);
      assert.deepEqual((await db.query('select to_jsonb(p) as row from inventory_stock_positions p where item_id=$1 order by id',[item])).rows,positions);
      assert.equal((await db.query("select parent_code from inventory_categories where code='move_child'")).rows[0].parent_code,'move_branch');
      assert.equal((await db.query('select category_code from inventory_templates where id=$1',[template])).rows[0].category_code,'move_child');
      assert.equal((await db.query("select description from inventory_categories where code='move_branch'")).rows[0].description,'Descripcion conservada');
    };
    await db.exec("update inventory_categories set parent_code='move_destination' where code='move_branch'");
    await assertPreserved();
    assert.equal((await db.query("select parent_code from inventory_categories where code='move_branch'")).rows[0].parent_code,'move_destination');
    await assert.rejects(db.exec("update inventory_categories set parent_code='move_child' where code='move_branch'"),{ code:'23514' });
    await db.exec("update inventory_categories set parent_code=null where code='move_branch'");
    await assertPreserved();
    assert.equal((await db.query("select parent_code from inventory_categories where code='move_branch'")).rows[0].parent_code,null);
  });

  await t.test('editors and readers may read categories but cannot change their hierarchy', async () => {
    for (const id of [editor, reader]) {
      await as(id);
      assert.ok((await db.query('select code from inventory_categories')).rows.length > 0);
      await assert.rejects(db.exec("insert into inventory_categories(code,name) values('forbidden','Forbidden')"), /row-level security/);
      assert.equal((await db.query("update inventory_categories set parent_code=null where code='second' returning code")).rows.length, 0);
      assert.equal((await db.query("delete from inventory_categories where code='second' returning code")).rows.length, 0);
    }
  });

  await t.test('trigger is private with an explicit search path', async () => {
    await db.exec('reset role');
    const fn = (await db.query(`select proconfig,
      has_function_privilege('anon',oid,'execute') as anonymous,
      has_function_privilege('authenticated',oid,'execute') as signed_in
      from pg_proc where oid='public.guard_category_parent()'::regprocedure`)).rows[0];
    assert.equal(fn.anonymous, false); assert.equal(fn.signed_in, false);
    assert.ok(fn.proconfig.some(config => config.startsWith('search_path=')));
  });
});
