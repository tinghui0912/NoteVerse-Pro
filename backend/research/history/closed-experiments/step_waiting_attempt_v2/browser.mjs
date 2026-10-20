import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,mkdir,chmod,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as protocol from '../../../apps/customer-web/scripts/step-waiting-attempt-v2/protocol.mjs';
import {resolveBrandedBrowserExecutable,RUNTIME_NODE_MODULES,collectWebGpuAdapter} from '../browser_runtime/xc1_browser_runtime_shared.mjs';
const {ROOT,APP,MODEL,DATA,paths,WORK,verify,newJson,fileIdentity,hash}=protocol;
const qualificationExecutionProof=await verify(),output=path.join(paths().work,'../holdout');
for(const file of [path.join(paths().work,'verification.json'),path.join(paths().work,'browser.json'),path.join(WORK,'parity.json')]){
 const prerequisite=JSON.parse(await readFile(file,'utf8'));
 if(prerequisite.status!=='PASS'||prerequisite.freezeCommit!==qualificationExecutionProof.freezeCommit)throw Error('PREREQUISITE_NOT_PASS:'+file);
}
await mkdir(output,{recursive:true});
// The only corpus file Stage A opens is the audio-only job manifest.
const jobs=JSON.parse(await readFile(path.join(DATA,'audio_only/jobs.json'),'utf8')).jobs;
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const bundleInputs=[];
for(const [entry,name] of [['backend/research/step_waiting_attempt_v2/audio-entry.ts','entry.js'],['apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts','worker.js']]){
 const build=await esbuild.build({entryPoints:[path.join(ROOT,entry)],outfile:path.join(output,name),bundle:true,metafile:true,
  format:'esm',platform:'browser',target:'es2022',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},
  plugins:[{name:'pinned-ort',setup(b){b.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}],nodePaths:[path.join(APP,'node_modules')]});
 bundleInputs.push(...Object.keys(build.metafile.inputs));
}
if(bundleInputs.some(p=>/step-runtime|step-practice|product-replay|truth\.json|fixture/i.test(p)))throw Error('STAGE_A_TRUTH_IMPORT');
const files=new Map([['/entry.js',path.join(output,'entry.js')],['/worker.js',path.join(output,'worker.js')],['/model.onnx',path.join(ROOT,MODEL)],
 ['/fir/44100',path.join(APP,'public/model-assets/practice-acoustic/fir-160-441.f32')],['/fir/48000',path.join(APP,'public/model-assets/practice-acoustic/fir-1-3.f32')]]);
for(const j of jobs)files.set(`/pcm/${j.id}/${j.rate}`,path.join(ROOT,j.path));
const requests=[],diagnostics=[];
const server=createServer((req,res)=>{
 const url=req.url?.split('?')[0];requests.push(url);res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script type="module" src="/entry.js"></script>');return;}
 if(url==='/favicon.ico'){res.statusCode=204;res.end();return;}
 const file=files.get(url)??(/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url)?path.join(APP,'node_modules/onnxruntime-web/dist',path.basename(url)):null);
 if(!file){res.statusCode=403;res.end('AUDIO_ASSETS_ONLY');return;}
 res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(js|mjs)$/.test(file)?'text/javascript':'application/octet-stream');
 createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url),{chromium}=require(path.join(RUNTIME_NODE_MODULES,'playwright'));
let browser,result=null,failure=null,failureWitness=null,identity=null,gpu=null;
try{
 const executablePath=resolveBrandedBrowserExecutable('chrome');if(!executablePath)throw Error('BRANDED_CHROME_UNAVAILABLE');
 browser=await chromium.launch({executablePath,headless:false});identity={version:await browser.version(),executablePath,headed:true};
 const context=await browser.newContext(),page=await context.newPage();
 page.on('worker',w=>diagnostics.push({type:'worker-created',url:w.url()}));
 page.on('console',m=>diagnostics.push({type:m.type(),text:m.text(),location:m.location()}));
 page.on('pageerror',e=>diagnostics.push({type:'pageerror',message:e.message,stack:e.stack}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>typeof window.runWaitingAudioOnly==='function');
 gpu=await collectWebGpuAdapter(page);result=await page.evaluate(j=>window.runWaitingAudioOnly(j),jobs);
 if(result.results.length!==30||result.workerConstructions!==1||result.modelSessionLoads!==1
  ||result.actualModelRuns!==result.results.reduce((n,r)=>n+r.snapshot.counts.windowsStarted,0)
  ||diagnostics.filter(d=>d.type==='worker-created'&&d.url.endsWith('/worker.js')).length!==1)throw Error('STAGE_A_EXECUTION_COUNT');
}catch(error){failure=String(error.stack??error);const line=failure.split('\n')[0],index=line.indexOf('{');
 if(index>=0){try{failureWitness=JSON.parse(line.slice(index));}catch{}}
 process.exitCode=1;}
finally{
 await browser?.close();await new Promise(r=>server.close(r));
 const file=path.join(output,'acoustic.json');
 await newJson(file,{...qualificationExecutionProof,qualificationExecutionProof,status:failure?'BLOCKED':'SEALED_AUDIO_ONLY',browser:identity,gpu,
  result,failure,failureWitness,actualModelRuns:result?.actualModelRuns??failureWitness?.actualModelRuns??null,
  modelRunCountComplete:result!==null||failureWitness?.actualModelRuns!==undefined,
  requests,bundleInputs,diagnostics,model:await fileIdentity(MODEL),completedAt:new Date().toISOString()});
 await chmod(file,0o444);
 const acousticSeal={...qualificationExecutionProof,sealedAt:new Date().toISOString(),file:path.relative(ROOT,file),sha256:hash(await readFile(file)),
  bytes:(await stat(file)).size,readOnlyRequested:true,windowsReadOnly:((await stat(file)).mode&0o222)===0,
  truthOpened:false,truthNotServed:true,status:failure?'BLOCKED_AUDIO_OUTPUT_SEALED':'ACOUSTIC_OUTPUT_SEALED'};
 await newJson(path.join(output,'acoustic-seal.json'),acousticSeal);await chmod(path.join(output,'acoustic-seal.json'),0o444);
 console.log(JSON.stringify({status:acousticSeal.status,sha256:acousticSeal.sha256,actualModelRuns:result?.actualModelRuns??null,failure}));
}
