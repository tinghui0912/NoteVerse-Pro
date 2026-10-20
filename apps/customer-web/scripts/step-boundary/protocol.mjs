import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson } from '../audio-context-clock/protocol.mjs';
export { ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson };
export const ID='step_boundary_v1', START='4901be2dc86c7a57eb1eb323f98293de809d0b7c';
export const PHASE='PRACTICE_STEP_EXCLUSIVE_ATTEMPT_BOUNDARY_REPAIR';
export const SUCCESS='PRACTICE_STEP_ONE_TARGET_ONE_ATTEMPT_DOMAIN_CONTROLLER_READY_MICROPHONE_DISABLED_BOUNDARY_REPAIRED';
export const BLOCKED='PRACTICE_STEP_EXCLUSIVE_ATTEMPT_BOUNDARY_REPAIR_BLOCKED';
export const BASE='backend/data/work/step_domain/step_domain_v2/musical';
export const PROTECTED=['apps/customer-web/src/lib/practice/acoustic/model','apps/customer-web/src/lib/practice/acoustic/source',
 'apps/customer-web/src/lib/practice/acoustic/runtime','apps/customer-web/src/lib/practice/acoustic/continuous',
 'apps/customer-web/public/model-assets/practice-acoustic','backend/app/modules/model_assets',
 'apps/customer-web/src/lib/practice/continuous','apps/customer-web/src/lib/practice/local-core/continuous-*',
 'apps/customer-web/src/lib/practice/local-core/performance-runtime.ts','apps/customer-web/src/lib/practice/local-core/performance-clock-runtime.ts',
 'apps/customer-web/src/lib/practice/input-capability.ts','apps/customer-web/src/lib/practice/input-capability-reasons.ts'];
export const WORK=path.join(ROOT,'backend/data/work/step_boundary',ID,'musical');
export const FREEZE=`backend/research/reports/step_boundary_freeze_${ID}_2026-10-17.json`;
export const paths=()=>({work:path.join(ROOT,'backend/data/work/step_boundary',ID,'controller'),freeze:path.join(ROOT,FREEZE)});
export async function verify(){
  const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
  const commit=git('log','-1','--format=%H','--',FREEZE);
  const remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  const remoteVerifiedAt=new Date().toISOString();
  if(remote!==commit||git('rev-parse','HEAD')!==commit)throw new Error('REMOTE_FREEZE_MISMATCH');
  for(const expected of plan.files){const actual=await fileIdentity(expected.path);if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)throw new Error('FROZEN_FILE_CHANGED:'+expected.path);}
  if(execFileSync('docker',['image','inspect',plan.docker.tag,'--format','{{.Id}}'],{encoding:'utf8'}).trim()!==plan.docker.id)throw new Error('DOCKER_CHANGED');
  if(git('diff',START,'HEAD','--',...PROTECTED))throw new Error('PROTECTED_SOURCE_CHANGED');
  const executionStartedAt=new Date().toISOString();
  if(!(Date.parse(remoteVerifiedAt)<Date.parse(executionStartedAt)))throw new Error('PRE_EXECUTION_PROOF_ORDER_INVALID');
  return {freezeCommit:commit,remoteHead:remote,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='freeze'){
    if(git('status','--porcelain'))throw new Error('UNCOMMITTED_SOURCE');
    const files=git('ls-files','apps/customer-web','backend/app/modules/model_assets','backend/app/core/settings/model_asset_delivery.py',
      'backend/tests/test_practice_acoustic_model_asset.py','backend/tests/test_model_assets.py',
      'backend/research/history/step-original-bytedance-low-level-before-domain-reset','docker/research/Dockerfile.practice-acoustic-qualification',
      'docs/architecture/practice-product-contract.md','backend/research/browser_runtime/xc1_browser_runtime_shared.mjs').split('\n').filter(Boolean);
    const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
    files.push(MODEL,FIXTURE,...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
      'backend/research/reports/product_completion_corpus_v1_2026-10-17.json',
      'backend/data/work/product_completion_replay/v1/audio_only/manifest.json',
      'backend/data/work/product_completion_replay/v4/truth.json',
      ...['musical.json','scores.json'].map(f=>BASE+'/'+f),
      ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
    await newJson(path.join(ROOT,FREEZE),{phase:PHASE,startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
      files:await Promise.all([...new Set(files)].map(fileIdentity)),
      docker:{tag:'noteverse-practice-acoustic-qualification:local',id:execFileSync('docker',['image','inspect','noteverse-practice-acoustic-qualification:local','--format','{{.Id}}'],{encoding:'utf8'}).trim()},
      contract:{attempts:1,gestureMs:35,historyRecords:100000,schema:2,runtime:'step-bounded-attempt-v2',
        verdicts:['MATCH','MISMATCH','RETRY'],activationBoundary:'EXCLUSIVE',attemptStart:'strictly greater than activationBoundary',gestureOwnership:'[start,end)',
        boundaryEndEvent:'ignored in both callback orders',skip:'separate user action',noQueue:true,noRestore:true,noMicrophoneAnalyzer:true},
      protectedPaths:PROTECTED,protectedSourceDiff:git('diff',START,'HEAD','--',...PROTECTED),
      model:{bytes:98689283,sha256:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',ort:'1.20.1',provider:'webgpu',automaticFallback:false,
        onset:.30,frame:.05,inputSamples:29120,ownedMs:600,futureMs:170,pastMs:1050},
      resourceLimits:{targetSamples:65536,outstanding:4,workletCredits:32,sourceBlockSamples:2048,diagnosticWindows:32,continuousBoundaries:8},
      sourceIdentities:JSON.parse(await readFile(path.join(APP,'src/lib/practice/acoustic/source/source-adapter-identities.json'),'utf8')),
      plan:['full Vitest incl domain/controller/MIDI/architecture tests','TypeScript noEmit','ESLint JSON all messages','Next production webpack build',
        'Docker shared model unittest/routes','dedicated STEP deterministic qualification with named identity/generation race witnesses',
        '8 Continuous controller fake-media cells','8 Continuous musical cells + production-controller replay','exact semantic comparison to accepted step-domain v2'],
      noTuning:true,noNewDataset:true,productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',acceptance:SUCCESS,blocked:BLOCKED});
    console.log(FREEZE);
  }else console.log(JSON.stringify(await verify()));
}
