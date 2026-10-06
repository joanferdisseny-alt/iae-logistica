const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file=path.resolve(file);
  if(cache.has(file)) return cache.get(file);
  const mod={exports:{}};
  const localRequire=id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id);
  new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(localRequire,mod,mod.exports);
  cache.set(file,mod.exports); return mod.exports;
}
const { readInventoryFile, mapInventoryImport }=load('lib/inventory/import.ts');
const { suggestImportColumns }=load('lib/inventory/import-model.ts');
const read=text=>readInventoryFile(Buffer.from(text),'stock.csv');
const map=table=>mapInventoryImport(table,suggestImportColumns(table.headers,[]));

test('general importer reads semicolon, comma and tab with quoted delimiters and preserves SKU zeros',async()=>{
  for(const delimiter of [';',',','\t']){
    const table=await read(['SKU','Nombre','Cantidad','Categoria','Medida'].join(delimiter)+'\n'+['0000456','"Broca; fina, 8mm"','"2,5"','Fungibles','8'].join(delimiter));
    assert.equal(table.headers.length,5);
    const p=map(table); assert.equal(p.rows[0].sku,'0000456'); assert.equal(p.rows[0].quantity,'2.5');
    assert.deepEqual(p.rows[0].specs,{medida:'8'}); assert.deepEqual(p.rows[0].category,['Fungibles']);
  }
});
test('general importer maps reusable fields, typed values and multi-level category paths',()=>{
  const table={headers:['Nombre','Cantidad','Categoria','Subcategoria','Diámetro','Disponible','Caducidad'],rows:[['Broca','0','Material','Fungibles > Brocas','8,5','sí','2027-12-31']]};
  const columns=suggestImportColumns(table.headers,[{key:'diameter',label:'Diámetro',type:'number'},{key:'available',label:'Disponible',type:'boolean'}]);
  const p=mapInventoryImport(table,columns);
  assert.deepEqual(p.rows[0].category,['Material','Fungibles','Brocas']);
  assert.equal(p.rows[0].quantity,'0'); assert.deepEqual(p.rows[0].specs,{diameter:'8.5',available:'true'});
  assert.equal(p.rows[0].expiration_date,'2027-12-31');
  const minimal=map({headers:['SKU','Cantidad'],rows:[['BR-8','1']]});
  assert.equal(minimal.rows[0].sku,'BR-8'); assert.deepEqual(minimal.rows[0].category,[]);
});
test('general importer requires explicit quantities, strict numbers and valid dates',async()=>{
  for(const quantity of ['', '-1','1.000,5','1.0000','1000001','1e2','=1+1','Infinity']){
    const table={headers:['Nombre','Cantidad'],rows:[['Broca',quantity]]};
    assert.throws(()=>map(table),/cantidad|número/);
  }
  for(const expiry of ['31/12/2027','2027-02-30','invalid']) assert.throws(()=>map({headers:['Nombre','Cantidad','Caducidad'],rows:[['Comida','1',expiry]]}),/fecha/);
  assert.throws(()=>map({headers:['Nombre','Cantidad','ID'],rows:[['Taladro','1','1234']]}),/UUID/);
  assert.throws(()=>map({headers:['Nombre','Cantidad','Categoria','Subcategoria'],rows:[['Taladro','1','Material','Fungibles > > Brocas']]}),/categorías/);
});
test('general importer blocks duplicate mappings, reserved keys, missing columns and invalid field definitions',()=>{
  const table={headers:['Nombre','Cantidad','Diámetro'],rows:[['Broca','1','8']]};
  const cols=suggestImportColumns(table.headers,[]);
  assert.throws(()=>mapInventoryImport(table,[cols[0],cols[1],{...cols[2],target:'name'}]),/Dos columnas/);
  assert.throws(()=>mapInventoryImport(table,[cols[0],cols[1],{...cols[2],key:'current_stock'}]),/reservada/);
  assert.throws(()=>mapInventoryImport(table,[cols[0],cols[1],{...cols[2],key:'1bad'}]),/Clave/);
  assert.throws(()=>mapInventoryImport(table,cols.slice(1)),/columnas/);
  assert.throws(()=>map({headers:['Nombre'],rows:[['Broca']]}),/cantidad/);
  assert.throws(()=>map({headers:['Cantidad','Categoria'],rows:[['2','Material']]}),/nombre/);
  const ignored=mapInventoryImport(table,[cols[0],cols[1],{...cols[2],target:'ignore'}]);
  assert.deepEqual(ignored.rows[0].specs,{});
});
test('general importer enforces whole-file limits without silently truncating rows',async()=>{
  await assert.rejects(read('Nombre;Cantidad\n'+Array.from({length:501},(_,i)=>'Item '+i+';1').join('\n')),/500/);
  await assert.rejects(read('Nombre;Nombre\nA;B'),/repetirse/);
  await assert.rejects(readInventoryFile(Buffer.from([255]),'stock.csv'));
  await assert.rejects(readInventoryFile(Buffer.from('invalid'),'stock.xlsm'),/CSV/);
  await assert.rejects(readInventoryFile(Buffer.alloc(1_000_001),'stock.csv'),/1 MB/);
});
test('general example includes different product families and never positive stock',async()=>{
  const table=await readInventoryFile(fs.readFileSync('public/plantilla-inventario.csv'),'example.csv');
  const p=map(table); assert.equal(p.rows.length,4); assert.ok(p.rows.every(r=>r.quantity==='0'));
  assert.equal(new Set(p.rows.map(r=>r.category[0])).size,3);
});
