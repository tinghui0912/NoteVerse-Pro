import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const ROOT=path.resolve(import.meta.dirname,'../../..');
export const DIR='backend/research/step_waiting_h50_holdout_v7';
export const OUT='backend/research/reports/step_waiting_h50_holdout_v7';
export const WORK=path.join(ROOT,'backend/data/work/step_waiting_h50_holdout_v7');
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const load=async p=>JSON.parse(await readFile(path.isAbsolute(p)?p:path.join(ROOT,p),'utf8'));
export async function newJson(p,v){await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});}
export const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
export const esbuild=()=>import(new URL('../../../backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js',import.meta.url));
export const TRUTH_IMPORT=/step-runtime|step-practice-controller|continuous-practice-controller|WaitingTopologyGate|selector|scorer|product-replay|midi-parser|scenario-manifest|step-attempt|continuous-finalizer/i;
export function rejectImports(inputs){const bad=inputs.filter(p=>TRUTH_IMPORT.test(p));if(bad.length)throw Error('H50_STAGE_A_TRUTH_ISOLATION_VIOLATION:'+bad.join(','));return bad;}
export function routeAllowed(url,files){return url==='/'||files.has(url);}
export function permission(proof,gate,assetsSha,started){
  if(!proof||proof.remoteHead!==proof.freezeCommit||proof.stageAAssetsSha256!==assetsSha||!(Date.parse(proof.remoteVerifiedAt)<Date.parse(started)))throw Error('REMOTE_EXECUTION_PROOF_REQUIRED');
  if(gate?.status!=='PASS'||gate?.freezeCommit!==proof.freezeCommit||gate.engineeringCells!==8||gate.engineeringPass!==8||gate.musicalCells!==8||gate.musicalPass!==8||!gate.modelRunCountComplete||gate.engineeringActualModelRuns!==18||gate.musicalActualModelRuns!==66||gate.productionControllerActualModelRuns!==10||gate.semanticDiffs?.length!==0)throw Error('FRESH_CONTINUOUS_GATE_REQUIRED');
}
