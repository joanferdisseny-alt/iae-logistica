const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    Date, FormData, TextDecoder, Uint8Array, AbortSignal, ...globals });
  return module.exports;
}
const model = load('lib/inventory/product-source.ts');
const id = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const source = { provider: 'upcitemdb', code: '3017620422003', fetchedAt: '2026-09-16T10:00:00.000Z', reviewed: true };

test('legacy retries preserve provenance while new manual creation uses the original zero-stock RPC', async () => {
  const calls = [];
  let error = null;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id, code: 'tool', category_code: 'tool', inventory_template_fields: [{ is_required: true, inventory_fields: { field_key: 'item_name', field_type: 'text', options: [] } }] } }) };
  const actions = load('app/dashboard/actions.ts', {
    'next/cache': { revalidatePath: () => {} }, '@/lib/supabase/server': {}, '@/lib/supabase/admin': {},
    '@/lib/inventory/product-source': model, '@/lib/inventory/validation': load('lib/inventory/validation.ts'),
    '@/lib/auth/context': { requireAccess: async () => ({ roleCode: 'editor', user: { id }, profile: { headquarters_id: id }, supabase: { from: () => query, rpc: async (name, args) => { calls.push({ name, args }); return { data: error ? null : id, error }; } } }) }
  });
  const form = new FormData(); for (const [key, value] of Object.entries({ templateCode: 'tool', headquartersId: foreign, receivingId: id, templateField_item_name: 'Brocas', productSource: JSON.stringify(source) })) form.set(key, value);
  assert.equal((await actions.createInventoryItem(undefined, form)).itemId, id);
  assert.equal(calls[0].name, 'create_inventory_record_from_product'); assert.equal(calls[0].args.p_record.current_stock, 0);
  assert.equal(calls[0].args.p_record.headquarters_id, id); assert.equal(calls[0].args.p_source.code, source.code);
  error = { code: 'PGRST202', message: 'Missing migration' };
  assert.match((await actions.createInventoryItem(undefined, form)).error, /upgrade-product-research/);
  form.set('productSource', JSON.stringify({ ...source, reviewed: false }));
  assert.match((await actions.createInventoryItem(undefined, form)).error, /fuente/); assert.equal(calls.length, 2);
  form.delete('productSource'); error = null;
  assert.equal((await actions.createInventoryItem(undefined, form)).itemId, id); assert.equal(calls.at(-1).name, 'create_inventory_record_once');
});

function hooks() {
  const slots = [], effects = []; let index = 0;
  const slot = initial => { const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return slots[i]; };
  const react = {
    useState: initial => { const h = slot(initial); return [h.value, value => { h.value = typeof value === 'function' ? value(h.value) : value; }]; },
    useRef: initial => slot(() => ({ current: initial })).value,
    useEffect: (fn, deps) => { const h = slot(null); if (!h.deps || deps.some((v, i) => v !== h.deps[i])) { h.deps = deps; effects.push(() => { h.cleanup?.(); h.cleanup = fn(); }); } },
    useActionState: (fn, initial) => { const h = slot(initial); return [h.value, async form => { h.value = await fn(h.value, form); return h.value; }, false]; }
  };
  return { react, render: (Component, props) => { index = 0; const tree = Component(props); while (effects.length) effects.shift()(); return tree; }, unmount: () => slots.forEach(h => h.cleanup?.()) };
}
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];

test('manual creation only renders configured fields and preserves exact payload after uncertain response', async () => {
  const ui = hooks(), saved = new Map(), calls = [], created = [];
  let fail = true;
  const module = load('app/dashboard/inventory/create-item-form.tsx', {
    react: ui.react, '../checklists/id': { newChecklistId: () => id },
    '@/app/dashboard/actions': { createInventoryItem: async (_, form) => { calls.push([...form.entries()]); if (fail) throw Error('offline'); return { itemId: id, itemName: 'Brocas' }; } }
  }, { sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } });
  const props = { canChooseHeadquarters: false, containers: [], locations: [], headquarters: [], userHeadquartersId: id,
    templates: [{ code: 'tool', category: 'tool', fields: [{ key: 'item_name', label: 'Nombre', type: 'text' }] }, { code: 'other', category: 'tool', fields: [{ key: 'item_name', label: 'Nombre', type: 'text' }] }],
    onCreated: (...args) => created.push(args), draftKey: 'pending' };
  let tree = ui.render(module.CreateInventoryItemForm, props);
  assert.equal(all(tree).find(n => n.props?.name === 'templateField_item_name').props.defaultValue, undefined);
  assert.equal(all(tree).some(n => n.props?.name === 'templateField_current_stock'), false);
  const form = new FormData(); form.set('templateField_item_name', 'Corrección manual');
  await tree.props.action(form); tree = ui.render(module.CreateInventoryItemForm, props);
  assert.equal(all(tree).find(n => n.type === 'fieldset').props.disabled, true); assert.ok(saved.has('pending'));
  fail = false; await tree.props.action(new FormData());
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].some(([key]) => key === 'templateField_current_stock'), false);
  assert.equal(created.length, 1); assert.equal(saved.has('pending'), false);
  all(tree).find(n => n.props?.name === 'templateCodeSelector').props.onChange({ target: { value: 'other' } }); tree = ui.render(module.CreateInventoryItemForm, props);
  assert.equal(all(tree).find(n => n.props?.name === 'templateField_item_name').props.defaultValue, undefined);
  assert.equal(all(tree).some(n => n.props?.name === 'productSource'), false);
});

test('internet lookup UI and network modules are removed, legacy sources remain strictly validated', () => {
  for (const file of ['app/dashboard/receiving/product-research-action.ts','app/dashboard/receiving/product-research.tsx','lib/inventory/product-research-server.ts']) assert.equal(fs.existsSync(file),false);
  const receiving=fs.readFileSync('app/dashboard/receiving/receiving.tsx','utf8');
  assert.doesNotMatch(receiving,/ProductResearch|Buscar producto en internet|initialProductDraft|google.com/);
  assert.match(receiving,/Buscar código/); assert.match(receiving,/Crear artículo nuevo/); assert.match(receiving,/Solicitar catalogación/);
  assert.equal(model.productSourceSchema.safeParse(source).success,true);
  for(const changes of [{code:'3017620422004'},{reviewed:false},{url:'javascript:alert(1)'}]) assert.equal(model.productSourceSchema.safeParse({...source,...changes}).success,false);
  assert.match(model.productSourceUrl(source.provider,source.code),/^https:\/\/www\.upcitemdb\.com\/upc\/3017620422003$/);
});

test('restoring a pre-removal pending submission retains source and id instead of creating a different article', async () => {
  const ui=hooks(), saved=new Map(), calls=[];
  const entries=[['receivingId',id],['templateCode','tool'],['templateField_item_name','Pending article'],['productSource',JSON.stringify(source)]];
  saved.set('pending',JSON.stringify(entries));
  const module=load('app/dashboard/inventory/create-item-form.tsx',{
    react:ui.react,'../checklists/id':{newChecklistId:()=>{throw Error('Should reuse saved id');}},
    '@/app/dashboard/actions':{createInventoryItem:async(_,form)=>{calls.push([...form.entries()]);return {itemId:id,itemName:'Pending article'};}}
  },{sessionStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)}});
  const props={canChooseHeadquarters:false,containers:[],locations:[],headquarters:[],userHeadquartersId:id,
    templates:[{code:'tool',category:'tool',fields:[{key:'item_name',label:'Nombre',type:'text'}]}],onCreated:()=>{},draftKey:'pending'};
  ui.render(module.CreateInventoryItemForm,props);
  const tree=ui.render(module.CreateInventoryItemForm,props);
  assert.equal(all(tree).find(n=>n.type==='fieldset').props.disabled,true);
  assert.equal(all(tree).some(n=>n.props?.name==='productSource'),false);
  await tree.props.action(new FormData());
  assert.equal(JSON.stringify(calls[0]),JSON.stringify(entries));
  assert.equal(saved.has('pending'),false);
});
