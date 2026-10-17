import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,WORK,paths,START,ID,PHASE,FREEZE,BASE,SUCCESS,BLOCKED,PROTECTED,git,hash,newJson,verify} from './protocol.mjs';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const output=path.join(ROOT,'backend/research/reports',ID);
const stable=v=>JSON.parse(JSON.stringify(v,(k,x)=>['availabilityTimeMs','finalizationTimeMs'].includes(k)?undefined:x));
if(process.argv[2]==='evidence'){
 const freezeProof=await verify(),plan=await read(path.join(ROOT,FREEZE)),controller=paths().work;
 const verification=await read(path.join(controller,'verification.json'));
 const step=await read(path.join(controller,'step-deterministic.json'));
 const replay=await read(path.join(controller,'input-eligibility-replay.json'));
 const engineering=await read(path.join(controller,'browser.json'));
 const musical=await read(path.join(WORK,'musical.json')),scores=await read(path.join(WORK,'scores.json'));
 const baseline=await read(path.join(ROOT,BASE,'musical.json')),oldScores=await read(path.join(ROOT,BASE,'scores.json'));
 const parity=[];
 for(const cell of musical.results){
  const old=baseline.results.find(r=>r.id===cell.id&&r.rate===cell.rate);
  const row={id:cell.id,rate:cell.rate,status:'PASS'};
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
 const proofs=[];
 for(const [name,value] of Object.entries({verification,step,replay,engineering,musical,scores})){
  assert.equal(value.freezeCommit,freezeProof.freezeCommit);assert.equal(value.remoteHead,freezeProof.freezeCommit);
  assert.equal(value.freezeSha256,freezeProof.freezeSha256);
  assert.ok(Date.parse(value.remoteVerifiedAt)<Date.parse(value.executionStartedAt),name+':PROOF_ORDER');
  proofs.push({artifact:name,freezeCommit:value.freezeCommit,remoteHead:value.remoteHead,freezeSha256:value.freezeSha256,
   remoteVerifiedAt:value.remoteVerifiedAt,executionStartedAt:value.executionStartedAt});
 }
 const archive=await read(path.join(ROOT,'backend/research/history/step-boundary-before-waiting-lifecycle/manifest.json'));
 const archived=await readFile(path.join(ROOT,'backend/research/history/step-boundary-before-waiting-lifecycle/witnesses.ts'));
 assert.equal(hash(archived),archive.sha256);assert.equal(archived.length,archive.bytes);
 const changed=git('diff','--name-status',START,'HEAD').split('\n');
 const oldReports=new Set(git('ls-tree','-r','--name-only',START,'backend/research/reports').split('\n'));
 assert.ok(!git('diff','--name-only',START,'HEAD').split('\n').some(p=>oldReports.has(p)),'HISTORICAL_REPORT_CHANGED');
 assert.equal(git('diff',START,'HEAD','--',...PROTECTED),'','PROTECTED_SOURCE_CHANGED');
 const pass=verification.status==='PASS'&&step.status==='PASS'&&replay.status==='PASS'&&engineering.status==='PASS'
  &&engineering.cells.length===8&&musical.status==='PASS'&&musical.countComplete&&parity.length===8&&parity.every(p=>p.status==='PASS');
 const final={phase:PHASE,disposition:pass?SUCCESS:BLOCKED,startingHead:START,
  implementationCommit:plan.implementationCommit,freezeCommit:freezeProof.freezeCommit,freezeSha256:freezeProof.freezeSha256,
  freezeProof,executionProofs:proofs,commitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
  changedPaths:changed,archive,continuousCompileOnlyChange:'continuous-presentation imports renamed ContinuousPracticeLifecycle; no executable behavior changed',
  protectedSourceDiff:'',stepLifecycle:['READY','ACTIVE','ENDED'],stepSchema:3,runtimeIdentity:'step-waiting-attempt-v3',
  inputEligibleAfter:'Strict authoritative event-time > watermark; readiness/reconnect/Skip retire old input; future asynchronous acoustic re-arm samples physical capture/session coverage, NOT analysis frontier',
  midi:'Native event.timeStamp; fixed [firstNOTEON,firstNOTEON+35ms), immediate rearm at capture end; MIDIAccess remains alive through outage',
  continuous:'One NOTE_ON => one observation; existing pause/resume and 250ms coverage grace unchanged',
  inputEligibilitySafety:replay.inputEligibilitySafety,acousticGestureAssemblySafety:'NOT_ESTABLISHED',
  historicalAcousticDisposition:'STEP_DECODED_ACOUSTIC_ATTEMPT_SAFETY_NOT_ESTABLISHED',
  busyPeriodCarryoverAdvance:replay.busyPeriodCarryoverAdvance,latePublicationCarryoverAdvance:replay.latePublicationCarryoverAdvance,
  retiredHistoricalBusyWitnesses:replay.retiredBusyWitnesses.length,preservedBachGroupingWitnesses:replay.groupingWitnesses.length,
  continuousParity:parity,engineeringCells:engineering.cells.map(c=>({rate:c.rate,scenario:c.scenario,state:c.state})),
  modelRuns:{stepReplay:0,continuousEngineering:engineering.actualModelRuns,continuousMusicalIncludingController:musical.actualModelRuns,
   total:engineering.actualModelRuns+musical.actualModelRuns},
  verification:verification.results.map(r=>({name:r.name,exitCode:r.exitCode,counts:r.counts,messages:r.messages,output:r.output})),
  focusedTests:step.tests,capabilities:{Continuous:'MODEL_NOT_VALIDATED',STEP:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
  compatibilityLayer:false,fallbackPath:false,secondStepLifecycle:false,
  limitations:['Acoustic gesture assembly remains unsafe; this phase is not acoustic safety qualification.',
   'Capture clock in STEP replay is a counterfactual continuously advancing source-sample timeline, not new device evidence.',
   'No hardware, accuracy, UX latency or commercial enablement claim. No new STEP neural runs or datasets.'],completedAt:new Date().toISOString()};
 for(const [name,value] of Object.entries({verification,step,replay,engineering,musical,scores,final}))await newJson(path.join(output,name+'.json'),value);
 console.log(JSON.stringify({disposition:final.disposition,parity,modelRuns:final.modelRuns}));
 if(!pass)process.exitCode=1;
}else if(process.argv[2]==='receipt'){
 const evidenceHead=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 assert.equal(remote,evidenceHead);
 const credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
 const token=credential.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);
 const get=async endpoint=>{const r=await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'+endpoint,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});if(!r.ok)throw Error('GITHUB_'+r.status);return r.json();};
 const status=await get('commits/'+evidenceHead+'/status'),runs=await get('actions/runs?head_sha='+evidenceHead);
 const githubReceipt={queriedAt:new Date().toISOString(),evidenceHead,remoteHead:remote,combinedState:status.state,statuses:status.statuses,
  workflow_runs:runs.workflow_runs,interpretation:status.statuses.length===0&&runs.workflow_runs.length===0?'NOT CI PASS':'Inspect actual status and workflow conclusions; local verification is not CI',
  receiptCommit:'Commit containing this receipt; identified by Git history (no self-referential hash)'};
 await newJson(path.join(output,'github-receipt.json'),githubReceipt);console.log(JSON.stringify(githubReceipt));
}else throw Error('EXPECTED evidence OR receipt');
