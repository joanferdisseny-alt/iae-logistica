const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const sql = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

test("logistics requests: real migration, RLS, grants and atomic history (local PostgreSQL)", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role authenticated; create role anon;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  await db.exec(sql("supabase/schema.sql").replace('create extension if not exists "pgcrypto";', ""));
  await db.exec(sql("supabase/migrations/202609140001_security_and_operations.sql"));
  await db.exec(`grant usage on schema public to authenticated, anon;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    alter default privileges in schema public grant all on tables to authenticated, anon;`);
  await db.exec(sql("supabase/migrations/202609140002_logistics_requests.sql"));
  const ids = Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`);
  const [admin, author, peer, contact, otherContact, inactive, noSite] = ids;
  for (const id of ids) await db.query("insert into auth.users values($1,$2,'{}')", [id, `${id}@example.invalid`]);
  const sites = (await db.query("select id from headquarters order by slug limit 2")).rows.map((row) => row.id);
  const [site, otherSite] = sites;
  await db.query("update profiles set headquarters_id=$1", [site]);
  await db.query("update profiles set role_id=(select id from app_roles where code='admin') where id in ($1,$2)", [admin, inactive]);
  await db.query("update profiles set role_id=(select id from app_roles where code='editor') where id=$1", [peer]);
  await db.query("update profiles set is_logistics_contact=true where id in ($1,$2)", [contact, otherContact]);
  await db.query("update profiles set headquarters_id=$1 where id=$2", [otherSite, otherContact]);
  await db.query("update profiles set is_active=false where id=$1", [inactive]);
  await db.query("update profiles set headquarters_id=null where id=$1", [noSite]);
  async function as(id, role = "authenticated") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
    await db.exec(`set role ${role}`);
  }
  async function create(headquarters = site, quantity = "1.125") {
    return (await db.query("insert into logistics_requests(headquarters_id,material,quantity,unit,notes) values($1,'Guantes',$2,'cajas','') returning *", [headquarters, quantity])).rows[0];
  }
  async function change(id, status, expected = "pending") {
    return (await db.query("update logistics_requests set status=$2 where id=$1 and status=$3 returning id", [id, status, expected])).rows;
  }
  let own, foreign, second;
  await t.test("all roles create locally; cross-site, forged author/status and invalid quantities are denied", async () => {
    await as(author); own = await create();
    assert.equal(own.created_by, author);
    await assert.rejects(create(otherSite), /row-level security/);
    await assert.rejects(db.query("insert into logistics_requests(headquarters_id,material,quantity,created_by) values($1,'Guantes',1,$2)", [site, peer]), /permission denied/);
    await assert.rejects(db.query("insert into logistics_requests(headquarters_id,material,quantity,status) values($1,'Guantes',1,'completed')", [site]), /permission denied/);
    for (const quantity of ["0", "-1", "1.0001", "NaN", "Infinity", "1000000000"]) await assert.rejects(create(site, quantity), /check constraint/);
    await as(peer); second = await create();
    await as(otherContact); foreign = await create(otherSite);
    await as(admin); assert.equal((await create(otherSite)).headquarters_id, otherSite);
  });
  await t.test("normal users see only their requests; reader contacts see their site; admin global", async () => {
    await as(author);
    assert.deepEqual((await db.query("select id from logistics_requests")).rows.map((row) => row.id), [own.id]);
    assert.equal((await db.query("select * from logistics_request_history")).rows.length, 1);
    await as(peer); assert.deepEqual(await change(own.id, "accepted"), []);
    await as(contact);
    assert.equal((await db.query("select * from logistics_requests")).rows.length, 2);
    assert.equal((await db.query("select * from logistics_request_history")).rows.length, 2);
    assert.deepEqual(await change(foreign.id, "accepted"), []);
    await as(admin); assert.equal((await db.query("select * from logistics_requests")).rows.length, 4);
  });
  await t.test("author can only cancel pending; history is immutable and deletion prohibited", async () => {
    await as(author);
    await assert.rejects(change(own.id, "accepted"), /row-level security/);
    assert.equal((await change(own.id, "cancelled")).length, 1);
    assert.deepEqual(await change(own.id, "pending", "cancelled"), []);
    for (const statement of [
      "update logistics_requests set headquarters_id=gen_random_uuid()",
      "update logistics_requests set material='Forged'",
      "update logistics_requests set created_by=gen_random_uuid()",
      "update logistics_requests set updated_at=now()",
      "delete from logistics_requests",
      "delete from logistics_request_history",
      "update logistics_request_history set to_status='completed'",
      "insert into logistics_request_history(request_id,actor_id,to_status) values(gen_random_uuid(),auth.uid(),'completed')"
    ]) await assert.rejects(db.exec(statement), /permission denied/);
    assert.equal((await db.query("select * from logistics_request_history")).rows.length, 2);
  });
  await t.test("contact transitions are forward-only, stale writes do nothing and history is atomic", async () => {
    await as(contact);
    await assert.rejects(change(second.id, "completed"), /Transicion/);
    assert.equal((await change(second.id, "accepted")).length, 1);
    assert.deepEqual(await change(second.id, "cancelled"), []);
    await as(peer); assert.deepEqual(await change(second.id, "cancelled", "accepted"), []);
    await as(contact);
    assert.equal((await change(second.id, "preparing", "accepted")).length, 1);
    assert.equal((await change(second.id, "completed", "preparing")).length, 1);
    await assert.rejects(change(second.id, "pending", "completed"), /Transicion/);
    const history = (await db.query("select from_status,to_status,actor_id from logistics_request_history where request_id=$1 order by created_at", [second.id])).rows;
    assert.deepEqual(history.map((row) => row.to_status), ["pending", "accepted", "preparing", "completed"]);
    assert.ok(history.slice(1).every((row) => row.actor_id === contact));
  });
  await t.test("renamed labels do not grant management; inactive/no-site/anonymous users cannot access", async () => {
    await as(admin);
    await db.exec("update app_roles set name='Administrador' where code='editor'");
    await as(peer); assert.equal((await db.query("select can_manage_logistics_requests($1) as allowed", [site])).rows[0].allowed, false);
    for (const user of [inactive, noSite]) {
      await as(user);
      assert.equal((await db.query("select * from logistics_requests")).rows.length, 0);
      assert.equal((await db.query("select * from logistics_request_history")).rows.length, 0);
      await assert.rejects(create(), /row-level security/);
      assert.deepEqual(await change(foreign.id, "accepted"), []);
    }
    await as(null, "anon");
    await assert.rejects(db.query("select * from logistics_requests"), /permission denied/);
    await assert.rejects(db.query("select can_manage_logistics_requests($1)", [site]), /permission denied/);
  });
  await t.test("revocation and site changes take effect immediately; inactive sites reject creation", async () => {
    await as(admin);
    await db.query("update profiles set is_logistics_contact=false where id=$1", [contact]);
    await as(contact); assert.equal((await db.query("select * from logistics_requests")).rows.length, 0);
    await as(admin);
    await db.query("update profiles set headquarters_id=$1 where id=$2", [otherSite, author]);
    await db.query("update headquarters set is_active=false where id=$1", [otherSite]);
    await assert.rejects(create(otherSite), /row-level security/);
    await as(author); assert.equal((await db.query("select * from logistics_requests")).rows.length, 0);
    await as(otherContact); await assert.rejects(create(otherSite), /row-level security/);
    assert.equal((await change(foreign.id, "accepted")).length, 1);
    await as(admin);
    await db.query("update profiles set is_active=false where id=$1", [otherContact]);
    await as(otherContact); assert.equal((await db.query("select * from logistics_requests")).rows.length, 0);
    assert.deepEqual(await change(foreign.id, "preparing", "accepted"), []);
  });
  await t.test("article references preserve snapshots and reject cross-site or forged references", async () => {
    await db.exec("reset role");
    const previous = (await db.query("select id,material from logistics_requests order by id")).rows;
    await db.exec(sql("supabase/migrations/202609150001_request_articles.sql"));
    assert.deepEqual((await db.query("select id,material from logistics_requests order by id")).rows, previous);
    assert.ok((await db.query("select item_id from logistics_requests")).rows.every(row => row.item_id === null));
    await as(admin);
    const article = (await db.query("insert into inventory_items(name,slug,category,headquarters_id,unit) values('Brocas SDS','brocas-sds','tool',$1,'uds') returning id", [site])).rows[0].id;
    const foreignArticle = (await db.query("insert into inventory_items(name,slug,category,headquarters_id) values('Brocas otra sede','brocas-otra','tool',$1) returning id", [otherSite])).rows[0].id;
    const linked = () => db.query("insert into logistics_requests(headquarters_id,item_id,material,quantity,unit) values($1,$2,'Nombre falso',2,'Unidad falsa') returning *", [site,article]);
    for (const user of [admin, peer, contact]) {
      await as(user);
      const request = (await linked()).rows[0];
      assert.equal(request.item_id, article);
      assert.equal(request.material, 'Brocas SDS');
      assert.equal(request.unit, 'uds');
      await assert.rejects(db.query("update logistics_requests set item_id=$1 where id=$2", [foreignArticle, request.id]), /permission denied/);
      for (const id of [foreignArticle, '11111111-1111-4111-8111-111111111111']) {
        await assert.rejects(db.query("insert into logistics_requests(headquarters_id,item_id,material,quantity,unit) values($1,$2,'Brocas',1,'uds')", [site,id]), /no disponible/);
      }
    }
    for (const user of [inactive, noSite]) {
      await as(user); await assert.rejects(linked(), /no disponible/);
    }
    await as(admin);
    await db.query("update inventory_items set name='Brocas renombradas' where id=$1", [article]);
    assert.ok((await db.query("select material from logistics_requests where item_id=$1", [article])).rows.every(row => row.material === 'Brocas SDS'));
    await assert.rejects(db.query("delete from inventory_items where id=$1", [article]), /foreign key/);
  });
});
