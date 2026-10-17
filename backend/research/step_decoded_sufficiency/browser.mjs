import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ROOT,APP,WORK,MODEL,verify,json,hash,portable} from './protocol.mjs';
import {RUNTIME_NODE_MODULES,resolveBrandedBrowserExecutable} from '../browser_runtime/xc1_browser_runtime_shared.mjs';
const acousticExecutionProof=await verify();
const verification=JSON.parse(await readFile(path.join(WORK,'static.json'),'utf8'));
if(verification.results.some(r=>r.status!==0))throw Error('STATIC_VERIFICATION_NOT_PASS');
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
for(const [entry,out] of [['backend/research/step_decoded_sufficiency/browser-entry.ts','entry.js'],
 ['apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts','worker.js']])await esbuild.build({entryPoints:[path.join(ROOT,entry)],outfile:path.join(WORK,out),bundle:true,format:'esm',platform:'browser',target:'es2022',
  define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'ort',setup(b){b.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}],nodePaths:[path.join(APP,'node_modules')]});
const {jobs}=JSON.parse(await readFile(path.join(WORK,'audio_only/jobs.json'),'utf8'));
const files=new Map([['/entry.js',path.join(WORK,'entry.js')],['/worker.js',path.join(WORK,'worker.js')],['/model.onnx',path.join(ROOT,MODEL)],
 ['/fir/44100',path.join(APP,'public/model-assets/practice-acoustic/fir-160-441.f32')],['/fir/48000',path.join(APP,'public/model-assets/practice-acoustic/fir-1-3.f32')]]);
for(const j of jobs)files.set(`/pcm/${j.id}/${j.rate}`,path.join(ROOT,j.path));
const requests=[],diagnostics=[];
const server=createServer((req,res)=>{
 const url=req.url?.split('?')[0];requests.push(url);res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="module" src="/entry.js"></script>');return;}
 if(url==='/favicon.ico'){res.statusCode=204;res.end();return;}
 const file=files.get(url)??(/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url)?path.join(APP,'node_modules/onnxruntime-web/dist',path.basename(url)):null);
 if(!file){res.statusCode=403;res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream');createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES,'playwright'));
let browser,result=null,failure=null,version=null;
try{
 browser=await chromium.launch({executablePath:resolveBrandedBrowserExecutable('chrome'),headless:false});version=await browser.version();
 const page=await browser.newPage();page.on('pageerror',e=>diagnostics.push({type:'pageerror',message:e.message,stack:e.stack}));
 page.on('worker',w=>diagnostics.push({type:'real-worker-created',url:w.url()}));
 page.on('console',m=>diagnostics.push({type:m.type(),message:m.text(),location:m.location()}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>typeof window.runDecodedAudioOnly==='function');
 result=await page.evaluate(jobs=>window.runDecodedAudioOnly(jobs),jobs.map(({path,...safe})=>safe));
}catch(error){failure=String(error.stack??error);process.exitCode=1;}
finally{
 await browser?.close();await new Promise(r=>server.close(r));
 const file=path.join(WORK,'acoustic.json');await json(file,{...acousticExecutionProof,acousticExecutionProof,browserVersion:version,
  result,requests,diagnostics,failure,completedAt:new Date().toISOString(),status:failure?'BLOCKED':'SEALED_AUDIO_ONLY'});
 await json(path.join(WORK,'acoustic-seal.json'),{...acousticExecutionProof,path:portable(file),sha256:hash(await readFile(file)),
  sealedAt:new Date().toISOString(),truthAvailableToStageA:false});
 console.log(JSON.stringify({status:failure?'BLOCKED':'SEALED_AUDIO_ONLY',actualModelRuns:result?.actualModelRuns,failure}));
}
