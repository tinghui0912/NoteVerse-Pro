import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson} from '../audio-context-clock/protocol.mjs';
export {ROOT,APP,MODEL,FIXTURE,git,hash,fileIdentity,newJson};
export const ID='shared_acoustic_v3';
export const START='21e9b67b71ab156fd0140290c3a7a857b1ee493d';
export const PHASE='PRACTICE_SHARED_ACOUSTIC_FOUNDATION_CLEAN_BREAK_REFACTOR';
export const SUCCESS='PRACTICE_SHARED_ACOUSTIC_FOUNDATION_REFACTORED_CONTINUOUS_PARITY_PRESERVED';
export const BLOCKED='PRACTICE_SHARED_ACOUSTIC_FOUNDATION_REFACTOR_BLOCKED';
export const WORK=path.join(ROOT,'backend/data/work/shared_acoustic',ID,'musical');
export const FREEZE=`backend/research/reports/shared_acoustic_freeze_${ID}_2026-10-17.json`;
export const paths=()=>({work:path.join(ROOT,'backend/data/work/shared_acoustic',ID,'controller'),freeze:path.join(ROOT,FREEZE)});
export async function verify(){
 const freeze=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
 const commit=git('log','-1','--format=%H','--',FREEZE),remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s+/)[0];
 if(remote!==commit||git('rev-parse','HEAD')!==commit)throw new Error('REMOTE_FREEZE_MISMATCH');
 if(execFileSync('docker',['image','inspect',freeze.qualificationDockerImage.tag,'--format','{{.Id}}'],{encoding:'utf8'}).trim()!==freeze.qualificationDockerImage.id)throw new Error('QUALIFICATION_DOCKER_IMAGE_CHANGED');
 for(const expected of freeze.files){const actual=await fileIdentity(expected.path);if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)throw new Error('FROZEN_FILE_CHANGED:'+expected.path);}
 return {freezeCommit:commit,remoteHead:remote,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt:new Date().toISOString()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='freeze'){
  if(git('status','--porcelain'))throw new Error('UNCOMMITTED_SOURCE');
  const corpus=JSON.parse(await readFile(path.join(ROOT,'backend/research/reports/product_completion_corpus_v1_2026-10-17.json'),'utf8'));
  const files=git('ls-files','apps/customer-web','docker/research/Dockerfile.practice-acoustic-qualification','backend/docs/contracts/openapi/customer-api.json','backend/app/modules/model_assets','backend/app/core/settings/model_asset_delivery.py','backend/tests/test_model_assets.py','backend/tests/test_continuous_model_asset.py','backend/research/history/shared-acoustic-before-clean-break','backend/research/qualification/shared_acoustic_relocation.mjs','docs/architecture/practice-product-contract-v2.md','backend/research/reports/shared_acoustic_invalidation_v1_2026-10-17.json').split('\n').filter(Boolean);
  files.push(MODEL,FIXTURE,...corpus.clips.flatMap(c=>Object.values(c.pcm).map(p=>p.path)),
   'backend/research/reports/product_completion_corpus_v1_2026-10-17.json','backend/research/reports/shared_acoustic_invalidation_v2_2026-10-17.json',
   'backend/data/work/product_completion_replay/v4/musical.json','backend/data/work/product_completion_replay/v4/scores.json','backend/data/work/product_completion_replay/v4/truth.json',
   'backend/data/work/product_completion_replay/v1/audio_only/manifest.json',
   ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(p=>'apps/customer-web/node_modules/onnxruntime-web/'+p));
  await newJson(path.join(ROOT,FREEZE),{phase:PHASE,startingHead:START,implementationCommit:git('rev-parse','HEAD'),productImplementationCommit:git('log','-1','--format=%H','--','apps/customer-web/src/lib/practice/acoustic'),createdAt:new Date().toISOString(),files:await Promise.all([...new Set(files)].map(fileIdentity)),
   qualificationDockerImage:{tag:'noteverse-practice-acoustic-qualification:local',id:execFileSync('docker',['image','inspect','noteverse-practice-acoustic-qualification:local','--format','{{.Id}}'],{encoding:'utf8'}).trim(),baseImageId:'sha256:1970e6526fc3c4d787efdba379c5e42fbe2c144c97e4df9544074f28753e8e0c',testDependencies:{pytest:'8.3.5',httpx2:'2.13.1'}},
   model:{assetId:'practice-acoustic-robust-browser',version:'v1',bytes:98689283,sha256:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',ort:'1.20.1',provider:'webgpu',fallback:false,onset:.30,frame:.05,inputSamples:29120,owned:600,future:170,past:1050},
   sourceRates:[44100,48000],baseline:'Accepted product replay v4; implementation parity only, not fresh science',
   architecture:'One source-domain scheduler/model/worker/capture. Continuous projection alone owns performance mapping, boundary scheduling and terminal-T.',
   resourceLimits:{targetSamples:65536,outstanding:4,workletCredits:32,blockSamples:2048,compactDiagnostics:32,continuousBoundaries:8},
   parityPlan:'Exact product publication/observation IDs, pitch, confidence, provenance, performance time, coverage, final semantic scenarios vs v4; availability and compact execution diagnostics are measured anew.',
   verification:['full Vitest','TypeScript noEmit','ESLint full JSON','Next production build --webpack','Docker model-asset tests','8 controller browser cells','8 musical cells plus existing production-controller replay','v4 semantic parity'],
   acceptance:SUCCESS,blocked:BLOCKED,productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',newAcousticScience:false});
  console.log(FREEZE);
 }else console.log(JSON.stringify(await verify()));
}
