// Isolated execution process: never imports the outer freeze verifier or a product scorer.
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {ROOT,DIR,OUT,WORK,hash,newJson,rejectImports,routeAllowed,permission} from './core.mjs';
const startedAt=new Date().toISOString(),reads=[];
const fixed=new Set([DIR+'/stage-a-assets.json',OUT+'/stage-a-permission.json',OUT+'/continuous-gate.json',
 'backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json',
 'backend/data/work/step_waiting_h50_holdout_v7/stage-a/bundle-inputs.json']);
const readAllowed=async file=>{if(!fixed.has(file))throw Error('H50_STAGE_A_TRUTH_ISOLATION_VIOLATION:READ');reads.push({file,at:new Date().toISOString()});return readFile(path.join(ROOT,file));};
const configBytes=await readAllowed(DIR+'/stage-a-assets.json'),config=JSON.parse(configBytes);
const proof=JSON.parse(await readAllowed(OUT+'/stage-a-permission.json'));
const gateBytes=await readAllowed(OUT+'/continuous-gate.json');
if(hash(gateBytes)!==proof.continuousGateSha256)throw Error('CONTINUOUS_GATE_CHANGED');
const gate=JSON.parse(gateBytes);permission(proof,gate,hash(configBytes),startedAt);
const bytes=await readAllowed(config.opaqueManifest);
if(hash(bytes)!==config.opaqueManifestSha256)throw Error('OPAQUE_MANIFEST_IDENTITY_MISMATCH');
const manifest=JSON.parse(bytes),bundleBytes=await readAllowed('backend/data/work/step_waiting_h50_holdout_v7/stage-a/bundle-inputs.json');
if(hash(bundleBytes)!==proof.bundleManifestSha256)throw Error('BUNDLE_MANIFEST_CHANGED');
const bundles=JSON.parse(bundleBytes);rejectImports(bundles.graphs.flatMap(g=>g.inputs));
const files=new Map();
for(const [url,asset] of Object.entries(config.assets)){fixed.add(asset.path);const data=await readAllowed(asset.path);if(data.length!==asset.bytes||hash(data)!==asset.sha256)throw Error('FROZEN_ASSET_CHANGED');files.set(url,asset.path);}
for(const graph of bundles.graphs.filter(g=>g.output.startsWith('stage-a/'))){const p='backend/data/work/step_waiting_h50_holdout_v7/'+graph.output;fixed.add(p);if(hash(await readAllowed(p))!==graph.sha256)throw Error('BUNDLE_CHANGED');files.set('/'+path.basename(graph.output),p);}
for(const job of manifest.jobs){fixed.add(job.pcmPath);files.set('/pcm/'+job.jobId,job.pcmPath);}
const requests=[],diagnostics=[];let forbidden=0;
const server=createServer(async(req,res)=>{
 const url=req.url;const allowed=routeAllowed(url,files);requests.push({url,allowed,at:new Date().toISOString()});
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 if(!allowed){forbidden++;res.statusCode=403;res.end('ASSET_ONLY');return;}
 if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="icon" href="data:,"><script type="module" src="/entry.js"></script>');return;}
 try{const file=files.get(url),data=await readAllowed(file);res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream');res.end(data);}
 catch(error){diagnostics.push({type:'server-read-failure',url,error:String(error)});res.statusCode=500;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url);
const playwrightRoot=path.join(ROOT,'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright');
const {chromium}=require(playwrightRoot),playwrightVersion=require(path.join(playwrightRoot,'package.json')).version;
let browser,page,trace=null,failure=null,gpu=null,browserIdentity=null,workers=0;
try{
 browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:false});
 browserIdentity={version:await browser.version(),headed:true,brand:'Google Chrome',playwright:playwrightVersion};
 const context=await browser.newContext();page=await context.newPage();
 page.on('worker',w=>{workers++;diagnostics.push({type:'worker-created',url:w.url(),at:new Date().toISOString()});});
 page.on('pageerror',e=>diagnostics.push({type:'pageerror',message:e.message}));
 page.on('requestfailed',r=>diagnostics.push({type:'requestfailed',url:r.url(),failure:r.failure()}));
 page.on('console',m=>diagnostics.push({type:'console',level:m.type(),text:m.text()}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 gpu=await page.evaluate(async()=>{if(!navigator.gpu)throw Error('WEBGPU_UNAVAILABLE');const a=await navigator.gpu.requestAdapter();if(!a)throw Error('GPU_ADAPTER_UNAVAILABLE');const i=a.info??await a.requestAdapterInfo?.();return {info:i?{vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description}:null,isFallbackAdapter:a.isFallbackAdapter,features:[...a.features]};});
 if(gpu.isFallbackAdapter||/swiftshader|software|llvmpipe/i.test(JSON.stringify(gpu.info)))throw Error('REAL_HARDWARE_WEBGPU_REQUIRED');
 await page.waitForFunction(()=>typeof window.runBlindStageA==='function');
 trace=await page.evaluate(m=>window.runBlindStageA(m),manifest);
 if(trace.status!=='ACOUSTIC_OUTPUT_SEALED'||trace.actualModelRuns!==228||trace.results.length!==18||trace.windows.length!==228||trace.workerConstructions!==1||trace.modelSessionLoads!==1||!trace.modelRunCountComplete||workers!==1)throw Error('STAGE_A_EXECUTION_OR_ACCOUNTING_FAILURE');
}catch(error){failure=String(error.stack??error);trace??=await page?.evaluate(()=>window.stageATrace??null).catch(()=>null);}
finally{
 await browser?.close();await new Promise(r=>server.close(r));
 const status=failure?'BLOCKED_AUDIO_OUTPUT_SEALED':'ACOUSTIC_OUTPUT_SEALED';
 const output={...proof,executionStartedAt:startedAt,completedAt:new Date().toISOString(),status,opaqueJobManifestSha256:config.opaqueManifestSha256,
  jobsExpected:18,jobsCompleted:trace?.results?.length??0,windowsExpected:228,windowsCompleted:trace?.actualModelRuns??0,modelInputsVerified:trace?.windows?.length??0,
  actualModelRuns:trace?.actualModelRuns??0,modelRunCountComplete:trace?.modelRunCountComplete??false,
  workerConstructions:workers,modelSessionLoads:trace?.modelSessionLoads??0,browser:browserIdentity,GPU:gpu,ORT:config.ortVersion,modelIdentity:config.modelIdentity,
  modelInputMismatches:/FROZEN_MODEL_INPUT_MISMATCH/.test(JSON.stringify(trace?.failure??failure))?1:0,
  failure:failure??trace?.failure??null,trace,requests,forbiddenRequests:forbidden,diagnostics,dataReads:reads,bundles,
  truthBearingBundleInputs:[],truthOpened:false,midiOpened:false,scenarioOpened:false,targetOpened:false,productVerdictComputed:false,
  StageB:'NOT_STARTED',safetyCounters:'NOT_MEASURED',usabilityMetrics:'NOT_MEASURED',productLatencyMetrics:'NOT_MEASURED'};
 const file=path.join(ROOT,OUT,'stage-a/acoustic.json');await newJson(file,output);
 const acousticSha=hash(await readFile(file));
 await newJson(path.join(ROOT,OUT,'stage-a/acoustic-seal.json'),{...proof,status,sealedAt:new Date().toISOString(),acousticFile:OUT+'/stage-a/acoustic.json',acousticSha256:acousticSha,
  truthOpened:false,truthNotServed:true,midiOpened:false,scenarioOpened:false,targetOpened:false,productVerdictComputed:false,
  serverForbiddenRequestCount:forbidden,truthBearingBundleInputs:[],actualModelRuns:output.actualModelRuns,modelRunCountComplete:output.modelRunCountComplete});
 console.log({status,jobsCompleted:output.jobsCompleted,windowsCompleted:output.windowsCompleted,actualModelRuns:output.actualModelRuns,failure:output.failure});
 if(failure)process.exitCode=1;
}
