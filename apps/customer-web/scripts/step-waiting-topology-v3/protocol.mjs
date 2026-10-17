import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson} from '../audio-context-clock/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const START='966ea6b1a74907544ab9419b52a69700b067a993',ID='waiting_topology_v3_f1';
export const DATA=path.join(ROOT,'backend/data/work/step_waiting_topology_v3/corpus-v3');
export const INVENTORY='backend/data/work/step_waiting_topology_v3/metadata-v4/inventory.json';
export const FREEZE=`backend/research/reports/${ID}_freeze_2026-10-18.json`;
export const BASE='backend/data/work/step_domain/step_domain_v2/musical';
export const WORK=path.join(ROOT,'backend/data/work/step_waiting_topology_v3',ID,'musical');
export const paths=()=>({work:path.join(ROOT,'backend/data/work/step_waiting_topology_v3',ID,'controller')});
export const SUCCESS='STEP_WAITING_USER_PRODUCT_TOPOLOGY_ENGINEERING_QUALIFIED_DISABLED',BLOCKED='STEP_WAITING_USER_PRODUCT_TOPOLOGY_NOT_ESTABLISHED';
export async function verify(){
 const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8')),freezeCommit=git('log','-1','--format=%H','--',FREEZE);
 const remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0],remoteVerifiedAt=new Date().toISOString();
 if(remoteHead!==freezeCommit||git('rev-parse','HEAD')!==freezeCommit)throw Error('REMOTE_FREEZE_MISMATCH');
 for(const f of plan.files){const v=await fileIdentity(f.path);if(v.sha256!==f.sha256||v.bytes!==f.bytes)throw Error('FROZEN_INPUT_CHANGED:'+f.path);}
 if(git('diff',START,'HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app'))throw Error('PRODUCT_SOURCE_CHANGED');
 await new Promise(r=>setTimeout(r,2));
 return {freezeCommit,remoteHead,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='freeze'){
  if(git('status','--porcelain'))throw Error('UNCOMMITTED_SOURCE');
  const jobs=JSON.parse(await readFile(path.join(DATA,'audio_only/jobs.json'),'utf8')).jobs;
  const files=git('ls-files','apps/customer-web','backend/research/step_waiting_topology_v3','backend/research/step_waiting_attempt_v2',
   'backend/research/step_waiting/product-replay.ts','backend/research/browser_runtime/xc1_browser_runtime_shared.mjs',
   'backend/research/fresh_strike/prepare.py','backend/research/fresh_strike/audit.py','backend/tests/test_practice_acoustic_model_asset.py','backend/tests/test_model_assets.py',
   'backend/research/reports/fresh_strike_v2/dataset-audit.json','backend/research/reports/fresh_strike_v2/development-manifest.json',
   'backend/research/reports/step_decoded_sufficiency_v1/inventory.json','backend/research/reports/step_waiting_attempt_v2/truth.json').split('\n').filter(Boolean);
  const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
  files.push(MODEL,FIXTURE,INVENTORY,...jobs.map(j=>j.path),...['truth.json','audio_only/jobs.json'].map(f=>path.relative(ROOT,path.join(DATA,f))),
   ...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
   'backend/data/work/product_completion_replay/v1/audio_only/manifest.json','backend/data/work/product_completion_replay/v4/truth.json',
   ...['musical.json','scores.json'].map(f=>BASE+'/'+f),
   ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
  const contract=JSON.parse(await readFile(path.join(ROOT,'backend/research/step_waiting_topology_v3/contract.json'),'utf8'));
  const inventory=JSON.parse(await readFile(path.join(ROOT,INVENTORY),'utf8'));
  if(inventory.missing.length||inventory.contractSha256!==hash(await readFile(path.join(ROOT,'backend/research/step_waiting_topology_v3/contract.json'))))throw Error('METADATA_GATE');
  await newJson(path.join(ROOT,FREEZE),{phase:contract.phase,startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),contract,
   metadataInventory:inventory,files:await Promise.all([...new Set(files)].map(fileIdentity)),
   executionOrder:['static','Continuous engineering8','Continuous musical8 + controller + exact semantic parity','Stage A causal source replay','readonly acoustic seal','Stage B truth/product scoring','evidence','GitHub receipt'],
   protectedSourceDiff:git('diff',START,'HEAD','--','apps/customer-web/src','apps/customer-web/public','backend/app'),capabilities:contract.capabilities});
  console.log(FREEZE);
 }else console.log(JSON.stringify(await verify()));
}
