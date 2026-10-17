import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,WORK,paths,START,ID,PHASE,FREEZE,BASE,SUCCESS,BLOCKED,PROTECTED,git,hash,newJson,verify,fileIdentity} from './protocol.mjs';
const read=async p=>JSON.parse(await readFile(path.join(ROOT,p),'utf8'));
const reports='backend/research/reports';
const stable=value=>JSON.parse(JSON.stringify(value,(key,v)=>['availabilityTimeMs','finalizationTimeMs'].includes(key)?undefined:v));
if(process.argv[2]==='evidence'){
 const proof=await verify(),plan=await read(FREEZE);
 const verification=JSON.parse(await readFile(path.join(paths().work,'verification.json'),'utf8'));
 const step=JSON.parse(await readFile(path.join(paths().work,'step-deterministic.json'),'utf8'));
 const engineering=JSON.parse(await readFile(path.join(paths().work,'browser.json'),'utf8'));
 const musical=JSON.parse(await readFile(path.join(WORK,'musical.json'),'utf8'));
 const scores=JSON.parse(await readFile(path.join(WORK,'scores.json'),'utf8'));
 const proofAudit=[];
 for(const [name,value] of Object.entries({verification,step,engineering,musical,scores,
  seal:JSON.parse(await readFile(path.join(WORK,'acoustic_seal.json'),'utf8')),
  fullVitest:JSON.parse(await readFile(path.join(paths().work,'vitest.json'),'utf8')),
  stepVitest:JSON.parse(await readFile(path.join(paths().work,'step-vitest.json'),'utf8'))})) {
  assert.equal(value.freezeCommit,proof.freezeCommit);assert.equal(value.remoteHead,proof.freezeCommit);assert.equal(value.freezeSha256,proof.freezeSha256);
  assert.ok(Date.parse(value.remoteVerifiedAt)<Date.parse(value.executionStartedAt),'PRE_EXECUTION_PROOF_MISSING:'+name);
  proofAudit.push({artifact:name,freezeCommit:value.freezeCommit,remoteHead:value.remoteHead,freezeSha256:value.freezeSha256,
    remoteVerifiedAt:value.remoteVerifiedAt,executionStartedAt:value.executionStartedAt,status:'PASS'});
 }
 for(const row of verification.results)assert.ok(Date.parse(row.remoteVerifiedAt)<Date.parse(row.executionStartedAt));
 const baseline=await read(BASE+'/musical.json'),oldScores=await read(BASE+'/scores.json'),parity=[];
 for(const cell of musical.results){
  const old=baseline.results.find(r=>r.id===cell.id&&r.rate===cell.rate);
  const row={id:cell.id,rate:cell.rate,status:'PASS',publications:cell.publications.length,observations:cell.publications.reduce((n,p)=>n+p.observations.length,0)};
  try{
   assert.ok(old);assert.deepEqual(stable(cell.publications),stable(old.publications));assert.equal(cell.actualModelRuns,old.actualModelRuns);
   assert.equal(cell.snapshot.sourceAdapterIdentitySha256,old.snapshot.sourceAdapterIdentitySha256);
   assert.equal(cell.snapshot.acousticCoreIdentitySha256,old.snapshot.acousticCoreIdentitySha256);
   assert.equal(cell.snapshot.counts.terminalPublications,1);assert.equal(cell.snapshot.outstanding,0);
   assert.deepEqual(cell.snapshot.diagnostics.map(d=>[d.jobIndex,d.inputStartSample,d.inputEndSample,d.eventCount]),old.snapshot.diagnostics.map(d=>[d.jobIndex,d.inputStartSample,d.inputEndSample,d.eventCount]));
   assert.deepEqual(stable(scores.cells.find(r=>r.id===cell.id&&r.rate===cell.rate)),stable(oldScores.cells.find(r=>r.id===cell.id&&r.rate===cell.rate)));
  }catch(e){row.status='FAIL';row.difference=String(e.stack??e);}
  parity.push(row);
 }
 const archive=await read('backend/research/history/step-original-bytedance-low-level-before-domain-reset/manifest.json');
 for(const f of archive.files){const actual=await fileIdentity(f.path);assert.equal(actual.sha256,f.sha256);assert.equal(actual.bytes,f.bytes);assert.equal(git('rev-parse',`HEAD:${f.path}`),f.gitBlob);}
 const changed=git('diff','--name-status',START,'HEAD').split('\n');
 const oldReports=new Set(git('ls-tree','-r','--name-only',START,reports).split('\n'));
 assert.ok(!git('diff','--name-only',START,'HEAD').split('\n').some(p=>oldReports.has(p)),'HISTORICAL_REPORT_CHANGED');
 const protectedPaths=PROTECTED;
 assert.equal(git('diff',START,'HEAD','--',...protectedPaths),'','PROTECTED_SEMANTICS_CHANGED');
 const pass=verification.status==='PASS'&&step.status==='PASS'&&step.witnesses.status==='PASS'&&engineering.status==='PASS'
  &&engineering.cells.length===8&&musical.status==='PASS'&&musical.countComplete&&parity.length===8&&parity.every(p=>p.status==='PASS');
 const artifacts=[];
 for(const [name,value] of Object.entries({verification,step,engineering,musical,scores,parity})){
  const file=`${reports}/step_boundary_${name}_${ID}_2026-10-17.json`;await newJson(path.join(ROOT,file),Array.isArray(value)?{...proof,cells:value}:value);artifacts.push(await fileIdentity(file));
 }
 await newJson(path.join(ROOT,`${reports}/step_boundary_final_${ID}_2026-10-17.json`),{
  ...proof,phase:PHASE,disposition:pass?SUCCESS:BLOCKED,startingHead:START,implementationAndToolingCommit:plan.implementationCommit,proof,proofAudit,
  execution:{static:verification.executionStartedAt,step:step.executionStartedAt,engineering:engineering.executionStartedAt,musical:musical.executionStartedAt},
  invalidatedCycles:[],boundaryWitnesses:step.witnesses,
  artifacts,pathsChanged:changed,archiveManifest:'backend/research/history/step-original-bytedance-low-level-before-domain-reset/manifest.json',archivedFiles:archive.files,
  modules:{domain:['local-core/step-attempt.ts','local-core/step-runtime.ts'],application:'step/step-practice-controller.ts',gesture:'step/step-midi-attempt-input.ts',
   genericMidi:'midi/browser-midi-controller.ts',platform:'step/step-platform.ts',presentation:'hooks/practice/use-step-local-practice.ts',
   rawOutput:'acoustic/model/raw-output-contract.ts',decoder:'acoustic/model/robust-piano-decoder.ts'},
  contract:plan.contract,model:plan.model,endpoint:'/model-assets/practice-acoustic-robust-browser-v1/access',
  worker:'apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts',worklet:'apps/customer-web/src/lib/practice/acoustic/source/capture.worklet.js',
  semanticChange:'Only openAttempt changes start < activationBoundary to start <= activationBoundary. No production MIDI/controller predicate, timer delay, tolerance, timestamp mutation or acoustic change.',
  compatibilityLayer:false,fallbackPath:false,secondStepRuntime:false,rollingStepEvidenceQueue:false,secondAcousticRuntime:false,
  continuousParity:{status:parity.every(p=>p.status==='PASS')?'PASS':'FAIL',cells:parity,
   comparisonExclusions:['availabilityTimeMs','finalizationTimeMs'],reason:'Remeasured wall-clock processing times only. Attack times, source coordinates, IDs, ownership, frontiers and product results are exact.',
   productionControllerReplay:musical.controllerResult,protectedPaths,unchanged:true},
  verification,stepQualification:step,
  counts:{actualNeuralModelRuns:engineering.actualModelRuns+musical.actualModelRuns,engineeringModelRuns:engineering.actualModelRuns,musicalModelRuns:musical.actualModelRuns,
   modelRunCountComplete:engineering.modelRunCountComplete&&musical.countComplete,newDatasetDownloads:0,newAcousticScienceRuns:0,realDeviceProbes:0},
  capability:{continuous:'MODEL_NOT_VALIDATED',step:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
  protections:{F5:'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER',phase9GB:'STATISTICAL_TIE',winner:null,ViennaP15P22InferenceIncrease:0,
   commercialQualification:'NOT_PERFORMED',productLatencySlo:'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN',noOptimalProfileClaim:true},
  limitations:['STEP microphone analyzer, fresh-strike detector and quiet classifier are not implemented.',
   'MIDI tests use deterministic ports/browser access fixtures, no physical keyboard.',
   'Continuous replay is exposed-development implementation parity, not fresh science or real-device evidence.',
   'History ceiling is a deliberate session bound, not a privacy policy or total JS heap bound.']});
 console.log(pass?SUCCESS:BLOCKED);if(!pass)process.exitCode=1;
}else if(process.argv[2]==='github'||process.argv[2]==='github-final'){
 const head=git('rev-parse','HEAD');assert.equal(git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0],head);
 const remoteVerifiedAt=new Date().toISOString();
 const credentials=execFileSync('git',['credential','fill'],{cwd:ROOT,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
 const token=credentials.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(!token)throw new Error('GITHUB_CREDENTIAL_UNAVAILABLE');
 const executionStartedAt=new Date().toISOString();assert.ok(Date.parse(remoteVerifiedAt)<Date.parse(executionStartedAt));
 const api=async endpoint=>{const r=await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'+endpoint,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});if(!r.ok)throw new Error('GITHUB:'+r.status);return r.json();};
 const combined=await api(`commits/${head}/status`),statuses=await api(`commits/${head}/statuses`),runs=await api(`actions/runs?head_sha=${head}`);
 const value={phase:PHASE,freezeCommit:git('log','-1','--format=%H','--',FREEZE),freezeSha256:hash(await readFile(path.join(ROOT,FREEZE))),
  remoteVerifiedAt,executionStartedAt,queriedAt:new Date().toISOString(),remoteHead:head,combinedState:combined.state,statuses,workflowRuns:runs.workflow_runs,
  interpretation:statuses.length===0&&runs.workflow_runs.length===0?'NOT CI PASS':'ACTUAL_GITHUB_STATE_NOT_INHERITED_FROM_LOCAL_TESTS'};
 if(process.argv[2]==='github')await newJson(path.join(ROOT,`${reports}/step_boundary_github_receipt_${ID}_2026-10-17.json`),value);
 console.log(JSON.stringify(value));
}else throw new Error('Expected evidence / github / github-final');
