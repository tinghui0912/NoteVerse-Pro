import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { ROOT,DIR,OUT,WORK,START,BRANCH,bytes,load,save,hash,git,now,corpusIdentity } from './io.mjs';
import { encodeLE,decodeLE,assertInventory,INPUT_SAMPLES,PAIR_BYTES,TENSOR_BYTES,CORPUS_BYTES } from './wire.mjs';
import { verifyRows,recompute,physicalIdentity } from '../robust_signed_zero_v22/recompute.mjs';
import { equalEvidence } from '../robust_signed_zero_v22/numeric.mjs';

export const V20='backend/research/reports/robust_raw_tensor_v20';
export const V22='backend/research/reports/robust_signed_zero_v22';
export const PLAN='backend/research/reports/robust_threshold_v21/replay-plan.json';
export const BASE='backend/research/reports/robust_threshold_v21/stage-b/ROBUST_A_O030_F005.json';
export const OPAQUE='backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json';
export const HIST='backend/research/reports/phase9g_xc4_engineering_default_freeze_2026-10-16.json';
const accepted={
  [V20+'/tensor-corpus-manifest.json']:'4bb391905007ecbd594b4ed76d7fa79be0a3c095062da9111c4de63e72129c4b',
  [V20+'/raw-tensor-seal.json']:'7513253623c799357de01d7a7a183a95ec2738e0fa374b88fe299a09d1899eaf',
  [OPAQUE]:'42bd0dcb1ed9bf2e7fa2328e18ab4f6064767d2728d7d29a8adca91af1dbfd02',
  'backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json':'27d80f956f207366f3739d8277f559f98b7ba85f4f51df7a75b7dd57da2e2c51'
};
export async function scope(){
  assert.equal(git('branch','--show-current'),BRANCH);assert.equal(git('merge-base',START,'HEAD'),START);
  const paths=Array.from(new Set([...git('diff','--name-only',START).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean)));
  assert.ok(paths.every(p=>p.startsWith(DIR+'/')||p.startsWith(OUT+'/')),'PRODUCTION_OR_HISTORICAL_MUTATION');
  for(const [p,sha] of Object.entries(accepted))assert.equal(hash(await bytes(p)),sha,'ACCEPTED_IDENTITY:'+p);
  return paths;
}
export async function baseline(){
  const r=await load(V22+'/reevaluation-results.json');assert.equal(r.disposition,'ROBUST_V22_THRESHOLD_GRID_NO_SAFE_USABILITY_CHALLENGER_BASELINE_RETAINED');
  const f=r.artifacts.find(f=>f.profileId==='ROBUST_A_O030_F005');assert.equal(hash(await bytes(f.path)),f.sha256);
  const audit=await load(f.path),original=await load(BASE),rows=verifyRows(original.rows,equalEvidence);
  const result=recompute(rows,rows,original.profile);
  equalEvidence(result.views,audit.independentResultSummary.views,'ACCEPTED_V22_BASELINE_VIEWS');
  equalEvidence(result.byRate,audit.independentResultSummary.byRate,'ACCEPTED_V22_BASELINE_RATES');
  equalEvidence(result.targetViews.map(v=>({viewId:v.viewId,physicalUnitId:v.physicalUnitId,physicalGestureKey:v.physicalGestureKey,
    rowIds:v.rowIds,multiplicity:v.multiplicity,expected:v.expected,physicalTruth:v.physicalTruth,acousticObserved:v.acousticObserved,
    physicalTargetSupported:v.physicalTargetSupported,serializedVerdict:v.productRecord?.verdict??null,classification:v.classification})),audit.targetViews,'ACCEPTED_V22_BASELINE_TARGET_IDENTITIES');
  assert.equal(rows.length,34);assert.equal(result.targetViews.length,26);
  assert.equal(new Set(rows.map(r=>physicalIdentity(r))).size,18);assert.equal(new Set(rows.map(r=>physicalIdentity(r,false))).size,9);
  const history=await load(HIST);
  assert.ok(JSON.stringify(history).includes('STRONGEST_UNPROMOTED_GEOMETRY_CHALLENGER'));
  assert.ok(JSON.stringify(history).includes('BAND_LIMITED_A_600_120'));
  return {rows,result,v22ControlPath:f.path,v22ControlSha256:f.sha256};
}
export function graphGate(graph,phase){
  if(phase==='capture')assert.ok(graph.every(p=>[DIR+'/capture-entry.mjs',DIR+'/capture-worker.mjs',DIR+'/wire.mjs'].includes(p)),'NON_RAW_CAPTURE_GRAPH');
  if(phase==='prepare')assert.ok(graph.every(p=>p===DIR+'/prepare-inputs.ts'||p.startsWith('apps/customer-web/src/lib/practice/acoustic/')),'PREPARATION_GRAPH');
  if(phase==='decoder')assert.ok(graph.every(p=>p===DIR+'/decoder.ts'||p.startsWith('apps/customer-web/src/lib/practice/acoustic/')),'DECODER_GRAPH');
  if(phase==='domain')assert.ok(graph.every(p=>p===DIR+'/domain.ts'||p.endsWith('/step_waiting_topology_v3/assembly.ts')||p.startsWith('apps/customer-web/src/lib/practice/local-core/')),'DOMAIN_GRAPH');
  if(phase!=='domain')assert.ok(graph.every(p=>!/step-runtime|step-attempt|finalizer|scenario|truth|v17|v18|verdict-policy/.test(p)),'TARGET_OR_PRODUCT_EXECUTABLE_REACHABLE');
  if(['prepare','decoder'].includes(phase))assert.ok(graph.every(p=>!/model-inference|worker-client|onnxruntime|source-analysis-runtime/.test(p)),'NEURAL_REACHABLE_FROM_NON_CAPTURE');
}
export async function bundle(entry,output,platform,phase){
  const builder=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const p=OUT+'/bundles/'+output;
  const b=await builder.build({absWorkingDir:ROOT,entryPoints:[DIR+'/'+entry],outfile:path.join(ROOT,p),bundle:true,metafile:true,
    platform,format:'esm',target:'es2022',logLevel:'silent',plugins:[{name:'pinned-ort',setup(build){
      build.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:'/ort/ort.webgpu.min.mjs',external:true}));}}]});
  const inputs=Object.keys(b.metafile.inputs);graphGate(inputs,phase);
  return {entry:DIR+'/'+entry,path:p,sha256:hash(await bytes(p)),inputs,platform,phase,esbuildVersion:builder.version};
}
export async function prepare(){
  await scope();const pre=await bundle('prepare-inputs.ts','prepare.mjs','node','prepare');
  const {reconstruct}=await import(pathToFileURL(path.join(ROOT,pre.path)).href);
  const opaque=await load(OPAQUE),reference=await load(V20+'/tensor-corpus-manifest.json'),oldAssets=await load('backend/research/step_waiting_h50_holdout_v7/stage-a-assets.json');
  const strong=await load('backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json');
  const jobs=[],inputs=[],sources=[];let ordinal=0;
  assert.equal(opaque.jobs.length,18);await mkdir(path.join(ROOT,WORK,'inputs'),{recursive:true});
  for(const j of opaque.jobs){
    const oldWindows=reference.windows.filter(w=>w.jobId===j.jobId),source=await bytes(j.pcmPath);
    assert.equal(hash(source),j.pcmSha256);assert.equal(source.length,j.frames*4);
    const fir=oldAssets.assets['/fir-'+j.sourceRateHz+'.f32'],firBytes=await bytes(fir.path);assert.equal(hash(firBytes),fir.sha256);
    const got=await reconstruct(decodeLE(source),j.sourceRateHz,firBytes,oldWindows.map(w=>w.runtimeWindow));
    const v6=strong.results.find(r=>r.jobId===j.jobId);assert.equal(got.identity,v6.qualifiedAdapterIdentity);
    assert.equal(got.windows.length,oldWindows.length);const windows=[],chunks=[];
    for(const [index,g] of got.windows.entries()){
      const old=oldWindows[index],raw=encodeLE(g.pcm);
      assert.equal(hash(encodeLE(g.baselinePcm)),old.inputSha256,'BASELINE_ADAPTER_REFERENCE_INPUT_SHA');
      assert.equal(raw.length,INPUT_SAMPLES*4);assert.equal(g.window.ownedStartTarget,old.runtimeWindow.ownedStartTarget);
      assert.equal(g.window.ownedEndTarget,old.runtimeWindow.ownedEndTarget);
      assert.equal(g.window.startSample,old.runtimeWindow.startSample-800);assert.equal(g.window.endSample,old.runtimeWindow.endSample-800);
      const w={runOrdinal:ordinal++,samples:INPUT_SAMPLES,inputByteOffset:index*INPUT_SAMPLES*4,inputBytes:raw.length,inputSha256:hash(raw),
        runtimeWindow:g.window,sourceInputStart:j.sourceOriginSample+g.window.startSample*j.sourceRateHz/16000,
        sourceInputEnd:j.sourceOriginSample+g.window.endSample*j.sourceRateHz/16000,
        originalTarget16kStart:old.originalTarget16kStart-800,originalTarget16kEnd:old.originalTarget16kEnd-800,
        originalOwnedStart:old.originalOwnedStart,originalOwnedEnd:old.originalOwnedEnd};
      chunks.push(raw);windows.push(w);inputs.push({jobId:j.jobId,sourceRateHz:j.sourceRateHz,sourceDomainId:j.sourceDomainId,...w,
        effectivePastMs:(g.window.ownedStartTarget-g.window.startSample)/16,futureMs:(g.window.endSample-g.window.ownedEndTarget)/16,
        nominalFutureMs:120,futureQuantizationSamples:g.window.endSample-(g.window.ownedEndTarget+120*16),
        ownedMs:(g.window.ownedEndTarget-g.window.ownedStartTarget)/16,realContext:true,paddingSamples:0,
        baselineReferenceInputSha256:old.inputSha256});
    }
    const inputBlobPath=WORK+'/inputs/'+j.jobId+'.f32',data=Buffer.concat(chunks);
    await writeFile(path.join(ROOT,inputBlobPath),data,{flag:'wx'});assert.equal(hash(await bytes(inputBlobPath)),hash(data));
    jobs.push({jobId:j.jobId,sourceCaseId:oldWindows[0].sourceCaseId,sourceDomainId:j.sourceDomainId,sourceRateHz:j.sourceRateHz,
      sourceOriginSample:j.sourceOriginSample,inputBlobPath,inputBlobSha256:hash(data),windows});
    sources.push({jobId:j.jobId,sourcePath:j.pcmPath,sourceSha256:hash(source),frames:j.frames,rate:j.sourceRateHz,
      adapterIdentity:got.identity,firSha256:fir.sha256,targetFrames:got.targetFrames});
    console.log(JSON.stringify({jobId:j.jobId,rate:j.sourceRateHz,inputs:windows.length,context:'REAL_1820MS_600_1100_120'}));
  }
  const manifest={schema:'V23_OPAQUE_FROZEN_MODEL_INPUTS_ONLY',jobs};assertInventory(manifest);assert.equal(ordinal,228);
  await save(OUT+'/inputs.json',manifest);
  const b=await baseline();
  await save(OUT+'/input-preservation.json',{preparedAt:now(),candidate:'ROBUST_A_600_120_O030_F005_V23_EXPOSED',
    totalCases:9,totalJobs:18,totalInputs:ordinal,inputs,sources,preparationGraph:pre,baselineAdapterInputMismatches:0,
    selectedPcmCodecDecodeRuns:0,sourceAdapterReconstructionRuns:sources.length,modelRuns:0,
    sourceTimeMapping:'UNCHANGED_SOURCE_ORIGIN_PLUS_TARGET_SAMPLE_TIMES_RATE_OVER_16000_NO_ALIGNMENT_FIT',
    partialWindowRule:'END_OWNED_END_PLUS_120MS_START_END_MINUS_29120_ALL_REAL',
    provenance:'Accepted existing decoded PCM, production QualifiedSourceAdapter/FIR; baseline input hashes verify adapter parity, no baseline neural rerun.'});
  await save(OUT+'/baseline-verification.json',{v22ControlPath:b.v22ControlPath,v22ControlSha256:b.v22ControlSha256,
    source:BASE,views:b.result.views,byRate:b.result.byRate,targetViewIds:b.result.targetViews.map(v=>v.viewId),
    baselineNeuralRuns:0,baselineProductRuntimeRuns:0,historicalXC4Source:HIST,historicalXC4Sha256:hash(await bytes(HIST))});
}
export async function build(){
  await scope();const graphs=[await bundle('capture-entry.mjs','capture-entry.js','browser','capture'),
    await bundle('capture-worker.mjs','capture-worker.js','browser','capture'),await bundle('decoder.ts','decoder.mjs','node','decoder'),
    await bundle('domain.ts','domain.mjs','node','domain')];
  const prior=await load('backend/research/robust_raw_tensor_v20/stage-a-config.json'),assets={};
  for(const [route,a]of Object.entries(prior.assets)){
    const b=await bytes(a.path);assert.equal(hash(b),a.sha256);assert.equal(b.length,a.bytes);assets[route]=a;
  }
  assert.equal(assets['/model.onnx'].sha256,'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3');
  assert.equal(assets['/model.onnx'].bytes,98689283);
  await save(OUT+'/bundle-graphs.json',{graphs});
  await save(DIR+'/stage-a-config.json',{schema:'V23_RAW_ONLY_SINGLE_GEOMETRY_NO_TRUTH_OR_TARGET',candidate:'ROBUST_A_600_120_O030_F005_V23_EXPOSED',
    modelIdentity:prior.modelIdentity,ORT:prior.ORT,provider:'webgpu',graphOptimizationLevel:'disabled',automaticFallback:false,
    geometry:{ownedMs:600,pastMs:1100,futureMs:120},assets,manifest:{path:OUT+'/inputs.json',sha256:hash(await bytes(OUT+'/inputs.json'))},
    bundles:graphs.filter(g=>g.platform==='browser'),expectedJobs:18,expectedInputs:228,expectedPairBytes:PAIR_BYTES,expectedRawBytes:CORPUS_BYTES});
}
export async function freeze(){
  await scope();assert.equal((await load(OUT+'/pre-execution-tests.json')).status,'LOCAL_PASS');
  const local=await load(OUT+'/local-verification.json');assert.equal(local.status,'LOCAL_PASS');
  const paths=(await readdir(path.join(ROOT,DIR))).map(p=>DIR+'/'+p);
  const graphs=(await load(OUT+'/bundle-graphs.json')).graphs,manifest=await load(OUT+'/inputs.json'),config=await load(DIR+'/stage-a-config.json');
  const base=await baseline(),history=[];
  for(const p of git('ls-tree','-r','--name-only',START,'--','backend/research').split('\n').filter(Boolean))history.push({path:p,sha256:hash(await bytes(p))});
  await save(OUT+'/historical-identities.json',{startingHead:START,files:history});
  paths.push(...graphs.map(g=>g.path),...graphs.flatMap(g=>g.inputs),...Object.values(config.assets).map(a=>a.path),
    ...manifest.jobs.map(j=>j.inputBlobPath),...Object.keys(accepted),PLAN,BASE,HIST,base.v22ControlPath,V22+'/reevaluation-results.json',
    'backend/research/robust_signed_zero_v22/recompute.mjs','backend/research/robust_signed_zero_v22/numeric.mjs',
    'backend/research/reports/robust_threshold_v21/assessment.json',
    ...['inputs.json','input-preservation.json','baseline-verification.json','bundle-graphs.json','historical-identities.json',
      'pre-execution-tests.json','local-verification.json','starting-gate.json'].map(p=>OUT+'/'+p));
  const files=[];for(const p of Array.from(new Set(paths)).sort())files.push({path:p,sha256:hash(await bytes(p))});
  await save(OUT+'/capture-protocol-freeze.json',{role:'V23_SINGLE_GEOMETRY_PROSPECTIVE_CAPTURE_AND_PRODUCT_RULES_FREEZE',startingHead:START,
    createdAt:now(),contract:await load(DIR+'/contract.json'),files,baselineNeuralRuns:0,candidateNeuralRunsBeforeFreeze:0,
    exactCandidateInputPlanSha256:hash(await bytes(OUT+'/inputs.json')),StageB:'NOT_STARTED'});
  console.log(JSON.stringify({files:files.length,historicalFiles:history.length,freezeSha256:hash(await bytes(OUT+'/capture-protocol-freeze.json'))}));
}
export async function verify(){
  await scope();const f=await load(OUT+'/capture-protocol-freeze.json');
  for(const a of [...f.files,...(await load(OUT+'/historical-identities.json')).files])assert.equal(hash(await bytes(a.path)),a.sha256,'FROZEN_MUTATION:'+a.path);
  return f;
}
export async function remote(){
  const h=git('rev-parse','HEAD');assert.equal(git('rev-parse','origin/'+BRANCH),h);
  assert.equal(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s/)[0],h);assert.equal(git('status','--porcelain'),'');return h;
}
export async function proof(){
  await verify();const h=await remote();
  await save(OUT+'/remote-capture-permission.json',{freezeCommit:h,remoteHead:h,remoteVerifiedAt:now(),
    freezeSha256:hash(await bytes(OUT+'/capture-protocol-freeze.json')),configSha256:hash(await bytes(DIR+'/stage-a-config.json')),
    candidateNeuralRunsBeforePermission:0,baselineNeuralRuns:0,StageB:'NOT_STARTED'});console.log(h);
}
export async function rawProof(){
  await verify();const h=await remote(),m=await load(OUT+'/tensor-corpus-manifest.json'),s=await load(OUT+'/raw-tensor-seal.json');
  assert.equal(s.failure,null);assert.equal(m.receipt.attemptedSessionRuns,228);assert.equal(m.receipt.successfulSessionRuns,228);
  let pairs=0,total=0;
  for(const b of m.blobs){
    const data=await bytes(b.path);assert.equal(hash(data),b.sha256);assert.equal(data.length,b.bytes);
    const remoteBytes=await import('node:child_process').then(cp=>cp.execFileSync('git',['show',h+':'+b.path],{cwd:ROOT,maxBuffer:64*1024*1024}));
    assert.equal(hash(remoteBytes),b.sha256,'REMOTE_RAW_BYTES');
    for(const w of m.windows.filter(w=>w.jobId===b.jobId)){
      const pair=data.subarray(w.byteOffset,w.byteOffset+PAIR_BYTES);assert.equal(pair.length,PAIR_BYTES);
      assert.equal(hash(pair),w.pairSha256);assert.equal(hash(pair.subarray(0,TENSOR_BYTES)),w.onsetSha256);
      assert.equal(hash(pair.subarray(TENSOR_BYTES)),w.frameSha256);assert.equal(w.readbackSha256,w.pairSha256);pairs++;
    }
    total+=data.length;
  }
  assert.equal(pairs,228);assert.equal(total,CORPUS_BYTES);assert.equal(corpusIdentity(m.windows),m.corpusCanonicalSha256);
  assert.equal(hash(await bytes(OUT+'/tensor-corpus-manifest.json')),s.manifestSha256);
  await save(OUT+'/remote-raw-seal-proof.json',{captureCommit:h,remoteHead:h,remoteVerifiedAt:now(),
    tensorManifestSha256:s.manifestSha256,rawSealSha256:hash(await bytes(OUT+'/raw-tensor-seal.json')),
    canonicalCorpusSha256:m.corpusCanonicalSha256,pairs,totalRawCanonicalBytes:total,allRemoteRawHashesExact:true,
    modelSessionLoads:m.receipt.modelSessionLoads,modelRuns:m.receipt.attemptedSessionRuns,decoderRuns:0,StageB:'NOT_STARTED'});console.log(h);
}
