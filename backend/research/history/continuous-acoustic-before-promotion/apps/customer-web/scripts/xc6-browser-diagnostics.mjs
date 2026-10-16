// Full attribution for the unchanged XC5 bounded synthetic engineering smoke.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { ROOT,APP,WORK,hash,newJson,requireRemoteFreeze } from './xc6-evidence.mjs';
import { launchXc1Browser,collectWebGpuAdapter } from '../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';

export async function attachDiagnostics(page){
  const rows=[],scripts=[],jobs=[],contexts=new Map(),requests=[];
  const at=()=>new Date().toISOString();
  page.on('console',m=>{
    const row={kind:'playwright-console',type:m.type(),timestamp:at(),text:m.text(),location:m.location(),pageUrl:page.url()};rows.push(row);
    jobs.push(Promise.all(m.args().map(a=>a.evaluate(v=>v instanceof Error?{message:v.message,stack:v.stack}:null).catch(()=>null))).then(args=>row.errorArguments=args));
  });
  page.on('pageerror',e=>rows.push({kind:'pageerror',type:'error',timestamp:at(),message:e.message,stack:e.stack,pageUrl:page.url()}));
  page.on('worker',w=>rows.push({kind:'worker-created',timestamp:at(),url:w.url()}));
  page.on('requestfailed',r=>requests.push({timestamp:at(),url:r.url(),type:r.resourceType(),failure:r.failure()}));
  page.on('response',r=>{if(r.status()>=400)requests.push({timestamp:at(),url:r.url(),status:r.status(),type:r.request().resourceType()});});
  const cdp=await page.context().newCDPSession(page),pending=new Map();let sequence=0;
  function childSend(sessionId,method,params={}){
    const id=++sequence;return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP_CHILD_TIMEOUT:'+method));},3000);
      pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});
      cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
    });
  }
  const captured=new Set();
  async function captureSources(stack,send,origin){
    for(const frame of stack?.callFrames??[]){
      const key=origin+':'+frame.scriptId;if(captured.has(key))continue;captured.add(key);
      try{
        const {scriptSource}=await send('Debugger.getScriptSource',{scriptId:frame.scriptId});
        const lines=scriptSource.split('\n'),line=frame.lineNumber??0;
        scripts.push({origin,scriptId:frame.scriptId,url:frame.url,functionName:frame.functionName,
          sha256:hash(scriptSource),bytes:Buffer.byteLength(scriptSource),lineNumber:line,
          relevantSource:lines.slice(Math.max(0,line-2),line+3).join('\n').slice(0,12000),
          shortScriptSource:scriptSource.length<=12000?scriptSource:undefined});
      }catch(e){scripts.push({origin,scriptId:frame.scriptId,error:String(e)});}
    }
    if(stack?.parent)await captureSources(stack.parent,send,origin);
  }
  function event(origin,method,params,send){
    if(method==='Runtime.executionContextCreated')contexts.set(origin+':'+params.context.id,params.context);
    if(['Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded'].includes(method)){
      rows.push({kind:'cdp',origin,method,timestamp:at(),params});
      if(JSON.stringify(params).includes('window is not defined'))jobs.push(captureSources(params.stackTrace??params.exceptionDetails?.stackTrace,send,origin));
    }
  }
  for(const method of ['Runtime.consoleAPICalled','Runtime.exceptionThrown','Runtime.executionContextCreated','Log.entryAdded'])cdp.on(method,p=>event('page',method,p,(m,p)=>cdp.send(m,p)));
  cdp.on('Target.attachedToTarget',p=>{
    rows.push({kind:'cdp-target',timestamp:at(),...p});
    jobs.push((async()=>{try{
      await childSend(p.sessionId,'Runtime.enable');await childSend(p.sessionId,'Debugger.enable');
    }finally{await childSend(p.sessionId,'Runtime.runIfWaitingForDebugger').catch(()=>{});}})().catch(e=>rows.push({kind:'diagnostic-attachment-error',timestamp:at(),error:String(e)})));
  });
  cdp.on('Target.receivedMessageFromTarget',p=>{
    const message=JSON.parse(p.message);
    if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}}
    else event('worker:'+p.sessionId,message.method,message.params,(m,v)=>childSend(p.sessionId,m,v));
  });
  await cdp.send('Runtime.enable');await cdp.send('Debugger.enable');await cdp.send('Log.enable');
  await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:false});
  return{rows,scripts,requests,async finish(){await Promise.allSettled(jobs);return{rows,scripts,requests,contexts:[...contexts.values()]};}};
}

export async function buildDiagnostic(){
  const work=path.join(WORK,'diagnostics');await mkdir(work,{recursive:true});
  const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  for(const [entry,out]of[['scripts/xc5-smoke-entry.ts','entry.js'],['src/lib/practice/acoustic-inference/xc4-robust-worker.entry.ts','worker.js']])
    await esbuild.build({entryPoints:[path.join(APP,entry)],outfile:path.join(work,out),bundle:true,format:'esm',platform:'browser',target:'es2022',sourcemap:'inline',logLevel:'silent',nodePaths:[path.join(APP,'node_modules')]});
  return work;
}

export async function runDiagnostic(){
  const proof=await requireRemoteFreeze('diagnostics'),work=await buildDiagnostic();
  await newJson(path.join(work,'remote_freeze_proof.json'),proof);
  const model=path.join(ROOT,'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx');
  const bytes=await readFile(model);if(bytes.length!==98689283||hash(bytes)!=='4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3')throw new Error('MODEL_DRIFT');
  const requests=[],files=new Map([['/entry.js',path.join(work,'entry.js')],['/worker.js',path.join(work,'worker.js')],['/model.onnx',model],['/fir.f32',path.join(APP,'public/engineering/xc4/fir-160-441.f32')]]);
  const server=createServer((req,res)=>{
    const url=req.url?.split('?')[0];requests.push({url,timestamp:new Date().toISOString()});
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>XC6 diagnostics</title><script type="module" src="/entry.js"></script>');return;}
    const f=files.get(url)??(/^\/ort-wasm-[\w.-]+\.(mjs|wasm)$/.test(url)?path.join(APP,'node_modules/onnxruntime-web/dist',url.slice(1)):null);
    if(!f){res.statusCode=403;res.end('AUDIO_ONLY');return;}
    res.setHeader('Content-Type',f.endsWith('.wasm')?'application/wasm':/\.(js|mjs)$/.test(f)?'text/javascript':'application/octet-stream');
    createReadStream(f).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,diagnostics;
  try{
    const launched=await launchXc1Browser({channel:'chrome',headed:true});browser=launched.browser;
    const page=await browser.newPage();diagnostics=await attachDiagnostics(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await collectWebGpuAdapter(page);
    await page.waitForFunction(()=>typeof window.runXc5Smoke==='function');
    const startedAt=new Date().toISOString(),result=await page.evaluate(()=>window.runXc5Smoke());
    const logs=await diagnostics.finish();
    await newJson(path.join(work,'reproduction.json'),{phase:proof.phase,proof,startedAt,result,browser:launched.identity,diagnostics:logs,serverRequests:requests});
    console.log(JSON.stringify({status:result.status,actualSessionRunCount:result.actualSessionRunCount,referenceErrorRows:logs.rows.filter(r=>JSON.stringify(r).includes('window is not defined')).length,sourceExcerpts:logs.scripts}));
  }catch(error){await newJson(path.join(work,'failure.json'),{proof,error:String(error.stack??error),diagnostics:await diagnostics?.finish()});throw error;}
  finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  if(process.argv.includes('--build-only'))await buildDiagnostic();else await runDiagnostic();
}
