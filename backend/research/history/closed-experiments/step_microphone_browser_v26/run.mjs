import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const DIR='backend/research/step_microphone_browser_v26',OUT='backend/research/reports/step_microphone_browser_v26';
export const START='3757d8c38d0ee750a2330fc15550151258e2e517',BRANCH='codex/customer-web-delivery-boundary';
export const bytes=p=>readFile(path.join(ROOT,p)),sha=b=>createHash('sha256').update(b).digest('hex');
export const load=async p=>JSON.parse(await bytes(p));
export const save=async(name,v)=>{await mkdir(path.join(ROOT,OUT),{recursive:true});await writeFile(path.join(ROOT,OUT,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});};
export const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
export const now=()=>new Date().toISOString();
const req=createRequire(import.meta.url);
export const playwrightRoot=path.join(ROOT,'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright');
function scope(){
  assert.equal(git('branch','--show-current'),BRANCH);assert.equal(git('merge-base',START,'HEAD'),START);
  const files=[...new Set([...git('diff','--name-only',START).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(files.every(p=>p.startsWith(DIR+'/')||p.startsWith(OUT+'/')),'PRODUCTION_OR_HISTORICAL_CHANGE');return files;
}
export async function verify(){
  scope();const f=await load(OUT+'/browser-protocol-freeze.json');
  for(const p of [...f.files,...(await load(OUT+'/historical-identities.json')).files])assert.equal(sha(await bytes(p.path)),p.sha256,'FROZEN_MUTATION:'+p.path);
  return f;
}
export function remote(clean=true){const h=git('rev-parse','HEAD');assert.equal(git('rev-parse','origin/'+BRANCH),h);
  assert.equal(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s/)[0],h);if(clean)assert.equal(git('status','--porcelain'),'');return h;}
function github(h){return JSON.parse(execFileSync('python',['-c',"import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))",h],{cwd:ROOT,encoding:'utf8'}));}

async function prepare(){
  scope();assert.equal(git('rev-parse','HEAD'),START);const plan=await load(DIR+'/contract.json');
  const preservationPath='backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json';
  const preservation=await load(preservationPath),parts=[],sources=[];let count=44100*12;
  parts.push(Buffer.alloc(count*2));
  for(const [index,family]of plan.audioFamiliesInOrder.entries()){
    const p=preservation.results.find(r=>r.family===family&&r.sourceRateHz===44100),raw=await bytes(p.clipPath);
    assert.equal(sha(raw),p.clipPcmSha256);assert.equal(raw.length%4,0);
    const output=Buffer.alloc(raw.length/2);let clipped=0;
    for(let i=0;i<raw.length/4;i++){const v=raw.readFloatLE(i*4);assert.ok(Number.isFinite(v));if(v>1||v< -1)clipped++;
      output.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),i*2);}
    sources.push({family,recordingId:p.recordingId,audioBoundCaseId:p.audioBoundCaseId,jobId:p.jobId,
      audioSourceSha256:p.audioSourceSha256,acceptedPcmPath:p.clipPath,acceptedPcmSha256:p.clipPcmSha256,
      sourceOriginSample:p.sourceOriginSample,sourceEndSample:p.sourceEndSample,inputRate:44100,channels:1,
      outputStartSample:count,outputSampleCount:output.length/2,clampedSamples:clipped});
    count+=output.length/2;parts.push(output);if(index<2){parts.push(Buffer.alloc(44100*2));count+=44100;}
  }
  parts.push(Buffer.alloc(44100*4*2));count+=44100*4;
  const pcm=Buffer.concat(parts),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(44100,24);
  header.writeUInt32LE(88200,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
  assert.equal(pcm.length,count*2);await mkdir(path.join(ROOT,OUT),{recursive:true});
  await writeFile(path.join(ROOT,OUT,'browser-input.wav'),Buffer.concat([header,pcm]),{flag:'wx'});
  await save('audio-input-identity.json',{classification:'EXPOSED_BROWSER_ENGINEERING_INPUT_NOT_FRESH_QUALIFICATION',sources,
    preservation:{path:preservationPath,sha256:sha(await bytes(preservationPath))},path:OUT+'/browser-input.wav',
    sha256:sha(await bytes(OUT+'/browser-input.wav')),channels:1,sampleRate:44100,samples:count,durationSeconds:count/44100,
    format:'WAV_PCM16_LE',transform:plan.audioTransform,sourceReplacedAfterOutput:false});
  const builder=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const bundles=[];
  for(const [entry,name]of [[DIR+'/entry.ts','entry.js'],['apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts','worker.js']]){
    const p=OUT+'/bundles/'+name,b=await builder.build({absWorkingDir:ROOT,entryPoints:[entry],outfile:path.join(ROOT,p),bundle:true,
      format:'esm',platform:'browser',target:'es2022',metafile:true,logLevel:'silent',tsconfig:path.join(ROOT,'apps/customer-web/tsconfig.json'),
      define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},nodePaths:[path.join(ROOT,'apps/customer-web/node_modules')],
      plugins:[{name:'accepted-pinned-ort-external',setup(build){build.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}]});
    bundles.push({path:p,sha256:sha(await bytes(p)),inputs:Object.keys(b.metafile.inputs),entry});
  }
  const required=['step/step-microphone-input.ts','step/step-microphone-platform.ts','step/step-acoustic-capture-bridge.ts',
    'step/step-acoustic-attempt-assembler.ts','acoustic/runtime/source-analysis-runtime.ts','acoustic/source/source-chronology.ts',
    'acoustic/source/capture.ts','acoustic/model/worker-client.ts','local-core/step-runtime.ts'];
  for(const suffix of required)assert.ok(bundles[0].inputs.some(p=>p.endsWith(suffix)),'MISSING_PRODUCTION_GRAPH:'+suffix);
  assert.ok(bundles[1].inputs.some(p=>p.endsWith('acoustic/model/model-inference.ts')));
  assert.ok(bundles[1].inputs.some(p=>p.endsWith('acoustic/model/robust-piano-decoder.ts')));
  const accepted=await load('backend/research/robust_raw_tensor_v20/stage-a-config.json');
  const assets={};
  for(const [route,a]of Object.entries(accepted.assets)){const b=await bytes(a.path);assert.equal(sha(b),a.sha256);assert.equal(b.length,a.bytes);assets[route]=a;}
  for(const name of ['fir-160-441.f32','fir-1-3.f32']){const p='apps/customer-web/public/model-assets/practice-acoustic/'+name,b=await bytes(p);assets['/model-assets/practice-acoustic/'+name]={path:p,sha256:sha(b),bytes:b.length};}
  const worklet='apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js',w=await bytes(worklet);
  assets['/acoustic/source/capture.worklet.js']={path:worklet,sha256:sha(w),bytes:w.length};
  const executable=plan.browser.executable;
  const version=execFileSync('powershell',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable}').VersionInfo.ProductVersion`],{encoding:'utf8'}).trim();
  assert.equal(version,plan.browser.expectedFileVersion);
  const environment={os:{platform:os.platform(),release:os.release(),version:os.version(),arch:os.arch()},chromeExecutable:executable,
    chromeFileVersion:version,chromeExecutableSha256:sha(await readFile(executable)),playwrightVersion:req(path.join(playwrightRoot,'package.json')).version,
    node:process.version,browserNotLaunched:true,productAssetAPI:'NOT_AVAILABLE_IN_LOCAL_LISTENING_SERVICES',
    metadataOnlyDiscovery:'FileVersionInfo/OS/package metadata; browser/GPU details collected only in frozen campaign'};
  await save('build-and-environment.json',{environment,bundles,assets,graph:'ACTUAL_PRODUCTION_CORE_WITH_TRANSPARENT_INSTRUMENTATION',productionAccessAPIExecuted:false});
  console.log(JSON.stringify({audioSeconds:count/44100,environment,bundles:bundles.map(b=>({path:b.path,inputs:b.inputs.length}))}));
}
async function freeze(){
  scope();assert.equal(git('rev-parse','HEAD'),START);const local=await load(OUT+'/local-verification.json');assert.equal(local.result,'LOCAL_PASS');
  const history=[];for(const p of git('ls-tree','-r','--name-only',START,'--','backend/research').split('\n').filter(Boolean))history.push({path:p,sha256:sha(await bytes(p))});
  await save('historical-identities.json',{startingHead:START,files:history});
  const build=await load(OUT+'/build-and-environment.json');
  const all=[...(await readdir(path.join(ROOT,DIR))).map(p=>DIR+'/'+p),...build.bundles.flatMap(b=>[b.path,...b.inputs]),
    ...Object.values(build.assets).map(a=>a.path),
    ...git('ls-tree','-r','--name-only',START,'--','apps/customer-web/src/lib/practice','apps/customer-web/src/hooks/practice').split('\n').filter(Boolean),
    ...['starting-gate.json','local-verification.json','build-and-environment.json','audio-input-identity.json','browser-input.wav','pre-browser-tests.json','historical-identities.json'].map(p=>OUT+'/'+p)];
  const files=[];for(const p of [...new Set(all)].sort())files.push({path:p,sha256:sha(await bytes(p))});
  await save('browser-protocol-freeze.json',{createdAt:now(),startingHead:START,contract:await load(DIR+'/contract.json'),files,
    build,historyFiles:history.length,browserExecutions:0,campaignsAllowed:1,realNeuralExecutionBeforeFreeze:0,
    productionDiff:[],audio:await load(OUT+'/audio-input-identity.json')});
  console.log(JSON.stringify({freezeSha256:sha(await bytes(OUT+'/browser-protocol-freeze.json')),historyFiles:history.length,files:files.length}));
}
async function rebuild(){
  scope();assert.equal(git('rev-parse','HEAD'),START);assert.equal(await load(OUT+'/browser-protocol-freeze.json').catch(e=>{if(e.code==='ENOENT')return null;throw e;}),null,'NO_REBUILD_AFTER_FREEZE');
  const builder=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const metadata=await load(OUT+'/build-and-environment.json');
  for(const b of metadata.bundles){const result=await builder.build({absWorkingDir:ROOT,entryPoints:[b.entry],outfile:path.join(ROOT,b.path),bundle:true,
    format:'esm',platform:'browser',target:'es2022',metafile:true,logLevel:'silent',tsconfig:path.join(ROOT,'apps/customer-web/tsconfig.json'),
    define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},nodePaths:[path.join(ROOT,'apps/customer-web/node_modules')],
    plugins:[{name:'accepted-pinned-ort-external',setup(build){build.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}]});
    b.sha256=sha(await bytes(b.path));b.inputs=Object.keys(result.metafile.inputs);}
  metadata.preFreezeStaticRebuildOnly=true;await writeFile(path.join(ROOT,OUT,'build-and-environment.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log('PREFREEZE_BUNDLES_REBUILT_NO_BROWSER_EXECUTION');
}
async function proof(){await verify();const h=remote();await save('remote-browser-freeze-proof.json',{freezeCommit:h,remoteHead:h,remoteVerifiedAt:now(),
  freezeSha256:sha(await bytes(OUT+'/browser-protocol-freeze.json')),browserExecution:'NOT_STARTED'});console.log(h);}
async function report(){
  const f=await verify(),r=await load(OUT+'/browser-campaign.json');
  const rows=r.cells.map(cell=>{const t=cell.result;return {id:cell.id,status:cell.status,
    resourceCounts:t?.finalCounts??t?.counts??null,modelReceipt:t?.modelReceipt??null,
    source:t?.afterInputCleanup?.input?.capture??null,analysis:t?.afterInputCleanup?.input?.analysis??null,
    assembler:t?.afterInputCleanup?.input?.assembler??null,attempts:t?.attempts?.length??0,verdictCounts:t?Object.fromEntries(['MATCH','RETRY','MISMATCH'].map(v=>[v,t.attempts.filter(a=>a.record.verdict===v).length])):null,
    issuedBoundaries:t?.boundaries?.map(b=>({sample:b.boundary.capturedThroughSourceSample,physical:b.before.input.capture.capturedThroughSourceSample,
      processed:b.before.input.assembler.processedThroughSourceSample,sourceRuntimeNext:b.before.input.analysis.nextSourceSampleIndex,
      sessionTime:b.boundary.sessionTime,contextTime:b.before.contextTime,initial:b.initial}))??[],
    infrastructure:t?.infrastructure??null,rootStop:t?.rootImmediatelyAfterStop??null,sourceLossAfter:t?.afterInfrastructureLoss??null,
    teardown:t?.teardown??null,sameTarget:t?.sameTargetAcceptance??'NOT_EXECUTED',error:t?.error??cell.error??null,
    inferenceDiagnostics:t?stats(t.runReceipts.map(x=>x.inferenceMs)):null};});
  const counts={modelLoadAttempts:0,successfulModelLoads:0,inferRequests:0,successfulInferRequests:0,failedInferRequests:0,productAcousticWorkers:0};
  for(const c of rows){const n=c.resourceCounts;if(!n)continue;counts.modelLoadAttempts+=n.loadAttempts;counts.successfulModelLoads+=n.loadSuccesses;
    counts.inferRequests+=n.runAttempts;counts.successfulInferRequests+=n.runSuccesses;counts.failedInferRequests+=n.runFailures;counts.productAcousticWorkers+=n.workerOwners;}
  const report={phase:f.contract.phase,startingRemoteHead:START,disposition:r.disposition,cells:rows,counts,
    browser:r.browser,GPU:r.GPU,os:f.build.environment.os,assets:f.build.assets,assetDelivery:f.contract.assetDelivery,
    bothRatesExecuted:rows.filter(c=>c.resourceCounts?.loadAttempts).some(c=>c.id.endsWith('44100'))&&rows.filter(c=>c.resourceCounts?.loadAttempts).some(c=>c.id.endsWith('48000')),
    productionDiff:[],historicalDiff:[],historicalRawFilesVerified:f.historyFiles,V25Immutable:true,defaults:f.contract.currentDefaults,
    schema:'6 / step-source-sensitive-verdict-v6',cooldown:f.contract.cooldown,capabilities:f.contract.capabilities,
    freshHoldoutAccess:0,V20TensorReprocessing:0,thresholdStudies:0,geometryStudies:0,ContinuousAcousticReplay:0,
    controllerOrHookWiring:false,recognitionAccuracyGate:false,recognitionQualification:false,physicalDeviceQualification:false,
    physicalDevice:'REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED',rootHealthOwnership:f.contract.ownership,
    mute:'NOT_EVALUATED_BROWSER_FAKE_MEDIA_LIMITATION',localTestingNotCI:true,github:'Actual statuses/workflows recorded separately at remote result seal',
    nextAllowedPhase:'STOP_FOR_INDEPENDENT_AUDIT_NO_SAME_PHASE_PRODUCTION_PATCH_OR_RERUN',failure:r.failure};
  await save('assessment.json',report);
  await writeFile(path.join(ROOT,OUT,'assessment.md'),`# V26 Real Chromium STEP Resource Graph\n\n${r.disposition}\n\n`+
    `One frozen campaign; no failed-cell retry or production patch. Cells: ${rows.map(x=>x.id+'='+x.status).join(', ')}.\n\n`+
    `Actual browser: ${r.browser?.version??'not reached'}, headed Chrome, Playwright ${f.build.environment.playwrightVersion}; GPU evidence in browser-campaign.json.\n\n`+
    `Production core graph uses real capture/worklet/source runtime/Worker/ORT WebGPU/Robust/decoder A/assembler/v6 runtime. The model URL alone is an explicit research override: getPracticeAcousticModelAccess/backend delivery was NOT exercised and full asset delivery is NOT qualified.\n\n`+
    `Root health belongs to APPLICATION_MICROPHONE_SESSION_OWNS_ROOT_STREAM_HEALTH via the unchanged watchMicrophoneInfrastructure. No synthetic ended/mute events or fallback watcher were installed. Physical captured-through alone supplies issued rearm facts; acoustic processed-through is not retirement. Any exact browser failure and partial resource state are preserved in machine-readable cell results.\n\n`+
    `Execution accounting: ${JSON.stringify(counts)}. Desired musical verdicts are diagnostics, not pass gates. Same-target exercise, POST_VERDICT/rearm, source chronology and normal/failure teardown are retained per cell rather than inferred from deterministic V25 tests.\n\n`+
    `V3-V25 and production remain unchanged. Robust .30/.05 and 600/1050/170 remain defaults, not global optima. Schema6 and H50 unchanged. No cooldown, threshold, geometry or readout change.\n\n`+
    `REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED. No room/device/permission/hotplug/physical-latency or fresh recognition qualification. Fresh holdout untouched. No controller/hook integration. Continuous MODEL_NOT_VALIDATED; STEP ATTEMPT_ANALYZER_NOT_VALIDATED; productionMicrophone=false; D4=false.\n\n`+
    `Local Chromium and local tests are not GitHub CI. See remote-result-proof.json for actual combined status/statuses/workflows. STOP for independent audit; do not repair and rerun V26.\n`,{flag:'wx'});
  console.log(JSON.stringify({disposition:r.disposition,counts,cells:rows.map(c=>({id:c.id,status:c.status,error:c.error}))}));
}
function stats(values){if(!values.length)return{count:0,p50:null,p95:null,max:null};const a=[...values].sort((a,b)=>a-b);return{count:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1),meaning:'MODEL_ENGINEERING_DIAGNOSTIC_NOT_PHYSICAL_UX_LATENCY'};}
async function receipt(){const f=await verify(),h=remote(),files=scope(),identities=[];for(const p of files){const b=await bytes(p),committed=execFileSync('git',['show',h+':'+p],{cwd:ROOT,maxBuffer:64*1024*1024});assert.equal(sha(b),sha(committed));identities.push({path:p,sha256:sha(b)});}
  const checks=github(h);await save('remote-result-proof.json',{startingRemoteHead:START,resultCommit:h,remoteHead:h,remoteVerifiedAt:now(),
    completeCommitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),exactChangedFiles:files,identities,
    productionDiff:[],V3ThroughV25Diff:[],historicalRawFilesVerified:f.historyFiles,github:checks,cleanWorktree:true,
    disposition:(await load(OUT+'/assessment.json')).disposition,receiptCommitNote:'Final additive receipt HEAD independently verified after commit without self-reference'});
  console.log(JSON.stringify({head:h,github:checks}));}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];if(mode==='prepare')await prepare();else if(mode==='rebuild-prefreeze')await rebuild();else if(mode==='freeze')await freeze();else if(mode==='proof')await proof();
  else if(mode==='report')await report();else if(mode==='receipt')await receipt();else if(mode==='verify'){await verify();console.log('ALL_PRODUCTION_AND_V3_V25_RAW_BYTES_EXACT');}
  else throw Error('prepare/freeze/proof/report/receipt/verify only. Browser campaign is a separate exclusive entrypoint.');
}
