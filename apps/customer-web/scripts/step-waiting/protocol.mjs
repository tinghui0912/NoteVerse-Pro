import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson} from '../audio-context-clock/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const ID=process.env.STEP_WAITING_FREEZE_ID??'step_waiting_v1', START='acb73c8c6ada20a0e0d47bcf279661982c11d674';
export const PHASE='PRACTICE_STEP_WAITING_LIFECYCLE_INPUT_ELIGIBILITY_CLEAN_BREAK';
export const SUCCESS='PRACTICE_STEP_WAITING_LIFECYCLE_INPUT_ELIGIBILITY_READY_MICROPHONE_DISABLED';
export const BLOCKED='PRACTICE_STEP_WAITING_LIFECYCLE_INPUT_ELIGIBILITY_BLOCKED';
export const BASE='backend/data/work/step_domain/step_domain_v2/musical';
export const WORK=path.join(ROOT,'backend/data/work/step_waiting',ID,'musical');
export const FREEZE=`backend/research/reports/${ID}_freeze_2026-10-18.json`;
export const paths=()=>({work:path.join(ROOT,'backend/data/work/step_waiting',ID,'controller'),freeze:path.join(ROOT,FREEZE)});
export const PROTECTED=['apps/customer-web/src/lib/practice/acoustic','apps/customer-web/public/model-assets/practice-acoustic',
  'backend/app/modules/model_assets','apps/customer-web/src/lib/practice/local-core/continuous-*',
  'apps/customer-web/src/lib/practice/local-core/performance-runtime.ts','apps/customer-web/src/lib/practice/local-core/performance-clock-runtime.ts',
  'apps/customer-web/src/lib/practice/continuous/continuous-practice-controller.ts',
  'apps/customer-web/src/lib/practice/input-capability.ts','apps/customer-web/src/lib/practice/input-capability-reasons.ts'];
export async function verify(){
 const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
 const commit=git('log','-1','--format=%H','--',FREEZE);
 const remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 const remoteVerifiedAt=new Date().toISOString();
 if(remote!==commit||git('rev-parse','HEAD')!==commit)throw Error('REMOTE_FREEZE_MISMATCH');
 for(const f of plan.files){const actual=await fileIdentity(f.path);if(actual.sha256!==f.sha256||actual.bytes!==f.bytes)throw Error('FROZEN_FILE_CHANGED:'+f.path);}
 if(git('diff',START,'HEAD','--',...PROTECTED))throw Error('PROTECTED_SOURCE_CHANGED');
 // Separate instants, not a rounded equality workaround for semantic event times.
 await new Promise(resolve=>setTimeout(resolve,2));
 return {freezeCommit:commit,remoteHead:remote,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='freeze'){
  if(git('status','--porcelain'))throw Error('UNCOMMITTED_SOURCE');
  const files=git('ls-files','apps/customer-web','backend/research/step_waiting','backend/research/step_decoded_sufficiency',
    'backend/research/history/step-boundary-before-waiting-lifecycle','backend/app/modules/model_assets',
    'backend/tests/test_practice_acoustic_model_asset.py','backend/tests/test_model_assets.py',
    'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs','docs/architecture/practice-product-contract-v2.md').split('\n').filter(Boolean);
  const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
  files.push(MODEL,FIXTURE,...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
    'backend/data/work/product_completion_replay/v1/audio_only/manifest.json','backend/data/work/product_completion_replay/v4/truth.json',
    ...['musical.json','scores.json'].map(f=>BASE+'/'+f),
    ...['acoustic.json','acoustic-seal.json','truth.json','product.json','scores.json','interpretation.json'].map(f=>'backend/research/reports/step_decoded_sufficiency_v1/'+f),
    ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
  await newJson(path.join(ROOT,FREEZE),{phase:PHASE,startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
    files:await Promise.all([...new Set(files)].map(fileIdentity)),
    docker:{tag:'noteverse-practice-acoustic-qualification:local',id:execFileSync('docker',['image','inspect','noteverse-practice-acoustic-qualification:local','--format','{{.Id}}'],{encoding:'utf8'}).trim()},
    contract:{schema:3,runtime:'step-waiting-attempt-v3',lifecycle:['READY','ACTIVE','ENDED'],attempts:1,
      inputEligibility:'eventTime > inputEligibleAfter; initial readiness / reconnect / skip explicit capture boundary',
      rearm:'future acoustic: physical captured-through source/session time, NOT analysis frontier or availability',
      midiOnlyChordCoherenceMs:35,midiRearm:'gesture capture end',noPauseResume:true,noQueue:true,noCompatibility:true,
      historyRecords:100000,acousticGestureAssemblySafety:'NOT_ESTABLISHED',previousAcousticFailureUnchanged:true},
    replay:{source:'existing sealed decoded acoustic.json; zero new STEP inference',
      captureClock:'counterfactual continuously advancing integer source-sample clock; physical capture continues independently of inference; sampled at READY transition',
      scope:'product input-eligibility mechanism, NOT acoustic safety qualification',
      grouping:'unchanged historical research-only 35ms assembler; not future product policy'},
    protectedPaths:PROTECTED,protectedSourceDiff:git('diff',START,'HEAD','--',...PROTECTED),
    model:{bytes:98689283,sha256:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',ort:'1.20.1',provider:'webgpu',automaticFallback:false},
    plan:['full Vitest','focused STEP + UI + MIDI + Continuous controller suites','tsc noEmit','ESLint JSON all messages','Next production webpack build',
      'Docker asset unittest/routes','sealed product-only capture eligibility replay','8 Continuous browser engineering cells','8 Continuous musical cells + production controller + exact semantic parity'],
    productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',acceptance:SUCCESS,blocked:BLOCKED});
  console.log(FREEZE);
 }else console.log(JSON.stringify(await verify()));
}
