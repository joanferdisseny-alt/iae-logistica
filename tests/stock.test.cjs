const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file,mocks={}) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync('app/dashboard/inventory/'+file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
  }).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name)});
  return module.exports;
}
const model=load('stock-model.ts');
const id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const values={requestId:id,itemId:id,operation:'transfer',sourceId:other,expectedQuantity:'8',lotId:'',destination:'container',containerId:other,locationId:'',quantity:'1,125',notes:'Reposicion caja',lotCode:'',expirationDate:''};
const form=extra=>{const f=new FormData();for(const [k,v] of Object.entries({...values,...extra})) f.set(k,v);return f;};
function harness(options={}) {
  const calls=[],paths=[];
  const action=load('stock-actions.ts',{
    './stock-model':model,
    '@/lib/auth/context':{requireAccess:async()=>({isAdmin:options.admin??true,supabase:{rpc:async(name,args)=>{
      calls.push({name,args:JSON.parse(JSON.stringify(args))}); if(options.throw) throw new Error('offline');return {error:options.error};
    }}})},
    'next/cache':{revalidatePath:(...args)=>paths.push(args)}
  }).manageStock;
  return {action,calls,paths};
}
test('stock validation requires source, destination, lot data and exact nonnegative decimals',()=>{
  assert.equal(model.stockSchema.parse(values).quantity,'1.125');
  for(const changes of [{sourceId:''},{containerId:''},{quantity:'-1'},{quantity:'1.0001'},{quantity:'1e3'},
    {quantity:'NaN'},{quantity:'0'},{quantity:'100000000000'},{requestId:'bad'},{notes:' '},
    {operation:'new_lot',lotCode:''},{operation:'new_lot',lotCode:'A',expirationDate:'2026-02-30'},
    {operation:'in',lotId:''}]) assert.equal(model.stockSchema.safeParse({...values,...changes}).success,false,JSON.stringify(changes));
  assert.equal(model.stockSchema.safeParse({...values,operation:'adjustment',quantity:'0',destination:'none',containerId:''}).success,true);
});
test('stock actions preserve decimal strings, idempotency and source quantity; disregard irrelevant destinations',async()=>{
  const h=harness(); assert.ok((await h.action(form({}))).success);
  assert.equal(h.calls[0].name,'manage_inventory_stock');
  assert.equal(h.calls[0].args.p_quantity,'1.125'); assert.equal(h.calls[0].args.p_expected_quantity,'8');
  assert.equal(h.calls[0].args.p_request_id,id); assert.equal(h.calls[0].args.p_location_id,null);
  const out=harness(); await out.action(form({operation:'out',locationId:other}));
  assert.equal(out.calls[0].args.p_container_id,null); assert.equal(out.calls[0].args.p_location_id,null);
  assert.equal(out.calls[0].args.p_lot_id,null);
});
test('readers cannot mutate, transport errors retain requests, and validation errors never call SQL',async()=>{
  const reader=harness({admin:false}); assert.ok((await reader.action(form({}))).error); assert.equal(reader.calls.length,0);
  const invalid=harness(); assert.ok((await invalid.action(form({quantity:'invalid'}))).error); assert.equal(invalid.calls.length,0);
  for(const options of [{throw:true},{error:{code:'PGRST000'}}]) {
    const h=harness(options); assert.equal((await h.action(form({}))).retry,true); assert.equal(h.paths.length,0);
  }
  const missing=harness({error:{code:'PGRST202'}}); assert.match((await missing.action(form({}))).error,/upgrade-distributed-stock/);
  const changed=harness({error:{code:'P0001',message:'La cantidad ha cambiado'}}); assert.match((await changed.action(form({}))).error,/ha cambiado/);
});
