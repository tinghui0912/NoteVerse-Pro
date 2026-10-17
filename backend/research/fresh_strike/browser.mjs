import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ROOT,WORK,MODEL,verify,json,hash,portableRelative} from './protocol.mjs';
import {RUNTIME_NODE_MODULES,resolveBrandedBrowserExecutable} from '../browser_runtime/xc1_browser_runtime_shared.mjs';
const developmentExecutionProof=await verify();
const app=path.join(ROOT,'apps/customer-web');
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(ROOT,'backend/research/fresh_strike/browser-entry.mjs')],outfile:path.join(WORK,'entry.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',
  plugins:[{name:'ort',setup(b){b.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}],nodePaths:[path.join(app,'node_modules')]});
const {jobs}=JSON.parse(await readFile(path.join(WORK,'development/audio_only/jobs.json'),'utf8'));
// An explicit route allow-list is the truth isolation boundary. No filesystem route.
const files=new Map([['/entry.js',path.join(WORK,'entry.js')],['/model.onnx',path.join(ROOT,MODEL)],
  ['/fir/44100',path.join(app,'public/model-assets/practice-acoustic/fir-160-441.f32')],['/fir/48000',path.join(app,'public/model-assets/practice-acoustic/fir-1-3.f32')]]);
for(const job of jobs)files.set(`/pcm/${job.id}/${job.rate}`,path.join(ROOT,job.path));
const requests=[],diagnostics=[];
const server=createServer((req,res)=>{
  const url=req.url?.split('?')[0];requests.push(url);
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="module" src="/entry.js"></script>');return;}
  if(url==='/favicon.ico'){res.statusCode=204;res.end();return;}
  const file=files.get(url)??(/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url)?path.join(app,'node_modules/onnxruntime-web/dist',path.basename(url)):null);
  if(!file){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream');
  createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES,'playwright'));
let browser,result=null,failure=null,version=null;
try{
  browser=await chromium.launch({executablePath:resolveBrandedBrowserExecutable('chrome'),headless:false});version=await browser.version();
  const page=await browser.newPage();page.on('pageerror',e=>diagnostics.push({type:'pageerror',message:e.message,stack:e.stack}));
  page.on('console',m=>diagnostics.push({type:m.type(),message:m.text(),location:m.location()}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>typeof window.executeAudioOnly==='function');
  result=await page.evaluate(jobs=>window.executeAudioOnly(jobs),jobs.map(({path,...safe})=>safe));
  for(const cell of result.results){
    const pcm=new Float32Array(cell.baselinePcm);delete cell.baselinePcm;
    const file=path.join(WORK,`development/audio_only/${cell.id}-${cell.rate}-target.f32`);
    await writeFile(file,new Uint8Array(pcm.buffer),{flag:'wx'});
    cell.baselinePcm={path:portableRelative(file),sha256:hash(new Uint8Array(pcm.buffer))};
  }
}catch(error){failure=String(error.stack??error);process.exitCode=1;}
finally{
  await browser?.close();await new Promise(r=>server.close(r));
  const artifact={...developmentExecutionProof,developmentExecutionProof,browserVersion:version,completedAt:new Date().toISOString(),
    status:failure?'BLOCKED':'AUDIO_ONLY_BROWSER_EXECUTION_SEALED',result,requests,diagnostics,failure};
  const file=path.join(WORK,'development/browser.json');await json(file,artifact);
  await json(path.join(WORK,'development/browser-seal.json'),{...developmentExecutionProof,path:portableRelative(file),sha256:hash(await readFile(file)),
    sealedAt:new Date().toISOString(),truthOpenedByStageA:false});
  console.log(JSON.stringify({status:artifact.status,actualModelRuns:result?.actualSessionRunCount,failure}));
}
