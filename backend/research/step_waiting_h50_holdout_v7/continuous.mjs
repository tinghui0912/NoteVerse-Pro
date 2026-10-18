// Phase wrapper only. The canonical runner owns all browser/controller execution.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,OUT,WORK,hash,newJson,esbuild} from './core.mjs';
import {runEngineering,runMusical} from '../../../apps/customer-web/scripts/qualification/continuous-regression.mjs';
const fileIdentity=async file=>{const bytes=await readFile(path.join(ROOT,file));return {path:file,bytes:bytes.length,sha256:hash(bytes)};};
const verify=async()=>JSON.parse(execFileSync('python',['-B','backend/research/step_waiting_h50_holdout_v7/protocol.py','verify'],{cwd:ROOT,encoding:'utf8'}));
const protocol={ROOT,APP:path.join(ROOT,'apps/customer-web'),MODEL:'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx',
 FIXTURE:'backend/data/work/xc6_capture/fake-device.wav',WORK:path.join(WORK,'continuous-musical'),paths:()=>({work:path.join(WORK,'continuous-engineering')}),
 verify,fileIdentity,hash,newJson,SUCCESS:'CONTINUOUS_PREREQUISITE_PASS',BLOCKED:'STEP_WAITING_H50_BLOCKED_BY_FRESH_CONTINUOUS_REGRESSION'};
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['availabilityTimeMs','finalizedAtMs','finalizationTimeMs'].includes(k)).map(([k,v])=>[k,clean(v)])):v;
const stage=process.argv[2];
if(stage==='engineering'){
 await runEngineering(protocol);
 const r=await load(path.join(protocol.paths().work,'browser.json'));
 if(r.status!=='PASS'||r.cells.length!==8||r.cells.some(c=>c.state!=='PASS')||r.actualModelRuns!==18||!r.modelRunCountComplete)throw Error('CONTINUOUS_ENGINEERING_GATE_FAILED');
}else if(stage==='musical'){
 const e=await load(path.join(protocol.paths().work,'browser.json'));
 if(e.status!=='PASS'||e.actualModelRuns!==18||!e.modelRunCountComplete)throw Error('CONTINUOUS_ENGINEERING_REQUIRED');
 await runMusical(protocol);
 const m=await load(path.join(protocol.WORK,'musical.json'));
 if(m.status!=='PASS'||m.results.length!==8||m.results.reduce((n,c)=>n+c.actualModelRuns,0)!==66||m.controllerResult?.status!=='PASS'||m.controllerResult.actualModelRuns!==10||!m.countComplete)throw Error('CONTINUOUS_MUSICAL_ACCOUNTING_FAILED');
}else if(stage==='parity'){
 const proof=await verify(),m=await load(path.join(protocol.WORK,'musical.json')),e=await load(path.join(protocol.paths().work,'browser.json'));
 const base=path.join(ROOT,'backend/research/reports/capture_aggregation/accepted-v2');
 const baseline=await load(path.join(base,'musical.json')),baselineScores=await load(path.join(base,'parity.json'));
 const seal=await load(path.join(protocol.WORK,'acoustic_seal.json'));
 if(hash(await readFile(path.join(protocol.WORK,'musical.json')))!==seal.sha256)throw Error('CONTINUOUS_ACOUSTIC_SEAL_CHANGED');
 // This is Continuous-only truth, never H50 primary truth or scenarios.
 const truth=await load(path.join(ROOT,'backend/data/work/product_completion_replay/v4/truth.json'));
 const builder=await esbuild(),output=path.join(protocol.WORK,'continuous-scenarios.mjs');
 await builder.build({entryPoints:[path.join(ROOT,'apps/customer-web/scripts/continuous-product-replay/product-scenarios.ts')],outfile:output,bundle:true,platform:'node',format:'esm'});
 const {replayProductScenarios}=await import(pathToFileURL(output).href),diffs=[],cells=[];
 for(const result of m.results){
  const prior=baseline.results.find(c=>c.id===result.id&&c.rate===result.rate);
  const projection=r=>({publications:clean(r.publications),counts:r.snapshot.counts,frontier:r.snapshot.analyzedThroughPerformanceMs,outstanding:r.snapshot.outstanding,actualModelRuns:r.actualModelRuns});
  if(!prior||JSON.stringify(projection(result))!==JSON.stringify(projection(prior)))diffs.push({id:result.id,rate:result.rate,kind:'EXACT_PUBLICATION_SEMANTIC_PARITY'});
  const physical=truth.clips.find(c=>c.id===result.id),scenarios=physical?replayProductScenarios(physical.notes,result.publications):[];
  const old=baselineScores.cells.find(c=>c.id===result.id&&c.rate===result.rate)?.scenarios;
  if(JSON.stringify(clean(scenarios))!==JSON.stringify(clean(old)))diffs.push({id:result.id,rate:result.rate,kind:'PRODUCT_COUNTERFACTUAL_PARITY'});
  cells.push({id:result.id,rate:result.rate,scenarios});
 }
 const status=e.status==='PASS'&&e.actualModelRuns===18&&e.modelRunCountComplete&&m.status==='PASS'&&m.results.length===8&&m.actualModelRuns===76&&m.countComplete&&m.controllerResult?.status==='PASS'&&m.controllerResult.actualModelRuns===10&&diffs.length===0?'PASS':'BLOCKED';
 const gate={...proof,status,engineeringCells:e.cells.length,engineeringPass:e.cells.filter(c=>c.state==='PASS').length,engineeringActualModelRuns:e.actualModelRuns,
  musicalCells:m.results.length,musicalPass:m.results.length,musicalActualModelRuns:m.results.reduce((n,r)=>n+r.actualModelRuns,0),
  productionControllerPass:m.controllerResult?.status,productionControllerActualModelRuns:m.controllerResult?.actualModelRuns,
  totalActualModelRuns:e.actualModelRuns+m.actualModelRuns,modelRunCountComplete:e.modelRunCountComplete&&m.countComplete,
  acceptedBaseline:{freezeCommit:'a399051d4007b57144e0d06b0606df7c53f770a7',freezeSha256:'3f24728b4043be0eecba4ddc3774d1ff89fc5d068bf1a44bb09324106941326f'},
  semanticDiffs:diffs,ignoredNonsemanticFields:['availabilityTimeMs','finalizedAtMs','finalizationTimeMs'],cells,
  controllerParityScope:'Existing accepted controller status/completion/run-count witness; exact stable publication/scenario parity is compared in all 8 musical cells without identity rewriting.',
  H50TruthOpened:false,StageA:'NOT_STARTED',StageB:'NOT_STARTED'};
 await newJson(path.join(ROOT,OUT,'continuous-parity.json'),gate);
 const {cells:continuousTruthDetails,...audioOnlyGate}=gate;
 await newJson(path.join(ROOT,OUT,'continuous-gate.json'),audioOnlyGate);
 if(status!=='PASS')throw Error('CONTINUOUS_SEMANTIC_GATE_FAILED');
 await newJson(path.join(ROOT,OUT,'stage-a-permission.json'),{...proof,continuousGateSha256:hash(await readFile(path.join(ROOT,OUT,'continuous-gate.json')))});
 console.log({status,engineering:18,musical:66,controller:10,semanticDiffs:diffs});
}else throw Error('UNKNOWN_CONTINUOUS_STAGE');
