import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,DIR,OUT,WORK,load,save,hash} from './core.mjs';
const pre=await load(OUT+'/preflight.json');
const originalJobs=(await load('backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json')).jobs;
const sanitized=await load('backend/research/reports/phase9g_xc1_r3d_sanitized_stage_a_manifest_f5_2026-10-15.json');
const esbuild=await import(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js'));
await mkdir(path.join(ROOT,WORK),{recursive:true});
await esbuild.build({entryPoints:[path.join(ROOT,'apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts')],outfile:path.join(ROOT,WORK,'planner.mjs'),bundle:true,format:'esm',platform:'node'});
const {planWindow}=await import(path.join(ROOT,WORK,'planner.mjs'));
const jobs=originalJobs.map(j=>({...j,layer:'A'}));const mappings=[];
for(const take of sanitized.takes){
 const pcm=take.canonicalPcm;const bytes=await readFile(path.join(ROOT,pcm.sourceRelativePath));if(hash(bytes)!==pcm.sha256)throw Error('CANONICAL_PCM_IDENTITY_DRIFT');
 const start=Math.max(Math.ceil(take.scoreableInterior.startMs*16),16800);
 const end=Math.min(Math.floor(take.scoreableInterior.endMs*16),pcm.sampleCount-2720);
 if(end<=start)throw Error('COMMON_INTERIOR_EMPTY');
 const jobId='b-'+hash(take.takeId).slice(0,24),region={index:0,sourceStart:start,originTarget:start,nextWindow:0,queuedEndTarget:start,endTarget:end};
 const windows=[],expectedModelInputs=[];
 while(true){const w=planWindow(region,windows.length);if(!w)break;
  if(w.startSample<0||w.endSample>pcm.sampleCount||w.endSample-w.startSample!==29120)throw Error('BROAD_GEOMETRY_CONTEXT_INVALID');
  windows.push(w);expectedModelInputs.push({windowIndex:w.windowIndex,start:w.startSample,end:w.endSample,sha256:hash(bytes.subarray(w.startSample*4,w.endSample*4))});region.nextWindow++;
 }
 jobs.push({jobId,sourceDomainId:jobId,sourceRateHz:16000,sourceOriginSample:0,layer:'B',pcmPath:pcm.sourceRelativePath,pcmSha256:pcm.sha256,frames:pcm.sampleCount,
   regionStartSourceSample:start,regionEndSourceSample:end,windows,expectedModelInputs});
 mappings.push({jobId,takeId:take.takeId,workId:take.workId,sourceWavSha256:take.sourceAcousticWavSha256,canonicalPcmSha256:pcm.sha256,
   historicalInterior:take.scoreableInterior,commonInterior:{startMs:start/16,endMs:end/16},windowCount:windows.length});
}
await save(OUT+'/layer-b-common-interiors.json',{label:'DEVELOPMENT_ONLY_NOT_QUALIFICATION',takes:mappings,
 rule:'max(historical start,1050ms), min(historical end,duration-170ms), integer target sample intersection before any neural output; full 29120 real-sample production planWindow inputs',
 inputCaveat:'Historical canonical 16k LINEAR-preprocessed PCM, not a new production FIR/device-rate qualification. Both models receive identical bytes; Layer A alone exercises the frozen production 44.1/48k adapter path.'});
await save(WORK+'/audio-jobs.json',{schema:'WAVE1_AUDIO_ONLY_EXPOSED_JOBS_NO_TRUTH_NO_TARGET',jobs});
const broad=jobs.filter(j=>j.layer==='B').reduce((n,j)=>n+j.expectedModelInputs.length,0),total=228+broad;
await save(OUT+'/planned-budget.json',{label:'DEVELOPMENT_ONLY_NOT_QUALIFICATION',challengerBudget:2,layerAJobs:18,layerBJobs:50,layerAWindows:228,layerBWindows:broad,
 robustModelWindowRuns:total,originalModelWindowRuns:total,decoderARuns:total,decoderBRuns:total,originalDecoderRuns:total,
 totalModelRuns:2*total,hiddenWarmupRuns:0,unknownRuns:0,workerConstructionsPerModel:1,modelSessionLoadsPerModel:1,
 executionOrder:['ROBUST_RAW','BYTEDANCE_ORIGINAL_FIXED1820']});
const old=await load('backend/research/step_waiting_h50_holdout_v7/stage-a-assets.json');
const assets={...old.assets};delete assets['/model.onnx'];
const graphs=[{entry:'apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts',output:'planner.mjs',inputs:['apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts','apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts','apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts','apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json']}];
for(const [name,platform] of [['entry','browser'],['worker','browser'],['tests','node']]){
 const result=await esbuild.build({absWorkingDir:ROOT,entryPoints:[`${DIR}/${name}.ts`],outfile:path.join(ROOT,WORK,name+'.'+(platform==='browser'?'js':'mjs')),bundle:true,metafile:true,format:'esm',platform,target:'es2022',
  define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},nodePaths:[path.join(ROOT,'apps/customer-web/node_modules')],
  plugins:[{name:'pinned-ort',setup(b){b.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}]});
 const inputs=Object.keys(result.metafile.inputs);
 if(platform==='browser'){const {assertGraph}=await import('./core.mjs');assertGraph(inputs);}
 graphs.push({entry:`${DIR}/${name}.ts`,output:name+'.'+(platform==='browser'?'js':'mjs'),inputs});
}
await save(WORK+'/bundle-graphs.json',graphs);
await save(DIR+'/stage-a-assets.json',{label:'DEVELOPMENT_ONLY_NOT_QUALIFICATION',models:pre.models,assets,audioManifest:WORK+'/audio-jobs.json',
 audioManifestSha256:hash(await readFile(path.join(ROOT,WORK,'audio-jobs.json'))),plannedRunsPerModel:total,bundles:{'/entry.js':WORK+'/entry.js','/worker.js':WORK+'/worker.js'}});
console.log(JSON.stringify({layerA:228,layerB:broad,plannedRunsPerModel:total,totalModelRuns:total*2,newNeuralRuns:0}));
