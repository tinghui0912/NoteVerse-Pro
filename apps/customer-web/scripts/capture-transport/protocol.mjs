import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson} from '../audio-context-clock/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const START='b3468c3938d0074163605360f84bb47af3eb899d';
export const STAGE=process.env.CAPTURE_STAGE??'diagnostic';
if(!['diagnostic','acceptance'].includes(STAGE))throw Error('INVALID_STAGE');
export const ID=`capture_transport_${STAGE}_v${STAGE==='diagnostic'?2:1}`;
export const FREEZE=`backend/research/reports/${ID}_freeze.json`;
export const BASE='backend/data/work/step_domain/step_domain_v2/musical';
export const WORK=path.join(ROOT,'backend/data/work/capture_transport',ID,'musical');
export const paths=()=>({work:path.join(ROOT,'backend/data/work/capture_transport',ID,'controller')});
export const SUCCESS='PRACTICE_SHARED_ACOUSTIC_CAPTURE_TRANSPORT_STABLE_CONTINUOUS_PARITY_PRESERVED_STEP_DISABLED';
export const BLOCKED='PRACTICE_SHARED_ACOUSTIC_CAPTURE_TRANSPORT_STABILITY_NOT_ESTABLISHED';
export async function verify(){
 const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
 const freezeCommit=git('log','-1','--format=%H','--',FREEZE);
 const remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 const remoteVerifiedAt=new Date().toISOString();
 if(remoteHead!==freezeCommit||git('rev-parse','HEAD')!==freezeCommit)throw Error('REMOTE_FREEZE_MISMATCH');
 for(const file of plan.files){const actual=await fileIdentity(file.path);if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)throw Error('FROZEN_FILE_CHANGED:'+file.path);}
 if(STAGE==='diagnostic'&&git('diff',START,'HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app'))throw Error('DIAGNOSIS_MUST_NOT_CHANGE_PRODUCT');
 await new Promise(r=>setTimeout(r,2));
 return {freezeCommit,remoteHead,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='freeze'){
  if(git('status','--porcelain'))throw Error('UNCOMMITTED_SOURCE');
  const files=git('ls-files','apps/customer-web','backend/app/modules/model_assets','backend/tests/test_practice_acoustic_model_asset.py','backend/tests/test_model_assets.py',
   'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs').split('\n').filter(Boolean);
  const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
  files.push(MODEL,FIXTURE,...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
   'backend/data/work/product_completion_replay/v1/audio_only/manifest.json','backend/data/work/product_completion_replay/v4/truth.json',
   ...['musical.json','scores.json'].map(f=>BASE+'/'+f),
   ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
  await newJson(path.join(ROOT,FREEZE),{stage:STAGE,startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
   contract:JSON.parse(await readFile(path.join(APP,'scripts/capture-transport/contract.json'),'utf8')),
   files:await Promise.all([...new Set(files)].map(fileIdentity)),productionDiff:git('diff',START,'HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app')});
  console.log(FREEZE);
 }else console.log(JSON.stringify(await verify()));
}
