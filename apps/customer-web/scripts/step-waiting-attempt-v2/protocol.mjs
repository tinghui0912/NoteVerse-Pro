import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson} from '../audio-context-clock/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const START='a361f03dd03a13c7bcd36981e1fe9227407f2c89',ID=process.env.WAITING_ATTEMPT_FREEZE_ID??'waiting_attempt_v2_f3';
export const DATA=path.join(ROOT,'backend/data/work/step_waiting_attempt_v2/v2');
export const FREEZE=`backend/research/reports/${ID}_freeze_2026-10-18.json`;
export const BASE='backend/data/work/step_domain/step_domain_v2/musical';
export const WORK=path.join(ROOT,'backend/data/work/step_waiting_attempt_v2',ID,'musical');
export const paths=()=>({work:path.join(ROOT,'backend/data/work/step_waiting_attempt_v2',ID,'controller')});
export const SUCCESS='STEP_ACOUSTIC_WAITING_ATTEMPT_CANDIDATE_QUALIFIED_FOR_DISABLED_INTEGRATION';
export const BLOCKED='STEP_ACOUSTIC_WAITING_ATTEMPT_SAFETY_NOT_ESTABLISHED';
export const PROTECTED=['apps/customer-web/src','apps/customer-web/public','backend/app'];
export async function verify(){
 const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
 const freezeCommit=git('log','-1','--format=%H','--',FREEZE);
 const remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 const remoteVerifiedAt=new Date().toISOString();
 if(remoteHead!==freezeCommit||git('rev-parse','HEAD')!==freezeCommit)throw Error('REMOTE_FREEZE_MISMATCH');
 for(const f of plan.files){const actual=await fileIdentity(f.path);if(actual.sha256!==f.sha256||actual.bytes!==f.bytes)throw Error('FROZEN_FILE_CHANGED:'+f.path);}
 if(git('diff',START,'HEAD','--',...PROTECTED))throw Error('PROTECTED_PRODUCT_SOURCE_CHANGED');
 await new Promise(r=>setTimeout(r,2));
 return {freezeCommit,remoteHead,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='freeze'){
  if(git('status','--porcelain'))throw Error('UNCOMMITTED_SOURCE');
  const jobs=JSON.parse(await readFile(path.join(DATA,'audio_only/jobs.json'),'utf8')).jobs;
  const files=git('ls-files','apps/customer-web','backend/research/step_waiting_attempt_v2',
   'backend/research/history/continuous-browser-runners-before-canonical-v1','backend/app/modules/model_assets',
   'backend/tests/test_practice_acoustic_model_asset.py','backend/tests/test_model_assets.py',
   'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs','backend/research/reports/fresh_strike_v2/dataset-audit.json',
   'backend/research/reports/step_decoded_sufficiency_v1/inventory.json','backend/research/reports/fresh_strike_v2/development-manifest.json').split('\n').filter(Boolean);
  const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
  files.push(MODEL,FIXTURE,...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),...jobs.map(j=>j.path),
   ...['metadata-audit.json','truth.json','audio_only/jobs.json'].map(f=>path.relative(ROOT,path.join(DATA,f))),
   'backend/data/work/product_completion_replay/v1/audio_only/manifest.json','backend/data/work/product_completion_replay/v4/truth.json',
   ...['musical.json','scores.json'].map(f=>BASE+'/'+f),
   ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
  const contract=JSON.parse(await readFile(path.join(ROOT,'backend/research/step_waiting_attempt_v2/contract.json'),'utf8'));
  await newJson(path.join(ROOT,FREEZE),{phase:contract.phase,startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
   contract,metadataAudit:JSON.parse(await readFile(path.join(DATA,'metadata-audit.json'),'utf8')),
   files:await Promise.all([...new Set(files)].map(fileIdentity)),
   protectedSourceDiff:git('diff',START,'HEAD','--',...PROTECTED),
   executionOrder:['static','Continuous engineering8','Continuous musical8 + controller + semantic parity','Stage A one shared Worker/model30 jobs','read-only SHA256 seal','Stage B truth/product scoring','evidence','GitHub receipt'],
   stageAOnly:['PCM','source chronology','FIR','production acoustic model/Worker/runtime','score-blind fixed50ms assembly'],
   gates:{allArchitectureCountersZero:true,allEmpiricalFalseMatchCountersZero:true,continuousRegressionPass:true,
    usefulSinglesAndChordsMeasured:true,waitingOpportunityPrecedesReadyIsNotValidWaitingAcceptance:true,noReplacement:true},
   capabilities:contract.capabilities});
  console.log(FREEZE);
 }else console.log(JSON.stringify(await verify()));
}
