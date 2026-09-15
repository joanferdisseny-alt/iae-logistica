const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, "../app/dashboard/checklists", file);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, crypto: require("node:crypto").webcrypto,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) }, { filename });
  return module.exports;
}
const model = load("model.ts");
const id = "11111111-1111-4111-8111-111111111111";
const box = "22222222-2222-4222-8222-222222222222";
const valid = { id, containerId: box, eventType: "practice", eventName: "Simulacro", eventDate: "2026-09-15", teamName: "Equipo 1" };
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function harness(options = {}) {
  const calls = [], paths = [];
  const actions = load("actions.ts", {
    "./model": model,
    "@/lib/auth/context": { requireAccess: async () => {
      if (options.inactive) throw new Error("INACTIVE");
      return { supabase: { rpc: async (name, args) => {
        calls.push([name, JSON.parse(JSON.stringify(args))]);
        return { data: id, error: options.error ?? null };
      } } };
    } },
    "next/cache": { revalidatePath: (...args) => paths.push(args) },
    "next/navigation": { redirect: target => { throw new Error(`REDIRECT:${target}`); } }
  });
  return { actions, calls, paths };
}

test("creation rejects invalid dates/ids and sends only activity inputs to the authoritative snapshot RPC", async () => {
  const h = harness();
  for (const values of [{ eventDate: "2026-02-30" }, { eventDate: "2026-13-01" }, { id: "bad" }, { eventType: "other" }, { eventName: " " }]) {
    assert.ok((await h.actions.createChecklist({}, form({ ...valid, ...values }))).error);
  }
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.actions.createChecklist({}, form({ ...valid, created_by: box, headquarters_id: id, expected_quantity: "999" })), /REDIRECT/);
  assert.deepEqual(h.calls[0], ["create_container_checklist", { p_id: id, p_container_id: box, p_event_type: "practice", p_event_name: "Simulacro", p_event_date: "2026-09-15", p_team_name: "Equipo 1" }]);
});

test("line validation rejects missing revision, invalid quantities and undocumented issues", async () => {
  for (const quantity of ["", "-1", "1.0001", "1e2", "NaN", "Infinity", "100000000000"]) {
    const h = harness();
    assert.ok((await h.actions.saveChecklistLine({}, form({ lineId: id, revision: "0", result: "missing", quantity, notes: "Faltan piezas" }))).error);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  assert.ok((await h.actions.saveChecklistLine({}, form({ lineId: id, result: "ok" }))).error);
  assert.ok((await h.actions.saveChecklistLine({}, form({ lineId: id, revision: "0", result: "damaged", quantity: "1", notes: " " }))).error);
  assert.equal(h.calls.length, 0);
  await h.actions.saveChecklistLine({}, form({ lineId: id, revision: "3", result: "missing", quantity: "1.125", notes: "Faltan piezas" }));
  assert.deepEqual(h.calls[0], ["save_checklist_item", { p_line_id: id, p_revision: 3, p_result: "missing", p_quantity: 1.125, p_notes: "Faltan piezas" }]);
});

test("quick confirmation lets SQL supply the full expected quantity and clears stale incident notes", async () => {
  const h = harness();
  assert.ok((await h.actions.saveChecklistLine({}, form({ lineId: id, revision: "2", result: "damaged", quantity: "bad", notes: "Old issue", intent: "ok" }))).success);
  assert.deepEqual(h.calls[0], ["save_checklist_item", { p_line_id: id, p_revision: 2, p_result: "ok", p_quantity: null, p_notes: "" }]);
});

test("closure cannot forge the result and requires notes for unreturned boxes and cancellations", async () => {
  const h = harness();
  for (const values of [{}, { boxReturned: "on", intent: "cancel" }]) {
    assert.ok((await h.actions.closeChecklist({}, form({ id, ...values }))).error);
  }
  assert.equal(h.calls.length, 0);
  await h.actions.closeChecklist({}, form({ id, boxReturned: "on", status: "complete", closed_by: box }));
  assert.deepEqual(h.calls[0], ["close_container_checklist", { p_id: id, p_box_returned: true, p_summary: "", p_cancel: false }]);
});

test("all actions authenticate first and database failures do not report success or revalidate", async () => {
  for (const name of ["createChecklist", "saveChecklistLine", "closeChecklist"]) {
    const h = harness({ inactive: true });
    await assert.rejects(h.actions[name]({}, form(valid)), /INACTIVE/);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ error: { code: "40001", message: "Recarga antes de guardar" } });
  assert.equal((await h.actions.saveChecklistLine({}, form({ lineId: id, revision: "0", intent: "ok" }))).error, "Recarga antes de guardar");
  assert.equal(h.paths.length, 0);
  assert.match(model.checklistError({ code: "PGRST202" }), /upgrade-checklists/);
});

test("progress counts pending separately from incident checks and IDs are unique UUID v4", () => {
  const progress = model.checklistProgress(["pending", "ok", "missing", "consumed"].map(result => ({ result })));
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), { total: 4, checked: 3, issues: 2 });
  const ids = Array.from({ length: 100 }, () => load("id.ts").newChecklistId());
  assert.equal(new Set(ids).size, 100);
  for (const value of ids) assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
