import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const START='c8de147f819cf5bd971de581192b096ef7b6abb4';
export const WORK=path.join(ROOT,'backend/data/work/fresh_strike/v1');
export const FREEZE='backend/research/reports/fresh_strike_development_freeze_v1_2026-10-17.json';
export const MODEL='backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx';
export const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function identity(file){const b=await readFile(path.join(ROOT,file));return{path:file,bytes:b.length,sha256:hash(b)};}
export async function json(file,value){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
export async function verify(){
  const plan=JSON.parse(await readFile(path.join(ROOT,FREEZE),'utf8'));
  const freezeCommit=git('log','-1','--format=%H','--',FREEZE);
  const remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  const remoteVerifiedAt=new Date().toISOString();
  if(remoteHead!==freezeCommit||git('rev-parse','HEAD')!==freezeCommit)throw Error('REMOTE_FREEZE_MISMATCH');
  for(const expected of plan.files){const actual=await identity(expected.path);if(actual.sha256!==expected.sha256||actual.bytes!==expected.bytes)throw Error('FROZEN_FILE_CHANGED:'+expected.path);}
  if(git('diff',START,'HEAD','--','apps/customer-web','backend/app'))throw Error('PRODUCT_SOURCE_CHANGED');
  await new Promise(r=>setTimeout(r,2));
  const executionStartedAt=new Date().toISOString();
  if(!(remoteVerifiedAt<executionStartedAt))throw Error('PROOF_ORDER');
  return{freezeCommit,remoteHead,freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),remoteVerifiedAt,executionStartedAt};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]!=='freeze') console.log(JSON.stringify(await verify()));
  else{
    if(git('status','--porcelain'))throw Error('UNCOMMITTED_SOURCE');
    const jobs=JSON.parse(await readFile(path.join(WORK,'development/audio_only/jobs.json'),'utf8')).jobs;
    const files=git('ls-files','backend/research/fresh_strike','apps/customer-web','backend/app/modules/model_assets',
      'backend/scripts/evaluate_causal_physical_strike_trigger.py','backend/research/browser_runtime/xc1_browser_runtime_shared.mjs').split('\n').filter(Boolean);
    files.push(MODEL,'backend/data/work/fresh_strike/v1/local_dataset_audit.json','backend/data/work/fresh_strike/v1/development/truth.json',
      'backend/data/work/fresh_strike/v1/development/audio_only/jobs.json',...jobs.map(j=>j.path),
      ...['package.json','dist/ort.webgpu.min.mjs','dist/ort-wasm-simd-threaded.jsep.mjs','dist/ort-wasm-simd-threaded.jsep.wasm'].map(f=>'apps/customer-web/node_modules/onnxruntime-web/'+f));
    await json(path.join(ROOT,FREEZE),{startingHead:START,implementationCommit:git('rev-parse','HEAD'),
      phase:'PRACTICE_STEP_FRESH_STRIKE_EVIDENCE_QUALIFICATION_DISABLED',scope:'DEVELOPMENT_BUDGET_AND_TOOLING_NOT_QUALIFICATION_FREEZE',
      createdAt:new Date().toISOString(),files:await Promise.all([...new Set(files)].map(identity)),
      dockerScience:{tag:'noteverse-xc1-r3d-science:local',id:execFileSync('docker',['image','inspect','noteverse-xc1-r3d-science:local','--format','{{.Id}}'],{encoding:'utf8'}).trim(),scipy:'1.14.1',numpy:'1.26.4'},
      budget:{baselines:2,rawMorphologyCandidates:2,fusion:0,retuning:0},
      selection:'rise then support; first passing ALL development gates; otherwise STOP and no candidate selected',
      gates:{allRecall:.90,retriggerRecall:.90,chordRecall:.90,falseGuardTokens:0,duplicateTokens:0},
      match:'inclusive +/-100ms one-to-one max cardinality then minimum absolute timing error',groupingMs:35,
      qualification:'separate later candidate+source-disjoint manifest freeze REQUIRED if development selects a candidate',
      protectedSourceDiff:git('diff',START,'HEAD','--','apps/customer-web','backend/app'),
      model:{bytes:98689283,sha256:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',ort:'1.20.1',provider:'webgpu',fallback:false},
      productionMicrophone:false,D4:false,continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED'});
    console.log(FREEZE);
  }
}
