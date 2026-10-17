import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ROOT,APP,MODEL,WORK,ID,verify,newJson,hash,fileIdentity} from './protocol.mjs';
import {RUNTIME_NODE_MODULES,resolveBrandedBrowserExecutable} from '../../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
const proof=await verify();
const engineering=JSON.parse(await readFile(path.join(ROOT,`backend/data/work/continuous_controller/${ID}/browser.json`),'utf8'));
if(engineering.status!=='PASS')throw new Error('ENGINEERING_REGRESSION_NOT_PASS');
const audio=JSON.parse(await readFile(path.join(ROOT,'backend/data/work/product_completion_replay/v1/audio_only/manifest.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
for(const [entry,out] of [['scripts/continuous-product-replay/entry.ts','entry.js'],['scripts/continuous-product-replay/controller-entry.ts','controller.js'],['src/lib/practice/acoustic-inference/continuous/acoustic-worker.entry.ts','worker.js']]){
  await esbuild.build({entryPoints:[path.join(APP,entry)],outfile:path.join(WORK,out),bundle:true,format:'esm',platform:'browser',target:'es2022',
    define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'ort',setup(b){b.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}],nodePaths:[path.join(APP,'node_modules')]});
}
const files=new Map([['/entry.js',path.join(WORK,'entry.js')],['/controller.js',path.join(WORK,'controller.js')],['/worker.js',path.join(WORK,'worker.js')],['/model.onnx',path.join(ROOT,MODEL)],
  ['/fir-44100.f32',path.join(APP,'public/model-assets/continuous/fir-160-441.f32')],['/fir-48000.f32',path.join(APP,'public/model-assets/continuous/fir-1-3.f32')]]);
const cells=audio.clips.flatMap(c=>[44100,48000].map(rate=>({id:c.id,rate,durationMs:c.durationMs,url:`/pcm/${c.id}/${rate}`,file:c.pcm[rate].path})));
for(const rate of [44100,48000]){const file=path.join(WORK,`silence_${rate}.f32`);await writeFile(file,new Uint8Array(Math.round(4.1*rate)*4),{flag:'wx'});cells.push({id:'silence',rate,durationMs:1800,url:`/pcm/silence/${rate}`,file:path.relative(ROOT,file)});}
for(const c of cells)files.set(c.url,path.join(ROOT,c.file));
const requests=[];
const server=createServer((req,res)=>{
  const url=req.url?.split('?')[0];requests.push(url);res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="module" src="/entry.js"></script>');return;}
  if(url==='/controller'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="module" src="/controller.js"></script>');return;}
  if(url==='/favicon.ico'){res.statusCode=204;res.end();return;}
  const file=files.get(url)??(/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url)?path.join(APP,'node_modules/onnxruntime-web/dist',path.basename(url)):null);
  if(!file){res.statusCode=403;res.end();return;}res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream');createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url),{chromium}=require(path.join(RUNTIME_NODE_MODULES,'playwright'));
let browser,controllerResult=null,failedWitness=null;const results=[],diagnostics=[];const startedAt=new Date().toISOString();let failure=null;
try{
  browser=await chromium.launch({executablePath:resolveBrandedBrowserExecutable('chrome'),headless:false});
  for(const c of cells){const context=await browser.newContext(),page=await context.newPage();
    page.on('pageerror',e=>diagnostics.push({id:c.id,rate:c.rate,type:'pageerror',message:e.message,stack:e.stack}));
    page.on('worker',w=>diagnostics.push({id:c.id,rate:c.rate,type:'worker-created',url:w.url()}));
    try{await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>typeof window.runProductReplay==='function');
      const result=await page.evaluate(c=>window.runProductReplay(c),{id:c.id,rate:c.rate,durationMs:c.durationMs,url:c.url});
      results.push(result);console.log('PASS',c.id,c.rate,result.actualModelRuns);
    }finally{await context.close();}
  }
  const context=await browser.newContext(),page=await context.newPage();
  try{await page.goto(`http://127.0.0.1:${server.address().port}/controller`);await page.waitForFunction(()=>typeof window.runMusicalControllerReplay==='function');
    controllerResult=await page.evaluate(urls=>window.runMusicalControllerReplay(urls),Object.fromEntries(cells.filter(c=>c.id===audio.clips[0].id).map(c=>[c.rate,c.url])));console.log('PASS musical production controller',controllerResult.actualModelRuns);
  }finally{await context.close();}
}catch(e){failure=String(e.stack??e);const first=failure.split('\n')[0],index=first.indexOf('{');if(index>=0){try{failedWitness=JSON.parse(first.slice(index));}catch{}}process.exitCode=1;}finally{
  const browserVersion=browser?await browser.version():null;await browser?.close();await new Promise(r=>server.close(r));
  await newJson(path.join(WORK,'musical.json'),{proof,startedAt,completedAt:new Date().toISOString(),browserVersion,results,diagnostics,requests,failure,
    controllerResult,failedWitness,status:failure?'BLOCKED':'PASS',actualModelRuns:results.reduce((n,r)=>n+r.actualModelRuns,0)+(controllerResult?.actualModelRuns??0)+(failedWitness?.actualModelRuns??0),countComplete:failure===null});
  if(!failure)await newJson(path.join(WORK,'acoustic_seal.json'),{status:'ACOUSTIC_PREDICTIONS_SEALED',sealedAt:new Date().toISOString(),files:[await fileIdentity(path.relative(ROOT,path.join(WORK,'musical.json')))],sha256:hash(await readFile(path.join(WORK,'musical.json')))});
}
