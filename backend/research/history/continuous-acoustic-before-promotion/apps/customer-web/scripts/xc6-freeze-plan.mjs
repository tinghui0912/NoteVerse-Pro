import path from 'node:path';
import { ROOT,APP,WORK,PHASE,START,CORE,git,checkCore,sourceRows,fileId,newJson,freezePath,hash,canonical,load } from './xc6-evidence.mjs';
const stage=process.argv[2];
if(!['capture_probe','capture_integration'].includes(stage))throw new Error('XC6_FREEZE_STAGE');
checkCore();if(git('status','--porcelain','--untracked-files=no'))throw new Error('COMMIT_SOURCE_FIRST');
const extra=[];
if(stage==='capture_integration'){
  const checks=await load(path.join(WORK,'checks.json'));if(checks.runs.some(r=>r.exitCode!==0))throw new Error('FOCUSED_CHECKS_NOT_PASS');
  const reference=await load(path.join(WORK,'dsp48_reference.json'));
  for(const p of ['checks.json','metadata_fake.json','metadata_real.json','dsp48_reference.json'])extra.push(await fileId(path.join(WORK,p)));
  for(const f of reference.fixtures)for(const k of ['input','reference'])extra.push(await fileId(path.join(WORK,f[k])));
  for(const p of ['backend/research/xc6_prepare_48000.py','backend/research/run_xc6_checks.ps1',
    'apps/customer-web/public/engineering/xc6/fir-1-3.f32','apps/customer-web/public/engineering/xc4/fir-160-441.f32'])extra.push(await fileId(path.join(ROOT,p)));
  for(const name of ['ort.webgpu.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'])extra.push(await fileId(path.join(APP,'node_modules/onnxruntime-web/dist',name)));
}
const f={phase:PHASE,stage,startingRemoteHead:START,implementationCommit:git('rev-parse','HEAD'),
  xc4CoreIdentitySha256:CORE,sources:await sourceRows(),createdAt:new Date().toISOString(),productionMicrophone:false,
  assets:[await fileId(path.join(WORK,'fake-device.wav')),await fileId(path.join(ROOT,'backend/research/xc6_prepare_fixture.py')),...extra],
  plan:stage==='capture_probe'?{neuralInferenceCount:0,realDevice:'One ordinary permission request, bounded12seconds; no grant override. Metadata only, no PCM persisted.',
    fakeDevice:'One browser-faithful metadata observation, default AudioContext rate, no forced sample rate. Conditional48k implementation forbidden until observed.',
    durationMs:1200}: {kind:'One fake-media end-to-end smoke; no direct PCM injection after AudioWorklet.',ownedMs:600,futureMs:170,minimumWindows:2},
  xc5CaveatPreserved:true};
f.freezeCanonicalSha256=hash(canonical(f));await newJson(freezePath(stage),f);
