const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, "..", "app/dashboard/requests", file);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name) }, { filename });
  return module.exports;
}
const model = load("model.ts");
const site = "11111111-1111-4111-8111-111111111111";
const otherSite = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
function form(values = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ headquartersId: site, material: "Guantes", quantity: "1.125", unit: "cajas", notes: "", ...values })) data.set(key, value);
  return data;
}
function harness(options = {}) {
  const writes = [], filters = [], paths = [], reads = [];
  const builder = {
    insert(value) { writes.push(value); return this; },
    update(value) { writes.push(value); return this; },
    select() { return this; },
    eq(key, value) { filters.push([key, value]); return this; },
    ilike(key, value) { filters.push([key, value]); return this; },
    order() { return this; },
    limit(value) { reads.push(value); return this; },
    async returns() { return { data: options.articles ?? [], error: options.error }; },
    async single() { return { data: { id: requestId }, error: options.error }; },
    async maybeSingle() { return { data: options.stale ? null : { id: requestId }, error: options.error }; }
  };
  const actions = load("actions.ts", {
    "./model": model,
    "@/lib/auth/context": { requireAccess: async () => {
      if (options.inactive) throw new Error("INACTIVE");
      return { supabase: { from: (table) => {
        reads.push(table);
        if (table === 'inventory_items') return { ...builder,
          async maybeSingle() { return { data: options.item ?? null, error: options.error }; }
        };
        return builder;
      } }, isAdmin: options.isAdmin ?? false, profile: { headquarters_id: options.noSite ? null : site } };
    } },
    "next/cache": { revalidatePath: (value) => paths.push(value) },
    "next/navigation": { redirect: (value) => { throw new Error(`REDIRECT:${value}`); } }
  });
  return { actions, writes, filters, paths, reads };
}

test("request quantities reject zero, excessive precision, non-finite and oversized values", () => {
  for (const quantity of ["0", "-1", "1.0001", "1e3", "NaN", "Infinity", "", "1000000000", "1,5"]) {
    assert.equal(model.createRequestSchema.safeParse(Object.fromEntries(form({ quantity }))).success, false, quantity);
  }
  for (const quantity of ["0.001", "1", "1.25", "999999999.999"]) {
    assert.equal(model.createRequestSchema.safeParse(Object.fromEntries(form({ quantity }))).success, true, quantity);
  }
  for (const values of [{ material: " " }, { unit: " " }, { notes: "x".repeat(2001) }, { headquartersId: "bad" }]) {
    assert.equal(model.createRequestSchema.safeParse(Object.fromEntries(form(values))).success, false);
  }
});

test("state machine has forward transitions, cancellation and no reopening", () => {
  for (const expectedStatus of model.requestStatuses) for (const status of model.requestStatuses) {
    assert.equal(model.changeStatusSchema.safeParse({ requestId, expectedStatus, status }).success,
      model.nextStatuses[expectedStatus].includes(status));
  }
  assert.deepEqual(Array.from(model.allowedStatuses("pending", false, true)), ["cancelled"]);
  assert.deepEqual(Array.from(model.allowedStatuses("accepted", false, true)), []);
  assert.deepEqual(Array.from(model.allowedStatuses("pending", false, false)), []);
  assert.deepEqual(Array.from(model.allowedStatuses("pending", true, false)), ["accepted", "cancelled"]);
});

test("non-admin creation ignores forged site and author; admin can choose another site", async () => {
  for (const isAdmin of [false, true]) {
    const h = harness({ isAdmin });
    await assert.rejects(h.actions.createRequest({}, form({ headquartersId: otherSite, created_by: requestId })), /REDIRECT/);
    assert.equal(h.writes[0].headquarters_id, isAdmin ? otherSite : site);
    assert.equal(h.writes[0].created_by, undefined);
    assert.equal(h.writes[0].status, undefined);
    assert.equal(h.writes[0].quantity, 1.125);
    assert.deepEqual(h.paths, ["/dashboard/requests"]);
  }
});

test("invalid input and inactive sessions cannot write", async () => {
  const h = harness();
  assert.ok((await h.actions.createRequest({}, form({ quantity: "-1" }))).error);
  assert.ok((await h.actions.changeRequestStatus({}, form({ requestId, expectedStatus: "completed", status: "pending" }))).error);
  assert.equal(h.writes.length, 0);
  const denied = harness({ inactive: true });
  await assert.rejects(denied.actions.createRequest({}, form()), /INACTIVE/);
  assert.equal(denied.writes.length, 0);
});

test("status writes only status and compares expected status to detect concurrency", async () => {
  const h = harness();
  assert.ok((await h.actions.changeRequestStatus({}, form({ requestId, expectedStatus: "pending", status: "accepted", headquarters_id: otherSite }))).success);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [{ status: "accepted" }]);
  assert.deepEqual(h.filters, [["id", requestId], ["status", "pending"]]);
  assert.deepEqual(h.paths, ["/dashboard/requests", `/dashboard/requests/${requestId}`]);
  for (const options of [{ stale: true }, { error: { code: "42501" } }]) {
    const denied = harness(options);
    assert.ok((await denied.actions.changeRequestStatus({}, form({ requestId, expectedStatus: "pending", status: "accepted" }))).error);
    assert.equal(denied.paths.length, 0);
  }
});

test("article search uses the permitted site, escapes wildcards and limits results", async () => {
  for (const isAdmin of [false,true]) {
    const h = harness({ isAdmin, articles: Array.from({ length:21 }, (_,i) => ({ id:String(i),name:'Broca' })) });
    const result = await h.actions.searchRequestArticles('Br%_', otherSite);
    assert.deepEqual(h.filters, [['headquarters_id',isAdmin ? otherSite : site], ['name','%Br\\%\\_%']]);
    assert.equal(result.articles.length,20);
    assert.equal(result.hasMore,true);
    assert.ok(h.reads.includes(21));
  }
  const h = harness();
  await h.actions.searchRequestArticles('a',site);
  assert.equal(h.reads.length,0);
  assert.ok((await harness({noSite:true}).actions.searchRequestArticles('Broca',site)).error);
  assert.ok((await harness({error:{code:'500'}}).actions.searchRequestArticles('Broca',site)).error);
});

test("creation saves a real reference and canonical material/unit, not forged labels", async () => {
  const h = harness({ item:{ id:requestId,name:'Brocas SDS',unit:'uds' } });
  await assert.rejects(h.actions.createRequest({},form({itemId:requestId,material:'Falso',unit:'falsa'})),/REDIRECT/);
  assert.equal(h.writes[0].item_id,requestId);
  assert.equal(h.writes[0].material,'Brocas SDS');
  assert.equal(h.writes[0].unit,'uds');
  assert.deepEqual(h.filters,[['id',requestId],['headquarters_id',site]]);
  for (const itemId of [requestId,'invalid']) {
    const denied = harness();
    assert.ok((await denied.actions.createRequest({},form({itemId}))).error);
    assert.equal(denied.writes.length,0);
  }
  const manual = harness();
  await assert.rejects(manual.actions.createRequest({},form()), /REDIRECT/);
  assert.equal(manual.writes[0].item_id,null);
});
