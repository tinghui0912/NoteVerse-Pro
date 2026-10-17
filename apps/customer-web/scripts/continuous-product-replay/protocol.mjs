import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson,freeze as engineeringFreeze} from '../continuous-controller/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const START='b402dda20dbc9304e5488ceefc32dc995bd76674';
export const ID='product_replay_v4';
export const WORK=path.join(ROOT,'backend/data/work/product_completion_replay/v4');
export const CORPUS='backend/research/reports/product_completion_corpus_v1_2026-10-17.json';
export const FREEZE='backend/research/reports/product_completion_freeze_v4_2026-10-17.json';
export const PHASE='PRACTICE_CONTINUOUS_MICROPHONE_PRODUCT_COMPLETION_REPLAY_QUALIFICATION';
export const SUCCESS='CONTINUOUS_MICROPHONE_PRODUCT_FUNCTIONALITY_COMPLETE_HARDWARE_GATE_DEFERRED';
export const BLOCKED='CONTINUOUS_MICROPHONE_PRODUCT_COMPLETION_BLOCKED';
export async function verify(){
  const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
  const commit=git('log','-1','--format=%H','--',FREEZE),remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if(remote!==commit||git('rev-parse','HEAD')!==commit)throw new Error('REMOTE_FREEZE_MISMATCH');
  for(const expected of plan.files){const actual=await fileIdentity(expected.path);if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)throw new Error('FREEZE_CHANGED:'+expected.path);}
  return {freezeCommit:commit,remoteHead:remote,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='freeze'){
    if(git('status','--porcelain'))throw new Error('UNCOMMITTED_SOURCE');
    await engineeringFreeze(ID);
    const corpus=JSON.parse(await readFile(path.join(ROOT,CORPUS),'utf8'));
    const files=git('ls-files','apps/customer-web','docs/architecture/practice-product-contract-v2.md','backend/research/qualification/product_replay_prepare.py','backend/research/qualification/test_product_replay_prepare.py','backend/app/modules/model_assets','backend/tests/test_continuous_model_asset.py',CORPUS).split('\n').filter(Boolean);
    files.push(MODEL,FIXTURE,`backend/research/reports/continuous_controller_freeze_${ID}_2026-10-17.json`,
      'backend/research/reports/product_completion_invalidation_v1_2026-10-17.json',
      'backend/research/reports/product_completion_musical_invalid_v1_2026-10-17.json',
      'backend/research/reports/product_completion_invalidation_v2_2026-10-17.json',
      'backend/research/reports/product_completion_musical_invalid_v2_2026-10-17.json',
      'backend/research/reports/product_completion_invalidation_v3_2026-10-17.json',
      'backend/research/reports/product_completion_musical_invalid_v3_2026-10-17.json',
      ...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
      ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(p=>'apps/customer-web/node_modules/onnxruntime-web/'+p));
    await newJson(path.join(ROOT,FREEZE),{phase:PHASE,startingHead:START,implementationCommit:git('log','-1','--format=%H','--','apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts'),toolingCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
      files:await Promise.all(files.map(fileIdentity)),corpus:CORPUS,engineeringRegressionId:ID,
      model:{bytes:98689283,sha256:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',ort:'1.20.1',provider:'webgpu',fallback:false},
      rates:[44100,48000],matchingWindowMs:250,primary:'3 fixed paired 6s clips per rate plus 1.8s synthetic silence per rate; one production Worker/model execution stream, no decode comparison',
      truthSeal:'Audio-only manifest served to browser; no MIDI/truth files served. Docker MIDI read and test-side product scenarios only after all outputs sealed.',
      replayClock:'max(source performance cursor, 0) + elapsed processing time; monotonic logical offline availability, NOT measured causal latency. Physical event times stay source-derived. Production clock and runtime unchanged.',
      productScenarios:'Frozen construction algorithm in product-scenarios.ts, no prediction-dependent choices; separate hand-authored perfect-evidence semantic tests.',
      constructionClarification:'The corpus narrative uses a loose silent-interval description. The exact implementation frozen since d1c1a901 instead adds a separate absent-pitch group at the first physical group time, retains all base expected groups, and guards absence of that pitch within +/-250ms. This is counterfactual single-owner evaluation, not a naturally silent interval. No recipe code, selected input, MIDI or model behavior was changed.',
      faultPolicy:'Track ended/mute or session context not running => fatal session, block ingestion, invalidate recording/evaluation, no completed store, detach before normal cleanup. Healthy-context Worker failure remains analysis-only.',
      verification:['full Vitest','TypeScript noEmit','ESLint complete JSON','Next full webpack build','Docker asset unittest','Node truth-matching tests','8-cell existing real controller fake-media regression','paired audio real Worker/WebGPU replay'],
      acceptance:SUCCESS,thresholdPolicy:'Report fixed model metrics without tuning or hardware enablement thresholds; infrastructure and invariant failures block.',
      productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',realPhysicalMicrophones:0,realDeviceQualification:'DEFERRED',hardwareEnablementGate:'NOT_EXECUTED'});
    console.log(FREEZE);
  }else console.log(JSON.stringify(await verify()));
}
