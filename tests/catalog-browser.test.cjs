const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  } }).outputText, { module, exports: module.exports, URLSearchParams, require: name => Object.hasOwn(mocks,name) ? mocks[name] : require(name) });
  return module.exports;
}
const model = load('lib/inventory/catalog-browser.ts');
const all = node => Array.isArray(node) ? node.flatMap(all) : !node || typeof node !== 'object' ? [] : [node, ...all(node.props?.children)];
const Link = ({ children, prefetch, ...props }) => React.createElement('a', { ...props, 'data-prefetch': String(prefetch) }, children);
const site = '11111111-1111-4111-8111-111111111111', foreign = '22222222-2222-4222-8222-222222222222';
const categories = [
  { code:'uniformity', name:'Uniformidad', parent_code:null },
  { code:'first', name:'Primera equipación', parent_code:'uniformity' },
  { code:'overalls', name:'Monos', parent_code:'first' },
  { code:'second', name:'Segunda equipación', parent_code:'uniformity' },
  { code:'tools', name:'Herramientas', parent_code:null },
  { code:'empty', name:'Sin artículos', parent_code:null }
];
const product = { id:'mono', name:'MONO', search_text:'MONO M L', category:'overalls', headquarters_id:site,
  current_stock:10, unit:'unidades', status:'ok', is_size_group:true, size_count:2,
  variants:[{id:'m',size:'M',quantity:10},{id:'l',size:'L',quantity:0}] };

test('catalogue tree is ordered, retains empty/orphan categories and reflects moves without mutation', () => {
  const original = JSON.stringify(categories);
  const nodes = model.catalogCategoryNodes(categories);
  assert.equal(nodes[0].code,'tools');
  assert.equal(nodes.find(n=>n.code==='overalls').path,'Uniformidad / Primera equipación / Monos');
  assert.deepEqual(Array.from(nodes.find(n=>n.code==='overalls').ancestors),['uniformity','first']);
  assert.ok(nodes.some(n=>n.code==='empty'));
  const moved = model.catalogCategoryNodes(categories.map(c=>c.code==='first'?{...c,parent_code:'tools'}:c));
  assert.equal(moved.find(n=>n.code==='overalls').path,'Herramientas / Primera equipación / Monos');
  assert.equal(JSON.stringify(categories), original);
  assert.equal(model.catalogCategoryNodes([{code:'orphan',name:'Orphan',parent_code:'missing'}])[0].ancestors.length,0);
  assert.throws(()=>model.catalogCategoryNodes([{code:'a',name:'A',parent_code:'b'},{code:'b',name:'B',parent_code:'a'}]),/Jerarquía/);
});

test('catalogue URLs safely encode names and preserve filters without carrying stale pages into categories', () => {
  assert.equal(model.catalogHref(),'/dashboard/catalog');
  const href=model.catalogHref({category:'cat & one',q:'taladro+broca',headquarters:site,page:2});
  const url=new URL(href,'https://local.invalid');
  assert.equal(url.searchParams.get('category'),'cat & one'); assert.equal(url.searchParams.get('q'),'taladro+broca');
  assert.equal(url.searchParams.get('headquarters'),site); assert.equal(url.searchParams.get('page'),'2');
  assert.doesNotMatch(model.catalogHref({category:'tools',page:1}),/page=/);
});

test('category tree expands the current path, has mobile controls and shows categories with no articles', () => {
  const states = []; let index = 0;
  const { CategoryTree } = load('app/dashboard/catalog/category-tree.tsx', {
    'next/link': Link,
    '@/lib/inventory/catalog-browser': model,
    react: { ...React, useId: ()=>'tree', useState: initial => {
      const current=index++; if (!(current in states)) states[current]=initial;
      return [states[current],value=>{states[current]=typeof value==='function'?value(states[current]):value;}];
    } }
  });
  const render=()=>{index=0;return CategoryTree({nodes:model.catalogCategoryNodes(categories),filters:{category:'first',headquarters:site}});};
  let tree=render(),html=renderToStaticMarkup(tree);
  assert.match(html,/Monos/); assert.match(html,/Sin artículos/); assert.match(html,/aria-current="page"[^>]*title="Uniformidad \/ Primera equipación"/);
  all(tree).find(n=>n.type==='button'&&n.props['aria-controls']==='tree').props.onClick();
  tree=render(); assert.match(renderToStaticMarkup(tree),/ec-catalog-tree-panel is-open/);
  all(tree).find(n=>n.type==='button'&&n.props['aria-label']==='Subcategorías de Primera equipación').props.onClick();
  assert.doesNotMatch(renderToStaticMarkup(render()),/>Monos</);
});

function harness({role='admin',active=true,rows={},failTable,failAfterPage,overflow=false}={}) {
  const calls=[];
  const data={inventory_categories:categories,headquarters:[{id:site,name:'Valencia'},{id:foreign,name:'Navarra'}],inventory_catalog_items:[product,{...product,id:'other-site',headquarters_id:foreign}],...rows};
  const context={isAdmin:role==='admin',profile:{is_active:active,headquarters_id:site},supabase:{from(table){
    const call={table,filters:[],orders:[],from:0,to:499,head:false}; calls.push(call);
    const result=()=>{
      if (table===failTable && (!failAfterPage || call.from>=500)) return {data:null,count:null,error:{code:'OFFLINE'}};
      let list=data[table]??[];
      for (const [op,key,value] of call.filters) {
        if(op==='eq')list=list.filter(row=>row[key]===value);
        if(op==='in')list=list.filter(row=>value.includes(row[key]));
        if(op==='ilike')list=list.filter(row=>row[key].toLowerCase().includes(value.slice(1,-1).toLowerCase()));
      }
      list=[...list].sort((a,b)=>{for(const key of call.orders){const compared=String(a[key]).localeCompare(String(b[key]));if(compared)return compared;}return 0;});
      if(overflow&&!call.head&&table==='inventory_catalog_items'&&call.from>=list.length)return {data:null,count:null,error:{code:'PGRST103'}};
      return {data:call.head?null:list.slice(call.from,call.to+1),count:list.length,error:null};
    };
    const query={select(_columns,options){call.head=Boolean(options?.head);return query;},order(key){call.orders.push(key);return query;},
      range(from,to){call.from=from;call.to=to;return query;},returns:async()=>result(),then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)};
    for(const op of ['eq','in','ilike'])query[op]=(key,value)=>{call.filters.push([op,key,value]);return query;};
    return query;
  }}};
  const page=load('app/dashboard/catalog/page.tsx',{
    'next/link':Link,'next/navigation':{redirect:href=>{throw Error('REDIRECT:'+href);}},
    '@/lib/auth/context':{requireAccess:async()=>{if(role==='volunteer')throw Error('REDIRECT:/dashboard/personal');return context;}},
    '@/lib/read-all':load('lib/read-all.ts'), '@/lib/inventory/categories':load('lib/inventory/categories.ts'),
    '@/lib/inventory/catalog-browser':model,'@/lib/inventory/size-catalog':load('lib/inventory/size-catalog.ts'),
    './category-tree':{CategoryTree:()=>null}
  }).default;
  return {calls,page:params=>page({searchParams:Promise.resolve(params??{})})};
}

test('catalogue follows the full branch, keeps grouped sizes and opens existing article/QR URLs',async()=>{
  const h=harness({rows:{inventory_catalog_items:[product,{...product,id:'sibling',category:'second',name:'POLO'}]}});
  const html=renderToStaticMarkup(await h.page({category:'first'}));
  assert.match(html,/Uniformidad/);assert.match(html,/Primera equipación/);assert.match(html,/Monos/);assert.match(html,/1–1 de 1 artículos/);
  assert.match(html,/M: 10 · L: 0/);assert.match(html,/href="\/dashboard\/inventory\/mono"/);assert.doesNotMatch(html,/>POLO</);
  assert.deepEqual(Array.from(h.calls.find(c=>c.table==='inventory_catalog_items').filters.find(f=>f[0]==='in')[2]),['first','overalls']);
  assert.equal(h.calls.length,3,'No per-category count, stock, attachment or template queries');
});

test('search and pagination cover every product, retain filters and never load the entire stock catalogue',async()=>{
  const products=Array.from({length:260},(_,i)=>({...product,id:String(i),name:i===259?'Producto especial':'MONO '+i,search_text:i===259?'Producto especial':'MONO '+i}));
  const search=harness({rows:{inventory_catalog_items:products}});
  const html=renderToStaticMarkup(await search.page({q:'Producto especial'}));
  assert.match(html,/1–1 de 1 artículos/);assert.match(html,/Producto especial/);
  const h=harness({rows:{inventory_catalog_items:products}});
  const tree=await h.page({q:'MONO',category:'uniformity',headquarters:site,page:'2'});
  const query=h.calls.find(c=>c.table==='inventory_catalog_items');assert.equal(query.from,50);assert.equal(query.to,99);
  const next=all(tree).find(n=>n.props?.rel==='next').props.href;
  const params=new URL(next,'https://local.invalid').searchParams;
  assert.deepEqual(Object.fromEntries(params),{category:'uniformity',q:'MONO',headquarters:site,page:'3'});
});

test('non-admins cannot change site via URL, volunteers cannot enter, and inactive profiles query nothing',async()=>{
  for(const role of ['reader','editor']){
    const h=harness({role}); const html=renderToStaticMarkup(await h.page({headquarters:foreign}));
    assert.match(html,/1–1 de 1 artículos/);assert.doesNotMatch(html,/Navarra|name="headquarters"/);
    assert.ok(h.calls.find(c=>c.table==='inventory_catalog_items').filters.some(([op,key,value])=>op==='eq'&&key==='headquarters_id'&&value===site));
  }
  const volunteer=harness({role:'volunteer'});await assert.rejects(volunteer.page(),/REDIRECT/);assert.equal(volunteer.calls.length,0);
  const inactive=harness({active:false});assert.match(renderToStaticMarkup(await inactive.page()),/perfil activo/);assert.equal(inactive.calls.length,0);
});

test('empty categories are visible and invalid/deleted filters and partial reads fail explicitly',async()=>{
  const empty=harness({rows:{inventory_catalog_items:[]}});
  assert.match(renderToStaticMarkup(await empty.page()),/Sin artículos/);
  assert.match(renderToStaticMarkup(await empty.page({category:'empty'})),/Todavía no hay artículos/);
  assert.match(renderToStaticMarkup(await harness().page({category:'deleted'})),/ya no existe/);
  assert.match(renderToStaticMarkup(await harness().page({headquarters:'invalid'})),/no es válida/);
  for(const failTable of ['inventory_categories','headquarters','inventory_catalog_items'])assert.match(renderToStaticMarkup(await harness({failTable}).page()),/role="alert"/);
  const many=Array.from({length:501},(_,i)=>({code:'category'+i,name:'Categoría '+i,parent_code:null}));
  const complete=harness({rows:{inventory_categories:many}});await complete.page();
  assert.ok(complete.calls.some(c=>c.table==='inventory_categories'&&c.from===500));
  const fail=harness({rows:{inventory_categories:many},failTable:'inventory_categories',failAfterPage:true});
  assert.match(renderToStaticMarkup(await fail.page()),/no se muestra un catálogo parcial/);
  assert.ok(!fail.calls.some(c=>c.table==='inventory_catalog_items'));
});

test('stale page offsets recover the last page using the same search, branch and site',async()=>{
  for(const overflow of [false,true]){
    const h=harness({overflow});
    await assert.rejects(h.page({page:'8',category:'first',q:'MONO',headquarters:site}),error=>{
      assert.ok(error.message.startsWith('REDIRECT:'));
      const params=new URL(error.message.slice(9),'https://local.invalid').searchParams;
      assert.equal(params.get('category'),'first');assert.equal(params.get('q'),'MONO');assert.equal(params.get('headquarters'),site);
      assert.equal(params.get('page'),null);return true;
    });
  }
});
