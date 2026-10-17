import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,paths,verify,newJson,hash} from './protocol.mjs';
const replayExecutionProof=await verify(),work=paths().work;
const reports=path.join(ROOT,'backend/research/reports/step_decoded_sufficiency_v1');
const bytes=await readFile(path.join(reports,'acoustic.json'));
const seal=JSON.parse(await readFile(path.join(reports,'acoustic-seal.json'),'utf8'));
assert.equal(hash(bytes),seal.sha256,'HISTORICAL_ACOUSTIC_SEAL_CHANGED');
// No inference and no new audio acquisition. The old acoustic predictions are immutable.
const acoustic=JSON.parse(bytes),truth=JSON.parse(await readFile(path.join(reports,'truth.json'),'utf8'));
const previous=JSON.parse(await readFile(path.join(reports,'product.json'),'utf8'));
const previousScores=JSON.parse(await readFile(path.join(reports,'scores.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const bundle=path.join(work,'eligibility-replay.mjs');
await esbuild.build({entryPoints:[path.join(ROOT,'backend/research/step_waiting/product-replay.ts')],outfile:bundle,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {replayScenario}=await import(pathToFileURL(bundle).href),results=[],retiredBusyWitnesses=[];
for(const cell of acoustic.result.results){
 const c=truth.cases.find(c=>c.id===cell.id),old=previous.results.find(r=>r.id===cell.id&&r.rate===cell.rate);
 const scenarios=c.scenarios.map(s=>replayScenario(`${cell.id}:${cell.rate}`,s,cell.publications,c.ownedStartSeconds*1000,cell.rate));
 for(const s of scenarios){
  for(const o of s.outcomes){
   const priors=s.outcomes.filter(p=>p!==o&&p.eventMs<o.eventMs);
   assert.ok(priors.every(p=>!p.rearmed||o.eventMs>p.rearmWatermarkMs),'RETIRED_INPUT_RESURRECTED');
   assert.ok(priors.every(p=>!(p.lockMs<=o.eventMs&&o.eventMs<p.verdictMs)),'BUSY_INPUT_CARRYOVER');
   assert.ok(o.rearmWatermarkMs!==o.analysisFrontierMs,'ANALYSIS_FRONTIER_USED_AS_CAPTURE_CLOCK');
  }
  const oldScenario=old.scenarios.find(s2=>s2.scenario.name===s.scenario.name);
  for(const o of oldScenario.outcomes){
   const busy=oldScenario.outcomes.find(p=>p!==o&&p.lockMs<=o.eventMs&&o.eventMs<p.verdictMs);
   if(o.verdict==='MATCH'&&busy)retiredBusyWitnesses.push({id:cell.id,rate:cell.rate,scenario:s.scenario.name,
     previousFalseAdvance:o,previousBusyAttempt:busy,
     sameSourceEvidenceNowAdvances:s.outcomes.some(n=>n.eventMs===o.eventMs&&n.verdict==='MATCH'),
     captureBoundary:s.outcomes.find(n=>n.eventMs===busy.eventMs)?.captureWitness});
  }
 }
 results.push({id:cell.id,rate:cell.rate,scenarios});
}
assert.equal(retiredBusyWitnesses.length,8);
assert.ok(retiredBusyWitnesses.every(w=>!w.sameSourceEvidenceNowAdvances));
const bach=previousScores.dangerousWitnesses.filter(w=>w.recordingId?.startsWith('Bach')&&w.violations.includes('wrongPitchAdvance'));
const groupingWitnesses=bach.map(w=>({caseId:w.caseId,rate:w.rate,scenario:w.scenario,
 historical:w,current:results.find(r=>r.id===w.caseId&&r.rate===w.rate)?.scenarios.find(s=>s.scenario.name===w.scenario)?.outcomes.filter(o=>o.eventMs===w.outcome.eventMs)}));
// Preserve the historical split even if changed input retirement removes a
// particular counterfactual attempt. Residual acoustic failures are NOT a gate
// for this waiting-lifecycle phase, nor can their absence qualify the assembler.
assert.ok(groupingWitnesses.length>0,'HISTORICAL_ACOUSTIC_GROUPING_WITNESS_MISSING');
await newJson(path.join(work,'input-eligibility-replay.json'),{...replayExecutionProof,replayExecutionProof,status:'PASS',
 inputEligibilitySafety:'ESTABLISHED_FOR_FROZEN_CASES',acousticGestureAssemblySafety:'NOT_ESTABLISHED',
 previousAcousticDisposition:'STEP_DECODED_ACOUSTIC_ATTEMPT_SAFETY_NOT_ESTABLISHED',
 acousticSealSha256:seal.sha256,actualNewNeuralModelRuns:0,rates:[44100,48000],cells:results.length,
 busyPeriodCarryoverAdvance:0,latePublicationCarryoverAdvance:0,retiredBusyWitnesses,groupingWitnesses,results,
 captureClockScope:'Counterfactual source-sample capture clock continues while worker busy. Physical sample position, not analyzed frontier, supplies readiness. Availability only schedules replay transactions; no real device/time claim.',
 groupingScope:'Historical 35ms research assembler retained solely to keep its failure visible, NOT a future acoustic policy.',
 completedAt:new Date().toISOString()});
console.log(JSON.stringify({status:'PASS',cells:results.length,retiredBusyWitnesses:retiredBusyWitnesses.length,acousticGestureAssemblySafety:'NOT_ESTABLISHED',neuralRuns:0}));
