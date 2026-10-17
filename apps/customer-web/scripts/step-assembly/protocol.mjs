import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson} from '../audio-context-clock/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const ID='step_assembly_development_v1',START='1d738d8b8053899d5e52c29fb417736b1bc47b28';
export const PHASE='PRACTICE_STEP_ACOUSTIC_ATTEMPT_ASSEMBLY_ENGINEERING_QUALIFICATION_DISABLED';
export const SUCCESS='STEP_ACOUSTIC_ATTEMPT_ASSEMBLY_ENGINEERING_CANDIDATE_ESTABLISHED_DISABLED';
export const BLOCKED='STEP_ACOUSTIC_ATTEMPT_ASSEMBLY_NOT_ESTABLISHED';
export const BASE='backend/data/work/step_domain/step_domain_v2/musical';
export const WORK=path.join(ROOT,'backend/data/work/step_attempt_assembly',ID,'musical');
export const FREEZE=`backend/research/reports/${ID}_freeze_2026-10-18.json`;
export const paths=()=>({work:path.join(ROOT,'backend/data/work/step_attempt_assembly',ID,'controller')});
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
  if(git('status','--porcelain'))throw Error('UNCOMMITTED_TOOLING');
  const files=git('ls-files','apps/customer-web','backend/research/step_attempt_assembly','backend/research/step_waiting',
   'backend/research/step_decoded_sufficiency','backend/app/modules/model_assets','backend/tests/test_practice_acoustic_model_asset.py',
   'backend/tests/test_model_assets.py','backend/research/browser_runtime/xc1_browser_runtime_shared.mjs').split('\n').filter(Boolean);
  const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
  files.push(MODEL,FIXTURE,...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
   'backend/data/work/product_completion_replay/v1/audio_only/manifest.json','backend/data/work/product_completion_replay/v4/truth.json',
   ...['musical.json','scores.json'].map(f=>BASE+'/'+f),
   ...['acoustic.json','acoustic-seal.json','truth.json','inventory.json'].map(f=>'backend/research/reports/step_decoded_sufficiency_v1/'+f),
   ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
  await newJson(path.join(ROOT,FREEZE),{phase:PHASE,stage:'DEVELOPMENT_BUDGET_AND_REGRESSION_FREEZE_NOT_SELECTED_CANDIDATE_QUALIFICATION',
   startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),files:await Promise.all([...new Set(files)].map(fileIdentity)),
   developmentPlan:JSON.parse(await readFile(path.join(ROOT,'backend/research/step_attempt_assembly/development-plan.json'),'utf8')),
   holdout:'NOT_SELECTED_OR_OPENED; only after one safety-eligible candidate exists, under a new prospective candidate/holdout freeze',
   protectedPaths:PROTECTED,protectedSourceDiff:git('diff',START,'HEAD','--',...PROTECTED),
   model:{assetId:'practice-acoustic-robust-browser',version:'v1',bytes:98689283,sha256:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
    ort:'1.20.1',provider:'webgpu',automaticFallback:false,onset:.30,frame:.05,inputSamples:29120,ownedMs:600,futureMs:170,pastMs:1050},
   testPlan:['new research assembly contracts','development replay existing sealed outputs for all five H values','all zero-danger eligibility before holdout',
    'full Vitest + STEP/domain/controller/MIDI/Continuous suites','TypeScript noEmit','ESLint JSON','Next full production webpack build',
    'Docker model asset unit/routes','8 Continuous engineering cells','8 Continuous musical cells + controller replay + exact baseline parity'],
   productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED'});
  console.log(FREEZE);
 }else console.log(JSON.stringify(await verify()));
}
