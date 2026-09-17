const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");

const itemId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const headquartersId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const root = path.resolve(__dirname, "..");

// Execute the real TS modules with local auth/database doubles, without a Next server or remote data.
function load(relative, mocks) {
  const filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    URL, Date, FormData, console
  }, { filename });
  return module.exports;
}

function form(values) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

const movement = (overrides = {}) => form({ itemId, requestId, type: "in", quantity: "1.5", notes: "Replenishment", ...overrides });
const edit = (overrides = {}) => form({
  itemId, name: "Pump", description: "", status: "inspection", maintenanceDueAt: "2028-02-29",
  expirationDate: "", minimumStock: "0,125", notes: "Inspection scheduled", ...overrides
});
const attachment = (overrides = {}) => form({ itemId, title: "Manual", url: "https://example.org/manual.pdf", ...overrides });

function harness(options = {}) {
  const calls = [];
  const revalidated = [];
  const revalidationScopes = [];
  const queries = [];
  const item = {
    id: itemId, headquarters_id: headquartersId, name: "Pump", category: "tool", subtype: null,
    description: null, current_stock: 4.25, minimum_stock: 1, unit: "l", status: "ok",
    operational_status: "available", expiration_date: null, maintenance_due_at: null,
    technical_specs: {}, location_id: null, locations: null, inventory_templates: null
  };
  const supabase = {
    from(table) {
      const query = { table, filters: [], select: "" };
      queries.push(query);
      const builder = {
        select(value) { query.select = value; return builder; },
        eq(...args) { query.filters.push(["eq", ...args]); return builder; },
        neq(...args) { query.filters.push(["neq", ...args]); return builder; },
        in(...args) { query.filters.push(["in", ...args]); return builder; },
        or(...args) { query.filters.push(["or", ...args]); return builder; },
        order() { return builder; },
        range(...args) { query.range = args; return builder; },
        async maybeSingle() {
          return { data: table === "inventory_items" && !options.missingItem ? item : null, error: null };
        },
        async returns() {
          return { data: options.rows?.[table] ?? [], error: options.queryErrors?.[table] ?? null };
        },
        async insert(values) {
          calls.push({ table, values });
          return { error: options.insertError ?? null };
        }
      };
      return builder;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (options.throwRpc) throw new Error("Transport failed");
      return { data: null, error: options.rpcError ?? null };
    }
  };
  const role = options.role ?? "admin";
  const context = { supabase, user: { id: userId }, profile: { headquarters_id: headquartersId }, roleCode: role, isAdmin: role === "admin" };
  const mocks = {
    "@/lib/auth/context": { requireAccess: async () => {
      if (options.accessError) throw options.accessError;
      return context;
    } },
    "next/cache": { revalidatePath: (url, scope) => { revalidated.push(url); revalidationScopes.push([url, scope]); } }
  };
  const actions = load("app/dashboard/inventory/operations.ts", mocks);
  const page = load("app/dashboard/inventory/[itemId]/page.tsx", {
    ...mocks,
    "@/lib/inventory/product-source": load("lib/inventory/product-source.ts", {}),
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "next/link": ({ children }) => children,
    "@/app/dashboard/inventory/add-relation-form": { AddRelationForm: () => null },
    "@/app/dashboard/inventory/document-form": { DocumentForm: () => null },
    "@/app/dashboard/inventory/stock-section": { StockSection: ({ itemId }) => `STOCK_DISTRIBUTION:${itemId}` },
    "@/app/dashboard/inventory/operations-form": { OperationsForm: () => "ADMIN_OPERATIONS" },
    "@/app/dashboard/qr-modal": { QrModal: () => null }
  }).default;
  return { actions, page, calls, queries, revalidated, revalidationScopes };
}

test("movement RPC receives exact decimals, reason and client request UUID", async () => {
  const h = harness();
  const result = await h.actions.recordMovement(undefined, movement({ quantity: " 99999999999,999 ", notes: "  Delivery  " }));
  assert.ok(result.success);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "record_inventory_movement", args: {
    p_item_id: itemId, p_type: "in", p_quantity: "99999999999.999", p_notes: "Delivery", p_request_id: requestId
  } }]);
  assert.deepEqual(h.revalidated, [`/dashboard/inventory/${itemId}`, "/dashboard/inventory", "/dashboard", "/dashboard/locations"]);
  assert.deepEqual(h.revalidationScopes.at(-1), ["/dashboard/locations", "layout"]);
});

test("adjustment sends final counted stock, including zero, not a delta", async () => {
  for (const quantity of ["0", "0.00", "2,75"]) {
    const h = harness();
    assert.ok((await h.actions.recordMovement(undefined, movement({ type: "adjustment", quantity }))).success);
    assert.equal(h.calls[0].args.p_quantity, quantity === "0.00" ? "0" : quantity.replace(",", "."));
    assert.equal(h.calls[0].args.p_type, "adjustment");
    assert.equal(h.calls.length, 1);
  }
});

test("invalid movements never call RPC", async () => {
  for (const overrides of [
    { quantity: "0" }, { quantity: "0,00", type: "out" }, { quantity: "-1" },
    { quantity: "1e3" }, { quantity: "NaN" }, { quantity: "Infinity" }, { quantity: "" },
    { quantity: "1,2.3" }, { quantity: "0.0001" }, { quantity: "100000000000" },
    { notes: "   " }, { notes: "ab" }, { requestId: "bad" }, { itemId: "bad" }, { type: "transfer" }
  ]) {
    const h = harness();
    const result = await h.actions.recordMovement(undefined, movement(overrides));
    assert.ok(result.error, JSON.stringify(overrides));
    assert.ok(result.fieldErrors);
    assert.equal(h.calls.length, 0);
  }
});

test("every mutation denies editor, reader and legacy non-admin roles before database access", async () => {
  for (const role of ["editor", "reader", "operator", "viewer"]) {
    for (const [name, data] of [["recordMovement", movement()], ["updateItem", edit()], ["addAttachment", attachment()]]) {
      const h = harness({ role });
      assert.match((await h.actions[name](undefined, data)).error, /administración/);
      assert.equal(h.queries.length, 0);
      assert.equal(h.calls.length, 0);
    }
  }
});

test("missing item and rejected access cannot mutate", async () => {
  const missing = harness({ missingItem: true });
  assert.ok((await missing.actions.recordMovement(undefined, movement())).error);
  assert.equal(missing.calls.length, 0);
  const denied = harness({ accessError: new Error("INACTIVE") });
  await assert.rejects(denied.actions.updateItem(undefined, edit()), /INACTIVE/);
  assert.equal(denied.calls.length, 0);
});

test("uncertain RPC errors preserve the request, while definitive rejection permits correction", async () => {
  for (const options of [{ throwRpc: true }, { rpcError: { code: "", message: "fetch failed" } }]) {
    const h = harness(options);
    const result = await h.actions.recordMovement(undefined, movement());
    assert.equal(result.retrySameRequest, true);
    await h.actions.recordMovement(undefined, movement());
    assert.equal(h.calls[0].args.p_request_id, h.calls[1].args.p_request_id);
    assert.equal(h.revalidated.length, 0);
  }
  const h = harness({ rpcError: { code: "P0001", message: "Stock insuficiente" } });
  const result = await h.actions.recordMovement(undefined, movement({ type: "out" }));
  assert.match(result.error, /Stock insuficiente/);
  assert.equal(result.retrySameRequest, false);
});

test("item RPC uses operational status and nullable dates, description and minimum", async () => {
  const h = harness();
  assert.ok((await h.actions.updateItem(undefined, edit())).success);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { name: "update_inventory_item", args: {
    p_item_id: itemId, p_name: "Pump", p_description: null, p_status: "inspection",
    p_maintenance_due_at: "2028-02-29", p_expiration_date: null, p_minimum_stock: "0.125", p_notes: "Inspection scheduled"
  } });
  assert.ok((await h.actions.updateItem(undefined, edit({ minimumStock: "", maintenanceDueAt: "" }))).success);
  assert.equal(h.calls[1].args.p_minimum_stock, null);
  assert.equal(h.calls[1].args.p_maintenance_due_at, null);
});

test("item edits reject invalid dates, stock, status and empty audit reason", async () => {
  for (const overrides of [
    { maintenanceDueAt: "2027-02-29" }, { expirationDate: "2026-04-31" }, { expirationDate: "0000-01-01" },
    { status: "ok" }, { minimumStock: "-1" }, { minimumStock: "0.0001" }, { name: " " }, { name: "A" }, { notes: " " }
  ]) {
    const h = harness();
    assert.ok((await h.actions.updateItem(undefined, edit(overrides))).fieldErrors);
    assert.equal(h.calls.length, 0);
  }
});

test("attachment stores only validated URL, title and authenticated author", async () => {
  const h = harness();
  assert.ok((await h.actions.addAttachment(undefined, attachment({ createdBy: "forged" }))).success);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ table: "inventory_attachments", values: {
    item_id: itemId, title: "Manual", url: "https://example.org/manual.pdf", created_by: userId
  } }]);
});

test("unsafe or relative attachment URLs cannot be inserted", async () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/manual.pdf", "//example.org/a", "/manual.pdf", "http://example.org/a", "https://user:secret@example.org/a", "not a url"]) {
    const h = harness();
    assert.ok((await h.actions.addAttachment(undefined, attachment({ url }))).fieldErrors?.url, url);
    assert.equal(h.calls.length, 0);
  }
});

test("read-only detail scopes the item by site and never loads option catalogues", async () => {
  for (const role of ["editor", "reader"]) {
    const h = harness({ role });
    const html = renderToStaticMarkup(await h.page({ params: Promise.resolve({ itemId }) }));
    assert.equal(h.queries.filter((query) => query.table === "inventory_items").length, 1);
    assert.ok(h.queries[0].filters.some((filter) => filter.join(":") === `eq:headquarters_id:${headquartersId}`));
    assert.ok(!h.queries.some((query) => ["locations", "inventory_containers"].includes(query.table)));
    assert.doesNotMatch(html, /ADMIN_OPERATIONS|PLACEMENT_STOCK/);
    assert.match(html, /Acceso de consulta/);
  }
});

test("admin detail scopes relations to the item site and includes the distributed stock section", async () => {
  const h = harness();
  const html = renderToStaticMarkup(await h.page({ params: Promise.resolve({ itemId }), searchParams: Promise.resolve({ historyPage: "2" }) }));
  for (const query of h.queries.filter((query) => ["locations", "inventory_containers"].includes(query.table) || query.filters.some((filter) => filter[0] === "neq"))) {
    assert.ok(query.filters.some((filter) => filter.join(":") === `or:headquarters_id.eq.${headquartersId}`));
  }
  assert.match(html, /ADMIN_OPERATIONS/);
  assert.match(html, /STOCK_DISTRIBUTION:/);
  for (const query of h.queries.filter((query) => ["inventory_movements", "inventory_item_history"].includes(query.table))) {
    assert.deepEqual(Array.from(query.range), [50, 100]);
  }
});

test("missing item stops detail loading before histories or option queries", async () => {
  const h = harness({ missingItem: true });
  await assert.rejects(h.page({ params: Promise.resolve({ itemId }) }), /NOT_FOUND/);
  assert.equal(h.queries.length, 1);
});

test("detail renders safe links only and reports history query failures", async () => {
  const h = harness({ role: "reader", rows: { inventory_attachments: [
    { id: "a", title: "Manual", url: "https://example.org/manual.pdf" },
    { id: "b", title: "Unsafe", url: "javascript:alert(1)" }
  ] }, queryErrors: { inventory_movements: { message: "Missing column" } } });
  const html = renderToStaticMarkup(await h.page({ params: Promise.resolve({ itemId }) }));
  assert.match(html, /href="https:\/\/example.org\/manual.pdf"/);
  assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /enlace no válido/);
  assert.match(html, /No se pudieron cargar los movimientos/);
});
