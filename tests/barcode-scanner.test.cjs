const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');

function harness(getMedia) {
  const hooks=[],effects=[],listeners=new Map();let index=0,tree,decode,reads=[],stopped=0;
  const track={stop:()=>stopped++};const stream={getTracks:()=>[track]};
  const document={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const slot=initial=>{const i=index++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return hooks[i];};
  const react={
    useState:initial=>{const h=slot(initial);return[h.value,value=>{h.value=typeof value==='function'?value(h.value):value;}];},
    useRef:initial=>slot(()=>({current:initial})).value,
    useEffect:(fn,deps)=>{const h=slot(null);if(!h.deps||deps.some((v,i)=>v!==h.deps[i])){h.deps=deps;effects.push(()=>{h.cleanup?.();h.cleanup=fn();});}}
  };
  const module={exports:{}};
  const reader={BrowserMultiFormatReader:class {async decodeFromStream(s,video,callback){assert.equal(s,stream);assert.ok(video);decode=callback;return {stop:()=>{}};}}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/dashboard/receiving/scanner.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {module,exports:module.exports,document,navigator:{mediaDevices:{getUserMedia:()=>getMedia?getMedia(stream):Promise.resolve(stream)}},require:n=>n==='react'?react:n==='@zxing/browser'?reader:require(n)});
  const all=node=>!node||typeof node!=='object'?[]:[node,...(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).flatMap(all)];
  const render=()=>{index=0;tree=module.exports.BarcodeScanner({onRead:code=>reads.push(code)});const video=all(tree).find(n=>n.type==='video');if(video)video.props.ref.current={};while(effects.length)effects.shift()();return tree;};
  const click=()=>{all(tree).find(n=>n.type==='button').props.onClick();render();};
  render();
  return {render,click,stream,reads,get stopped(){return stopped;},get nodes(){return all(tree);},get hasDecoder(){return !!decode;},
    emit:code=>decode({getText:()=>code},null,{stop:()=>{}}),
    hide:()=>{document.hidden=true;listeners.get('visibilitychange')?.();render();},
    unmount:()=>hooks.forEach(h=>h.cleanup?.()),get listenerCount(){return listeners.size;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('scanner opens only on request, emits one result, and releases camera tracks',async()=>{
  const h=harness();assert.equal(h.hasDecoder,false);h.click();await flush();assert.equal(h.hasDecoder,true);
  h.emit('0012345');h.emit('0012345');h.render();assert.deepEqual(h.reads,['0012345']);assert.ok(h.stopped>0);assert.equal(h.nodes.some(n=>n.type==='video'),false);h.unmount();
});
test('closing while camera permission is pending releases a stream that arrives late',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));h.click();await flush();h.click();resolve(h.stream);await flush();
  assert.equal(h.hasDecoder,false);assert.ok(h.stopped>0);assert.equal(h.listenerCount,0);h.unmount();
});
test('hidden tabs and route unmount stop the camera; permission denial keeps manual fallback',async()=>{
  const hidden=harness();hidden.click();await flush();hidden.hide();assert.ok(hidden.stopped>0);assert.equal(hidden.listenerCount,0);
  const unmounted=harness();unmounted.click();await flush();unmounted.unmount();assert.ok(unmounted.stopped>0);assert.equal(unmounted.listenerCount,0);
  const denied=harness(()=>Promise.reject(Error('denied')));denied.click();await flush();denied.render();assert.ok(denied.nodes.find(n=>n.props?.role==='alert'));assert.equal(denied.nodes.some(n=>n.type==='video'),false);denied.unmount();
});
