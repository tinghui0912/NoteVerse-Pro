import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson} from '../audio-context-clock/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const START='15b8f0da94555af91c7d88eb28f151f566e75ff5';
export const ID='capture_aggregation_v2';
export const FREEZE=`backend/research/reports/${ID}_freeze.json`;
export const BASE='backend/data/work/step_domain/step_domain_v2/musical';
export const WORK=path.join(ROOT,'backend/data/work/capture_transport',ID,'musical');
export const paths=()=>({work:path.join(ROOT,'backend/data/work/capture_transport',ID,'controller')});
export const SUCCESS='PRACTICE_SHARED_ACOUSTIC_CAPTURE_TRANSPORT_STABILITY_REPAIRED_CONTINUOUS_PARITY_REESTABLISHED';
export const BLOCKED='PRACTICE_SHARED_ACOUSTIC_CAPTURE_TRANSPORT_REPAIR_BLOCKED';
export async function verify(){
 const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
 const freezeCommit=git('log','-1','--format=%H','--',FREEZE);
 const remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 const remoteVerifiedAt=new Date().toISOString();
 if(remoteHead!==freezeCommit||git('rev-parse','HEAD')!==freezeCommit)throw Error('REMOTE_FREEZE_MISMATCH');
 for(const file of plan.files){const actual=await fileIdentity(file.path);if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)throw Error('FROZEN_FILE_CHANGED:'+file.path);}
 const changed=git('diff','--name-only',START,'HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app').split('\n').filter(Boolean);
 const allowed=['capture.ts','capture.worklet.js','capture-transport-contract.ts'].map(p=>'apps/customer-web/src/lib/practice/acoustic/source/'+p);
 for(const file of changed)if(!file.endsWith('.test.ts')&&!allowed.includes(file))throw Error('PROTECTED_PRODUCT_CHANGED:'+file);
 await new Promise(r=>setTimeout(r,2));
 return {freezeCommit,remoteHead,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='freeze'){
  if(git('status','--porcelain'))throw Error('UNCOMMITTED_SOURCE');
  const files=git('ls-files','apps/customer-web','backend/app/modules/model_assets','backend/tests/test_practice_acoustic_model_asset.py','backend/tests/test_model_assets.py',
   'backend/research/history/capture-transport-128-quantum','backend/research/browser_runtime/xc1_browser_runtime_shared.mjs').split('\n').filter(Boolean);
  const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
  files.push(MODEL,FIXTURE,...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
   'backend/data/work/product_completion_replay/v1/audio_only/manifest.json','backend/data/work/product_completion_replay/v4/truth.json',
   ...['musical.json','scores.json'].map(f=>BASE+'/'+f),
   ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
  await newJson(path.join(ROOT,FREEZE),{startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
   contract:JSON.parse(await readFile(path.join(APP,'scripts/capture-aggregation/contract.json'),'utf8')),
   files:await Promise.all([...new Set(files)].map(fileIdentity)),productionDiff:git('diff',START,'HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app')});
  console.log(FREEZE);
 }else console.log(JSON.stringify(await verify()));
}
