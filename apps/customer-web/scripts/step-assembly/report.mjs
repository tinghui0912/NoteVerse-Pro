import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,WORK,paths,START,ID,PHASE,FREEZE,BASE,BLOCKED,PROTECTED,git,hash,newJson,verify} from './protocol.mjs';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const output=path.join(ROOT,'backend/research/reports/step_attempt_assembly_v1');
const stable=v=>JSON.parse(JSON.stringify(v,(k,x)=>['availabilityTimeMs','finalizationTimeMs'].includes(k)?undefined:x));
if(process.argv[2]==='blocked-evidence'){
 const freezeProof=await verify(),plan=await read(path.join(ROOT,FREEZE)),controller=paths().work;
 const development=await read(path.join(ROOT,'backend/data/work/step_attempt_assembly/development-v1/development-scores.json'));
 assert.equal(development.selectedHMs,null,'CANDIDATE_EXISTS_MUST_CONTINUE_SEPARATE_HOLDOUT_FREEZE');
 const verification=await read(path.join(controller,'verification.json'));
 const engineering=await read(path.join(controller,'browser.json'));
 const musical=await read(path.join(WORK,'musical.json')),scores=await read(path.join(WORK,'scores.json'));
 const baseline=await read(path.join(ROOT,BASE,'musical.json')),oldScores=await read(path.join(ROOT,BASE,'scores.json'));
 const parity=[];
 for(const cell of musical.results){
  const old=baseline.results.find(r=>r.id===cell.id&&r.rate===cell.rate),row={id:cell.id,rate:cell.rate,status:'PASS'};
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
 const executionProofs=[];
 for(const [name,value] of Object.entries({development,verification,engineering,musical,scores})){
  assert.equal(value.freezeCommit,freezeProof.freezeCommit);assert.equal(value.remoteHead,freezeProof.freezeCommit);
  assert.ok(Date.parse(value.remoteVerifiedAt)<Date.parse(value.executionStartedAt),name+':PROOF_ORDER');
  executionProofs.push({artifact:name,freezeCommit:value.freezeCommit,remoteHead:value.remoteHead,freezeSha256:value.freezeSha256,
   remoteVerifiedAt:value.remoteVerifiedAt,executionStartedAt:value.executionStartedAt});
 }
 assert.equal(git('diff',START,'HEAD','--',...PROTECTED),'','PROTECTED_SOURCE_CHANGED');
 const oldReports=new Set(git('ls-tree','-r','--name-only',START,'backend/research/reports').split('\n'));
 assert.ok(!git('diff','--name-only',START,'HEAD').split('\n').some(p=>oldReports.has(p)),'HISTORICAL_REPORT_CHANGED');
 const regressionPass=verification.status==='PASS'&&engineering.status==='PASS'&&engineering.cells.length===8
  &&musical.status==='PASS'&&musical.countComplete&&parity.length===8&&parity.every(p=>p.status==='PASS');
 const final={phase:PHASE,disposition:BLOCKED,startingHead:START,implementationCommit:plan.implementationCommit,
  commitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),freezeCommit:freezeProof.freezeCommit,
  freezeSha256:freezeProof.freezeSha256,freezeStage:plan.stage,freezeProof,executionProofs,
  developmentPlan:plan.developmentPlan,developmentPlanSha256:hash(await readFile(path.join(ROOT,'backend/research/step_attempt_assembly/development-plan.json'))),
  developmentSources:plan.developmentPlan.developmentSources,selectedHMs:null,selectionReason:development.selectionReason,
  qualificationSourceIds:[],qualificationStatus:'NOT_STARTED_NO_ELIGIBLE_DEVELOPMENT_CANDIDATE',qualificationAcousticSealSha256:null,
  developmentAcousticSealSha256:'2b63d13fd580fd390c6deabdceddca7208cef06b57807af35ac5fa0fabfe04dc',
  candidates:development.candidates.map(c=>({widthMs:c.widthMs,baselineOnly:c.baselineOnly,eligible:c.eligible,safety:c.safety,assemblySafetyByRate:c.assemblySafetyByRate,
    mandatoryBachUnsafe:c.mandatoryBachUnsafe,corroboratedIntendedAcceptances:c.corroboratedIntendedAcceptances,
    dangerousWitnessCount:c.dangerousWitnesses.length,summaries:c.summaries,extraObservationsPerAttempt:c.extraObservationsPerAttempt})),
  dangerousWitnessesFile:'development.json (every witness retained, no averaging-away)',
  model:plan.model,modelRuns:{newStepInference:0,continuousEngineering:engineering.actualModelRuns,
    continuousMusicalIncludingController:musical.actualModelRuns,total:engineering.actualModelRuns+musical.actualModelRuns},
  protectedSourceDiff:'',regressionPass,continuousParity:parity,engineeringCells:engineering.cells.map(c=>({rate:c.rate,scenario:c.scenario,state:c.state})),
  verification:verification.results.map(r=>({name:r.name,exitCode:r.exitCode,counts:r.counts,messages:r.messages,output:r.output})),
  capabilities:{Continuous:'MODEL_NOT_VALIDATED',STEP:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
  noNewDataset:true,noDetectorSearch:true,noModelTuning:true,secondProductModel:false,productionIntegration:false,
  limitations:['Development only, already-exposed overlapping clips and counterfactual score scenarios; no independent holdout run.',
   'Boundary-confounded development witnesses remain counted; cannot attribute them to neural non-detection.',
   'No acoustic assembly candidate selected; no claim of physical strike detection, microphone qualification, UX SLO or commercial readiness.',
   'Physical capture watermark in product replay is an explicit continuously advancing source-sample simulation, not a real-device measurement.'],completedAt:new Date().toISOString()};
 for(const [name,value] of Object.entries({development,verification,engineering,musical,scores,final}))await newJson(path.join(output,name+'.json'),value);
 console.log(JSON.stringify({disposition:BLOCKED,regressionPass,parity,modelRuns:final.modelRuns}));
 if(!regressionPass)process.exitCode=1;
}else if(process.argv[2]==='receipt'){
 const evidenceHead=git('rev-parse','HEAD'),remoteHead=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
 assert.equal(remoteHead,evidenceHead);
 const c=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
 const token=c.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);
 const get=async p=>{const r=await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'+p,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});if(!r.ok)throw Error('GITHUB_'+r.status);return r.json();};
 const status=await get('commits/'+evidenceHead+'/status'),runs=await get('actions/runs?head_sha='+evidenceHead);
 const githubReceipt={queriedAt:new Date().toISOString(),evidenceHead,remoteHead,combinedState:status.state,statuses:status.statuses,
  workflow_runs:runs.workflow_runs,interpretation:status.statuses.length===0&&runs.workflow_runs.length===0?'NOT CI PASS':'Inspect actual checks; local verification is not CI',
  receiptCommit:'Commit containing this receipt; identified by Git history, not a self-referential hash'};
 await newJson(path.join(output,'github-receipt.json'),githubReceipt);console.log(JSON.stringify(githubReceipt));
}else throw Error('EXPECTED blocked-evidence OR receipt');
