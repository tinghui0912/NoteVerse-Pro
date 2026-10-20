import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const APP=path.join(ROOT,'apps/customer-web');
export const START='b2abd8937dbaf282bf69d607f6a197129612a251';
export const WORK=path.join(ROOT,'backend/data/work/step_decoded_sufficiency/v1-final');
export const FREEZE='backend/research/reports/step_decoded_sufficiency_freeze_v2_2026-10-18.json';
export const MODEL='backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx';
export const PROTECTED=['apps/customer-web/src/lib/practice/acoustic','apps/customer-web/public/model-assets/practice-acoustic',
 'backend/app','apps/customer-web/src/lib/practice/continuous','apps/customer-web/src/lib/practice/local-core/continuous-*',
 'apps/customer-web/src/lib/practice/local-core/performance-runtime.ts','apps/customer-web/src/lib/practice/local-core/timebase.ts',
 'apps/customer-web/src/lib/practice/input-capability.ts','backend/research/fresh_strike','backend/research/reports/fresh_strike*'];
export const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const portable=file=>path.relative(ROOT,file).split(path.sep).join('/');
export async function identity(file){const b=await readFile(path.join(ROOT,file));return{path:file,bytes:b.length,sha256:hash(b)};}
export async function json(file,value){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
export async function verify(){
 const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
 const freezeCommit=git('log','-1','--format=%H','--',FREEZE),remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 const remoteVerifiedAt=new Date().toISOString();
 if(remoteHead!==freezeCommit||git('rev-parse','HEAD')!==freezeCommit)throw Error('REMOTE_FREEZE_MISMATCH');
 for(const expected of plan.files){const actual=await identity(expected.path);if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)throw Error('FROZEN_FILE_CHANGED:'+expected.path);}
 if(git('diff',START,'HEAD','--',...PROTECTED))throw Error('PROTECTED_SOURCE_CHANGED');
 await new Promise(r=>setTimeout(r,2));const executionStartedAt=new Date().toISOString();
 if(!(remoteVerifiedAt<executionStartedAt))throw Error('PROOF_ORDER');
 return{freezeCommit,remoteHead,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]!=='freeze')console.log(JSON.stringify(await verify()));
 else{
  if(git('status','--porcelain'))throw Error('UNCOMMITTED_SOURCE');
  const jobs=JSON.parse(await readFile(path.join(WORK,'audio_only/jobs.json'),'utf8')).jobs;
  const files=git('ls-files','apps/customer-web','backend/research/step_decoded_sufficiency','backend/app/modules/model_assets',
    'backend/tests/test_practice_acoustic_model_asset.py','backend/tests/test_model_assets.py',
    'docs/architecture/practice-product-contract-v2.md','backend/research/browser_runtime/xc1_browser_runtime_shared.mjs',
    'backend/research/fresh_strike/prepare.py','backend/research/fresh_strike/audit.py',
    'backend/research/reports/fresh_strike_v2/dataset-audit.json','backend/research/reports/fresh_strike_v2/development-manifest.json').split('\n').filter(Boolean);
  files.push(MODEL,...['inventory.json','truth.json','audio_only/jobs.json'].map(f=>'backend/data/work/step_decoded_sufficiency/v1-final/'+f),...jobs.map(j=>j.path),
   ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
  await json(path.join(ROOT,FREEZE),{startingHead:START,implementationCommit:git('rev-parse','HEAD'),createdAt:new Date().toISOString(),
   phase:'PRACTICE_STEP_PRODUCT_SEMANTIC_ACOUSTIC_SUFFICIENCY_AND_INPUT_TIME_CONTRACT',files:await Promise.all([...new Set(files)].map(identity)),
   contract:{rearm:'ACTIVE/RESET, explicit finite same-domain time >= current boundary; strict next start > watermark',
    midi:'native event.timeStamp, fixed first-anchor [start,start+35ms), no queue',
    continuousMidi:'one observation per NOTE_ON; 250ms coverage grace is not grouping',
    acousticReplay:'production decoded observations only; fixed 35ms source-only grouping; one attempt per publication',
    busy:'discard, rearm through latest analyzed frontier; no busy-period replay',
    usability:'MEASURED_NOT_YET_PRODUCT_SLO_QUALIFIED'},
   safety:['falseAdvanceWithoutNewTruthGesture','doubleAdvanceFromOneTruthGesture','busyPeriodCarryoverAdvance','latePublicationCarryoverAdvance',
    'samePitchSustainAdvance','sameChordSustainAdvance','crossAttemptEvidenceReuse','wrongPitchAdvance'],
   acceptance:'every safety counter zero on frozen corpus AND all requested challenge families present; otherwise NOT_ESTABLISHED; no tuning',
   protectedSourceDiff:git('diff',START,'HEAD','--',...PROTECTED),
   model:{assetId:'practice-acoustic-robust-browser',version:'v1',bytes:98689283,sha256:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
    ort:'1.20.1',provider:'webgpu',automaticFallback:false,onset:.30,frame:.05,ownedMs:600,futureMs:170,pastMs:1050},
   sourceIdentities:JSON.parse(await readFile(path.join(APP,'src/lib/practice/acoustic/source/source-adapter-identities.json'),'utf8')),
   docker:{science:execFileSync('docker',['image','inspect','noteverse-xc1-r3d-science:local','--format','{{.Id}}'],{encoding:'utf8'}).trim(),
    backend:execFileSync('docker',['image','inspect','noteverse-practice-acoustic-qualification:local','--format','{{.Id}}'],{encoding:'utf8'}).trim()},
   verification:['full Vitest','STEP focused','Continuous MIDI focused','Browser MIDI focused','TypeScript noEmit','ESLint JSON','Next webpack full build','Docker model asset unit/routes',
    'real Worker WebGPU Stage A both source rates','seal before truth Stage B','product semantic safety and usability metrics'],
   productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED'});
  console.log(FREEZE);
 }
}
