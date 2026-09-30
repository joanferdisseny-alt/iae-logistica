const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const zxing=require('@zxing/library');
const helperModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/barcode-camera.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:helperModule,exports:helperModule.exports});
const cameraHelper=helperModule.exports;

function harness(getMedia,options={}) {
  const hooks=[],effects=[],listeners=new Map(),timers=new Map(),constraints=[],adjustments=[];let index=0,tree,decode,reads=[],stopped=0,decoderStops=0,timerId=0,hints,readerOptions;
  const track={stop:()=>stopped++,getCapabilities:()=>options.capabilities||{},getSettings:()=>({zoom:1}),applyConstraints:async value=>{adjustments.push(value);if(options.adjustError)throw Error('unsupported');}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const preview={srcObject:null,readyState:2,play:async()=>{}};
  const document={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const slot=initial=>{const i=index++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return hooks[i];};
  const react={
    useState:initial=>{const h=slot(initial);return[h.value,value=>{h.value=typeof value==='function'?value(h.value):value;}];},
    useRef:initial=>slot(()=>({current:initial})).value,
    useEffect:(fn,deps)=>{const h=slot(null);if(!h.deps||deps.some((v,i)=>v!==h.deps[i])){h.deps=deps;effects.push(()=>{h.cleanup?.();h.cleanup=fn();});}}
  };
  const module={exports:{}};
  const reader={BrowserMultiFormatReader:class {constructor(h,o){hints=h;readerOptions=o;}async decodeFromStream(s,video,callback){assert.equal(s,stream);assert.ok(video);decode=callback;return options.controlsPromise||{stop:()=>decoderStops++};}}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/dashboard/receiving/scanner.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {module,exports:module.exports,document,window:{BarcodeDetector:options.detector},
      setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
      navigator:{mediaDevices:{getUserMedia:value=>{constraints.push(value);return getMedia?getMedia(stream):Promise.resolve(stream);},enumerateDevices:async()=>options.cameras||[]}},
      require:n=>n==='react'?react:n==='@zxing/browser'?reader:n==='@/lib/barcode-camera'?cameraHelper:require(n)});
  const all=node=>!node||typeof node!=='object'?[]:[node,...(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).flatMap(all)];
  const render=()=>{index=0;tree=module.exports.BarcodeScanner({mode:options.mode,onRead:code=>reads.push(code)});const video=all(tree).find(n=>n.type==='video');if(video)video.props.ref.current=preview;while(effects.length)effects.shift()();return tree;};
  const click=()=>{all(tree).find(n=>n.type==='button').props.onClick();render();};
  render();
  return {render,click,stream,reads,constraints,adjustments,preview,options,get hints(){return hints;},get readerOptions(){return readerOptions;},get decoderStops(){return decoderStops;},get timerCount(){return timers.size;},
    tick:async ms=>{const entry=[...timers].find(([,t])=>t.ms===ms);assert.ok(entry,`Missing ${ms}ms timer`);timers.delete(entry[0]);await entry[1].fn();await flush();},
    get stopped(){return stopped;},get nodes(){return all(tree);},get hasDecoder(){return !!decode;},
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

test('rear HD camera, continuous focus and fast targeted decoder are requested without microphone',async()=>{
  const h=harness(undefined,{capabilities:{focusMode:['continuous']}});h.click();await flush();
  const c=h.constraints[0];assert.equal(c.audio,false);assert.equal(c.video.facingMode.ideal,'environment');assert.equal(c.video.width.ideal,1920);assert.equal(c.video.height.ideal,1080);assert.equal(c.video.frameRate.ideal,30);
  assert.equal(h.adjustments[0].advanced[0].focusMode,'continuous');
  assert.equal(h.readerOptions.delayBetweenScanAttempts,120);assert.equal(h.hints.get(zxing.DecodeHintType.TRY_HARDER),true);
  const formats=h.hints.get(zxing.DecodeHintType.POSSIBLE_FORMATS);assert.ok(formats.includes(zxing.BarcodeFormat.EAN_13));assert.ok(formats.includes(zxing.BarcodeFormat.CODE_128));assert.ok(!formats.includes(undefined));assert.ok(!formats.includes(zxing.BarcodeFormat.QR_CODE));h.unmount();
});

test('checklists use QR-only decoding and preserve complete URLs',async()=>{
  const h=harness(undefined,{mode:'qr'});h.click();await flush();
  assert.deepEqual(Array.from(h.hints.get(zxing.DecodeHintType.POSSIBLE_FORMATS)),[zxing.BarcodeFormat.QR_CODE]);
  const url='https://example.test/dashboard/stock/000123';h.emit(url);h.render();assert.deepEqual(h.reads,[url]);assert.equal(h.preview.srcObject,null);assert.equal(h.timerCount,0);h.unmount();
  assert.match(fs.readFileSync('app/dashboard/checklists/scan-return.tsx','utf8'),/<BarcodeScanner mode="qr"/);
});

function detector(detect,supported=Object.values(cameraHelper.scanFormats).flat()) {
  return class {static async getSupportedFormats(){return supported;}constructor({formats}){this.formats=formats;}detect(video){assert.equal(video.readyState,2);return detect(this.formats);}};
}

test('native decoder returns one unmodified barcode and clears watchdog',async()=>{
  const h=harness(undefined,{detector:detector(async formats=>{assert.ok(formats.includes('ean_13'));return[{rawValue:'0012345678905'}];})});
  h.click();await flush();h.render();assert.deepEqual(h.reads,['0012345678905']);assert.equal(h.hasDecoder,false);assert.equal(h.timerCount,0);assert.ok(h.stopped);h.unmount();
});

test('partial or broken native support uses ZXing immediately',async()=>{
  for(const ctor of [detector(async()=>[],['qr_code']),class {static async getSupportedFormats(){throw Error('unsupported');}}]) {
    const h=harness(undefined,{detector:ctor});h.click();await flush();assert.equal(h.hasDecoder,true);assert.equal(h.timerCount,0);h.unmount();
  }
});

test('native decoder failing repeatedly switches to ZXing without reopening camera',async()=>{
  const h=harness(undefined,{detector:detector(async()=>{throw Error('decode');})});h.click();await flush();
  await h.tick(100);await h.tick(100);assert.equal(h.hasDecoder,true);assert.equal(h.constraints.length,1);assert.equal(h.timerCount,0);h.unmount();
});

test('native stall watchdog starts fallback and ignores late native result',async()=>{
  let resolve;const h=harness(undefined,{detector:detector(()=>new Promise(r=>{resolve=r;}))});h.click();await flush();
  await h.tick(8000);assert.equal(h.hasDecoder,true);resolve([{rawValue:'late'}]);await flush();assert.deepEqual(h.reads,[]);
  h.emit('correct');h.render();assert.deepEqual(h.reads,['correct']);assert.equal(h.timerCount,0);h.unmount();
});

test('native no-result watchdog takes over, and pending reads after close are ignored',async()=>{
  const h=harness(undefined,{detector:detector(async()=>[])});h.click();await flush();await h.tick(8000);assert.equal(h.hasDecoder,true);h.unmount();assert.equal(h.timerCount,0);
  let resolve;const closed=harness(undefined,{detector:detector(()=>new Promise(r=>{resolve=r;}))});closed.click();await flush();closed.click();resolve([{rawValue:'late'}]);await flush();assert.deepEqual(closed.reads,[]);assert.equal(closed.timerCount,0);closed.unmount();
});

test('camera controls appear only when supported; adjustment failure does not stop scanning',async()=>{
  const h=harness(undefined,{capabilities:{focusMode:['continuous'],torch:true,zoom:{min:1,max:10,step:0.1}},adjustError:true});h.click();await flush();h.render();
  assert.equal(h.hasDecoder,true);const zoom=h.nodes.find(n=>n.type==='input'&&n.props.type==='range');assert.ok(zoom);assert.equal(zoom.props.max,3);
  const torch=h.nodes.find(n=>n.type==='button'&&n.props['aria-pressed']===false);assert.ok(torch);torch.props.onClick();await flush();h.render();
  assert.ok(h.nodes.find(n=>n.props?.role==='alert'));assert.equal(h.stopped,0);h.unmount();
  const basic=harness();basic.click();await flush();basic.render();assert.equal(basic.nodes.some(n=>n.props?.type==='range'||n.props?.['aria-pressed']!==undefined),false);basic.unmount();
});

test('switching camera stops previous decoder and requests selected device',async()=>{
  const h=harness(undefined,{cameras:[{kind:'videoinput',deviceId:'rear',label:'Rear'},{kind:'videoinput',deviceId:'front',label:'Front'}]});h.click();await flush();h.render();
  h.nodes.find(n=>n.type==='select').props.onChange({target:{value:'front'}});assert.ok(h.stopped);h.render();await flush();
  assert.equal(h.constraints[1].video.deviceId.exact,'front');assert.ok(h.decoderStops);h.unmount();
});

test('controls arriving after close are stopped, without emitting results',async()=>{
  let resolve,stops=0;const h=harness(undefined,{controlsPromise:new Promise(r=>{resolve=r;})});h.click();await flush();h.click();resolve({stop:()=>stops++});await flush();assert.equal(stops,1);h.emit('late');assert.deepEqual(h.reads,[]);h.unmount();
});

test('configured ZXing decodes real EAN-13 pixels and checklist QR pixels',async()=>{
  const h=harness();h.click();await flush();
  // Independent EAN-13 fixture for 4006381333931, with quiet zones on both sides.
  const left=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const even=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const code='4006381333931';
  const bars='0'.repeat(12)+'101'+[...code.slice(1,7)].map((digit,i)=>('LGLLGG'[i]==='L'?left:even)[Number(digit)]).join('')+'01010'+[...code.slice(7)].map(digit=>left[Number(digit)].replace(/[01]/g,bit=>bit==='0'?'1':'0')).join('')+'101'+'0'.repeat(12);
  const width=bars.length*3,height=120,pixels=new Uint8ClampedArray(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*width+x]=bars[Math.floor(x/3)]==='1'?0:255;
  const reader=new zxing.MultiFormatReader();reader.setHints(h.hints);
  assert.equal(reader.decodeWithState(new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(pixels,width,height)))).getText(),code);
  h.unmount();

  const qr=harness(undefined,{mode:'qr'});qr.click();await flush();
  const url='https://example.test/dashboard/stock/000123';
  const matrix=require('qrcode').create(url).modules;
  const qrWidth=(matrix.size+8)*4,qrPixels=new Uint8ClampedArray(qrWidth*qrWidth).fill(255);
  for(let y=0;y<qrWidth;y++)for(let x=0;x<qrWidth;x++){
    const row=Math.floor(y/4)-4,col=Math.floor(x/4)-4;
    if(row>=0&&col>=0&&row<matrix.size&&col<matrix.size&&matrix.get(row,col))qrPixels[y*qrWidth+x]=0;
  }
  const qrReader=new zxing.MultiFormatReader();qrReader.setHints(qr.hints);
  assert.equal(qrReader.decodeWithState(new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(qrPixels,qrWidth,qrWidth)))).getText(),url);
  qr.unmount();
});
