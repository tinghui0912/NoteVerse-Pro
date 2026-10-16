import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,REPORTS,git,hash,canonical,fileId,newJson,load,CORE} from './xc6-evidence.mjs';
export {ROOT,APP,REPORTS,git,hash,canonical,fileId,newJson,load,CORE};
export const START='b1c29f646ff981ea423f8331ed18837e7c8aee45';
export const PHASE='PHASE_9G_XC7_BOUNDED_ACOUSTIC_MEMORY_AND_BACKPRESSURE';
export const WORK=path.join(ROOT,'backend/data/work/xc7_bounded');
export const freezeId=process.env.XC7_FREEZE_ID??'v1';
if(!/^v[1-9][0-9]*$/.test(freezeId))throw new Error('XC7_FREEZE_ID');
export const freezePath=path.join(REPORTS,`phase9g_xc7_resource_source_freeze_${freezeId}_2026-10-16.json`);
export async function sources(){
  const rows=[];
  const files=git('ls-files','apps/customer-web/src/lib/practice/acoustic-inference',
    'apps/customer-web/src/lib/practice/audio-analysis/capture/performance-pcm-timeline.ts',
    'apps/customer-web/src/lib/model-assets','apps/customer-web/src/lib/practice/input-capability.ts',
    'apps/customer-web/src/lib/practice/input-capability.test.ts','apps/customer-web/vitest.config.ts','apps/customer-web/vitest.setup.ts',
    'apps/customer-web/package.json','apps/customer-web/package-lock.json','backend/research/run_xc7_checks.ps1',
    'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs').split('\n').filter(Boolean);
  for(const name of await readdir(path.join(APP,'scripts')))if(/^xc[467]-/.test(name))files.push('apps/customer-web/scripts/'+name);
  for(const file of [...new Set(files)].sort())rows.push(await fileId(path.join(ROOT,file)));
  return rows;
}
export async function assets(){
  const paths=['backend/data/work/xc6_capture/fake-device.wav','apps/customer-web/public/engineering/xc4/fir-160-441.f32',
    'apps/customer-web/public/engineering/xc6/fir-1-3.f32','backend/data/work/xc6_capture/dsp48_reference.json',
    'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx'];
  for(const name of ['ort.webgpu.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'])paths.push('apps/customer-web/node_modules/onnxruntime-web/dist/'+name);
  const ref=await load(path.join(ROOT,'backend/data/work/xc6_capture/dsp48_reference.json'));
  for(const f of ref.fixtures)for(const key of ['input','reference'])paths.push('backend/data/work/xc6_capture/'+f[key]);
  return Promise.all(paths.map(p=>fileId(path.join(ROOT,p))));
}
export async function requireRemoteFreeze(){
  const f=await load(freezePath),{freezeSha256,...body}=f;
  if(hash(canonical(body))!==freezeSha256||canonical(await sources())!==canonical(f.sources)
    ||canonical(await assets())!==canonical(f.assets))throw new Error('XC7_SOURCE_OR_ASSET_DRIFT');
  const commit=git('log','-1','--format=%H','--',path.relative(ROOT,freezePath));
  const remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s+/)[0];
  if(commit!==git('rev-parse','HEAD')||remote!==commit||git('status','--porcelain'))throw new Error('XC7_REQUIRE_CLEAN_REMOTE_FREEZE_STOP');
  return {phase:PHASE,freezeCommit:commit,freezeSha256,remoteHead:remote,remoteVerifiedAt:new Date().toISOString(),sourcesVerified:true,assetsVerified:true};
}
export async function assertFrozenSources(){const f=await load(freezePath);if(canonical(await sources())!==canonical(f.sources))throw new Error('XC7_SOURCE_CHANGED_AFTER_FREEZE');return f;}
const command=process.argv[2];
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(command==='freeze'){
    if(git('status','--porcelain'))throw new Error('COMMIT_IMPLEMENTATION_FIRST');
    const old=JSON.parse(git('show',`${START}:backend/research/reports/phase9g_xc4_engineering_default_freeze_2026-10-16.json`));
    if(hash(canonical(old.engineeringDefaultIdentity))!==CORE)throw new Error('XC4_IDENTITY_DRIFT');
    const f={phase:PHASE,startingRemoteHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),freezeId,
      xc4CoreIdentitySha256:CORE,sources:await sources(),assets:await assets(),
      policy:{maxOutstandingAcousticWindows:4,maxDiagnosticWindows:32,maxCaptureUnacknowledgedBlocks:32,maxCaptureBlockSamples:2048,
        timeline:'ONE_SEGMENT_METADATA_ONLY_ZERO_PCM',overflow:'ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED',
        noSemanticPublicationAfterFailure:true,productCapability:'MODEL_NOT_VALIDATED',productionMicrophone:false},
      testPlan:{vitestFiles:['xc7-bounded-resources.test.ts','xc6-capture-bridge.test.ts','xc4-robust-runtime.test.ts','input-capability.test.ts'],
        longSimulationSeconds:1800,longSimulationOnnxRuns:0,dspFixtures:'Reuse existing28 XC6 reference fixtures; no new DSP design.',
        typecheck:'customer-web tsc --noEmit --incremental false',bundle:'XC7 engineering entry and existing worker only, not full production build',
        browser:'One headed branded Chrome fake-media capture,2model runs, no real-device request/scoring/MIDI.'},
      guardRationale:'4 is2x observed finite-session maximum depth2;32 diagnostics is19.2seconds, neither is a UX SLO.',
      historicalReportsUnchanged:true};
    f.freezeSha256=hash(canonical(f));await newJson(freezePath,f);
  }else if(command==='verify')await newJson(path.join(WORK,`checks_remote_proof_${freezeId}.json`),await requireRemoteFreeze());
  else throw new Error('XC7_EVIDENCE_COMMAND');
}
