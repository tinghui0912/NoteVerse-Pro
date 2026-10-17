import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,WORK,paths,START,ID,PHASE,FREEZE,SUCCESS,BLOCKED,git,hash,newJson,verify,fileIdentity} from './protocol.mjs';
const read=async p=>JSON.parse(await readFile(path.join(ROOT,p),'utf8'));
const reports='backend/research/reports';
const stable=value=>JSON.parse(JSON.stringify(value,(key,v)=>['availabilityTimeMs','finalizationTimeMs'].includes(key)?undefined:v));
if(process.argv[2]==='evidence'){
 const proof=await verify(),plan=await read(FREEZE);
 const verification=JSON.parse(await readFile(path.join(paths().work,'verification.json'),'utf8'));
 const engineering=JSON.parse(await readFile(path.join(paths().work,'browser.json'),'utf8'));
 const musical=JSON.parse(await readFile(path.join(WORK,'musical.json'),'utf8'));
 const scores=JSON.parse(await readFile(path.join(WORK,'scores.json'),'utf8'));
 const baseline=await read('backend/data/work/product_completion_replay/v4/musical.json');
 const oldScores=await read('backend/data/work/product_completion_replay/v4/scores.json');
 const parity=[];
 for(const cell of musical.results){
  const old=baseline.results.find(r=>r.id===cell.id&&r.rate===cell.rate);
  const row={id:cell.id,rate:cell.rate,status:'PASS',publications:cell.publications.length,observations:cell.publications.reduce((n,p)=>n+p.observations.length,0)};
  try{
   assert.ok(old);assert.deepEqual(stable(cell.publications),stable(old.publications));
   assert.equal(cell.actualModelRuns,old.actualModelRuns);
   assert.equal(cell.snapshot.sourceAdapterIdentitySha256,old.snapshot.sourceAdapterIdentitySha256);
   assert.equal(cell.snapshot.acousticCoreIdentitySha256,old.snapshot.acousticCoreIdentitySha256);
   assert.equal(cell.snapshot.counts.terminalPublications,1);assert.equal(cell.snapshot.outstanding,0);
   assert.deepEqual(cell.snapshot.diagnostics.map(d=>[d.jobIndex,d.inputStartSample,d.inputEndSample,d.eventCount]),
    old.snapshot.diagnostics.map(d=>[d.jobIndex,d.inputStartSample,d.inputEndSample,d.eventCount]));
   const nowScore=scores.cells.find(r=>r.id===cell.id&&r.rate===cell.rate),oldScore=oldScores.cells.find(r=>r.id===cell.id&&r.rate===cell.rate);
   assert.deepEqual(stable(nowScore),stable(oldScore));
  }catch(e){row.status='FAIL';row.difference=String(e.stack??e);}
  parity.push(row);
 }
 const archive=await read('backend/research/history/shared-acoustic-before-clean-break/manifest.json');
 for(const f of archive.files){const actual=await fileIdentity(f.path);assert.equal(actual.sha256,f.sha256);assert.equal(actual.bytes,f.bytes);assert.equal(git('rev-parse',`HEAD:${f.path}`),f.gitBlob);}
 const changed=git('diff','--name-status',START,'HEAD').split('\n');
 const prior=new Set(git('ls-tree','-r','--name-only',START,reports).split('\n'));
 assert.ok(!git('diff','--name-only',START,'HEAD').split('\n').some(p=>prior.has(p)),'HISTORICAL_REPORT_CHANGED');
 assert.equal(git('diff',START,'HEAD','--','apps/customer-web/src/lib/practice/local-core/continuous-finalizer.ts',
  'apps/customer-web/src/lib/practice/local-core/performance-clock-runtime.ts','apps/customer-web/src/lib/practice/local-core/step-runtime.ts',
  'apps/customer-web/src/lib/practice/local-core/step-evidence-session.ts','apps/customer-web/src/hooks/practice/use-step-local-practice.ts',
  'apps/customer-web/src/lib/practice/input-capability.ts'),'');
 const pass=verification.status==='PASS'&&engineering.status==='PASS'&&engineering.cells.length===8&&musical.status==='PASS'&&musical.countComplete&&parity.length===8&&parity.every(p=>p.status==='PASS');
 const artifacts=[];
 for(const [name,value] of Object.entries({verification,engineering,musical,scores,parity})){
  const file=`${reports}/shared_acoustic_${name}_${ID}_2026-10-17.json`;await newJson(path.join(ROOT,file),value);artifacts.push(await fileIdentity(file));
 }
 await newJson(path.join(ROOT,`${reports}/shared_acoustic_final_${ID}_2026-10-17.json`),{
  phase:PHASE,disposition:pass?SUCCESS:BLOCKED,startingHead:START,implementationCommit:plan.productImplementationCommit,toolingCommit:plan.implementationCommit,proof,
  engineeringExecutionStartedAt:engineering.executionStartedAt,musicalExecutionStartedAt:musical.startedAt,
  artifacts,pathsChanged:changed,archiveManifest:'backend/research/history/shared-acoustic-before-clean-break/manifest.json',archivedFiles:archive.files,
  responsibilityMap:{model:'One exact Robust asset, ORT session and Worker; raw tensors transaction-local',source:'FIR/capture/chronology/infrastructure facts only',runtime:'Absolute source/target sample regions and bounded work',continuous:'External transport boundaries, performance mapping, product IDs, exact terminal-T'},
  model:plan.model,endpoint:'/model-assets/practice-acoustic-robust-browser-v1/access',storage:'Existing immutable OSS key centralized in ROBUST_MODEL_STORAGE_KEY; no object copy',
  firPaths:['public/model-assets/practice-acoustic/fir-160-441.f32','public/model-assets/practice-acoustic/fir-1-3.f32'],
  worker:'apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts',worklet:'apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js',
  secondActiveAcousticPath:false,compatibilityLayer:false,fallbackPath:false,resourceLimits:plan.resourceLimits,
  continuousParity:{status:parity.every(p=>p.status==='PASS')?'PASS':'FAIL',cells:parity,
   comparisonExclusions:['availabilityTimeMs','finalizationTimeMs'],exclusionReason:'Measured processing/publication times, not attack identity or analysis frontier. No tolerances on semantic evidence.',
   dspAndPcm:'Existing frozen DSP fixtures and exact historical input SHA tests rerun inside full Vitest',
   engineeringCells:engineering.cells.map(c=>({rate:c.rate,scenario:c.scenario,state:c.state,actualModelRuns:c.result?.actualModelRuns})),
   musicalController:musical.controllerResult},
  verification,counts:{actualNeuralModelRuns:engineering.actualModelRuns+musical.actualModelRuns,engineeringModelRuns:engineering.actualModelRuns,musicalModelRuns:musical.actualModelRuns,
   modelRunCountComplete:engineering.modelRunCountComplete&&musical.countComplete,newDatasetDownloads:0,newAcousticScienceRuns:0,realDeviceProbes:0},
  capability:{continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
  protections:{F5:'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',phase9GB:'STATISTICAL_TIE',winner:null,ViennaP15P22InferenceIncrease:0,
   commercialQualification:'NOT_PERFORMED',productLatencySlo:'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN',noOptimalProfileClaim:true},
  limitations:['Engineering implementation parity on already-exposed development fixtures, not fresh scientific evaluation.',
   'No real microphone/device, physical latency, natural fixed-BPM human performance, commercial or enablement qualification.',
   'Future STEP trigger/attempt consumer is not implemented; original checkpoint policy is not transferred to Robust.',
   'Compact diagnostics memory is a planning estimate, not exact total JS/ORT/WebGPU heap.']});
 console.log(pass?SUCCESS:BLOCKED);if(!pass)process.exitCode=1;
}else if(process.argv[2]==='github'){
 const head=git('rev-parse','HEAD');assert.equal(git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0],head);
 const credentials=execFileSync('git',['credential','fill'],{cwd:ROOT,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
 const token=credentials.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(!token)throw new Error('GITHUB_CREDENTIAL_UNAVAILABLE');
 const api=async endpoint=>{const r=await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'+endpoint,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});if(!r.ok)throw new Error('GITHUB:'+r.status);return r.json();};
 const combined=await api(`commits/${head}/status`),statuses=await api(`commits/${head}/statuses`),runs=await api(`actions/runs?head_sha=${head}`);
 const value={phase:PHASE,queriedAt:new Date().toISOString(),remoteHead:head,combinedState:combined.state,statuses,workflowRuns:runs.workflow_runs,
  interpretation:statuses.length===0&&runs.workflow_runs.length===0?'NOT CI PASS':'ACTUAL_GITHUB_STATE_NOT_INHERITED_FROM_LOCAL_TESTS'};
 await newJson(path.join(ROOT,`${reports}/shared_acoustic_github_receipt_${ID}_2026-10-17.json`),value);console.log(JSON.stringify(value));
}else throw new Error('Expected evidence or github');
