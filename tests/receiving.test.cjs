const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function load(file,mocks={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/dashboard/receiving/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:n=>Object.hasOwn(mocks,n)?mocks[n]:require(n)});return module.exports;}
const model=load('model.ts');const id='11111111-1111-4111-8111-111111111111';
const input={id,barcodeId:id,packs:'2',lotCode:'A',expiration:'2027-01-01',notes:'Compra',allocations:[{quantity:'1,125',location_id:id,container_id:null},{quantity:'8.875',location_id:null,container_id:id}]};
test('barcode strings preserve zeros; receipt decimals are exact and dates are validated',()=>{
  assert.equal(model.barcodeSchema.parse('0012345678905'),'0012345678905');
  for(const code of ['', 'bad code','x'.repeat(129),'abc\nxyz'])assert.equal(model.barcodeSchema.safeParse(code).success,false);
  assert.equal(model.milli('1,125')+model.milli('8.875'),10000n);assert.equal(model.decimal(10000n),'10.000');
  assert.equal(model.receiptSchema.parse(input).allocations[0].quantity,'1.125');
  for(const changes of [{packs:'1.5'},{packs:'0'},{expiration:'2026-02-30'},{notes:''},{allocations:[]},{allocations:[{quantity:'1',location_id:id,container_id:id}]},{allocations:[{quantity:'NaN',location_id:null,container_id:null}]}])assert.equal(model.receiptSchema.safeParse({...input,...changes}).success,false);
});
function harness({admin=true,error,throws=false}={}){const calls=[],paths=[];const actions=load('actions.ts',{'./model':model,'next/cache':{revalidatePath:(...v)=>paths.push(v)},'@/lib/auth/context':{requireAccess:async()=>({isAdmin:admin,profile:{headquarters_id:id},supabase:{rpc:async(name,args)=>{calls.push({name,args});if(throws)throw Error();return {data:id,error};}}})}});return {actions,calls,paths};}
test('server sends a single atomic receipt RPC and retains the client receipt identifier',async()=>{
  const h=harness();assert.ok((await h.actions.receiveBarcode(input)).success);assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'receive_inventory_barcode');assert.equal(h.calls[0].args.p_id,id);assert.equal(h.calls[0].args.p_allocations[0].quantity,'1.125');
});
test('permission and validation failures do not send stock mutations; uncertain errors preserve retry',async()=>{
  const reader=harness({admin:false});assert.ok((await reader.actions.receiveBarcode(input)).error);assert.ok((await reader.actions.linkBarcode({})).error);assert.equal(reader.calls.length,0);
  const invalid=harness();assert.ok((await invalid.actions.receiveBarcode({...input,packs:'bad'})).error);assert.equal(invalid.calls.length,0);
  for(const options of [{throws:true},{error:{code:'PGRST000'}}]){const h=harness(options);assert.equal((await h.actions.receiveBarcode(input)).retry,true);assert.equal(h.paths.length,0);}
  assert.match((await harness({error:{code:'PGRST202'}}).actions.receiveBarcode(input)).error,/upgrade-barcode-receiving/);
});
test('cataloging request uses the authenticated site and never posts stock',async()=>{
  const h=harness({admin:false});assert.ok((await h.actions.requestCataloging({id,site:'22222222-2222-4222-8222-222222222222',code:'0123',description:'Broca SDS nueva',packs:'1'})).requestId);
  assert.equal(h.calls[0].name,'request_barcode_cataloging');assert.equal(h.calls[0].args.p_site,id);
});
test('lookup searches exact code in the authenticated site and loads every position, not a truncated set',async()=>{
  const calls=[];const row={id,lot_id:id,quantity:1,inventory_stock_lots:{code:'A'},locations:null,inventory_containers:null};
  const barcode={id,item_id:id,inventory_items:{id,name:'Brocas'},inventory_variants:{brand:'A',model:''},units_per_pack:1};
  const actions=load('actions.ts',{'./model':model,'next/cache':{revalidatePath:()=>{}},'@/lib/auth/context':{requireAccess:async()=>({isAdmin:false,profile:{headquarters_id:id},supabase:{from:table=>{
    let offset=0;const q={select:()=>q,eq:(...args)=>{calls.push([table,'eq',...args]);return q;},gt:()=>q,order:()=>q,range:(from,to)=>{offset=from;calls.push([table,'range',from,to]);return q;},maybeSingle:async()=>({data:barcode,error:null}),returns:async()=>({data:offset===0?Array.from({length:500},()=>row):[row],error:null})};return q;
  }}})}});
  const result=await actions.lookupBarcode('0012345','22222222-2222-4222-8222-222222222222');
  assert.equal(result.positions.length,501);assert.ok(calls.some(c=>c[2]==='headquarters_id'&&c[3]===id));assert.ok(calls.some(c=>c[2]==='code'&&c[3]==='0012345'));
});
