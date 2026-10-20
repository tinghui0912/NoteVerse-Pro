import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,DATA,APP,paths,verify,hash,newJson} from '../../../apps/customer-web/scripts/step-waiting-attempt-v2/protocol.mjs';
const scoringExecutionProof=await verify(),output=path.join(paths().work,'../holdout');
const seal=JSON.parse(await readFile(path.join(output,'acoustic-seal.json'),'utf8'));
const bytes=await readFile(path.join(ROOT,seal.file));
if(hash(bytes)!==seal.sha256||seal.status!=='ACOUSTIC_OUTPUT_SEALED')throw Error('NO_VALID_ACOUSTIC_SEAL');
const sealed=JSON.parse(bytes),truthOpenedAt=new Date().toISOString();
// No target/MIDI reads may move above this seal verification.
const truth=JSON.parse(await readFile(path.join(DATA,'truth.json'),'utf8'));
const contract=JSON.parse(await readFile(path.join(ROOT,'backend/research/step_waiting_attempt_v2/contract.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(ROOT,'backend/research/step_waiting_attempt_v2/product-scoring.ts')],outfile:path.join(output,'product-scoring.mjs'),bundle:true,format:'esm',platform:'node',nodePaths:[path.join(APP,'node_modules')]});
const {scoreProduct,targetVariants}=await import(pathToFileURL(path.join(output,'product-scoring.mjs')).href);
const architecture=Object.fromEntries(contract.architectureCounters.map(k=>[k,0])),empirical=Object.fromEntries(contract.empiricalCounters.map(k=>[k,0]));
const cells=[],witnesses=[],latency={availability:[],lock:[],verdict:[]};
for(const evidence of sealed.result.results){
 const c=truth.cases.find(c=>c.id===evidence.id),variants=targetVariants(c.physicalPitches),rows=[];
 for(const variant of variants){
  const mode=c.family==='busy_period_input'?'busy':c.family==='late_publication'?'late':'normal';
  const result=scoreProduct(evidence,c,variant.pitches,mode);
  for(const [k,v] of Object.entries(result.architecture))architecture[k]+=v;
  const shifted=scoreProduct(evidence,c,variant.pitches,mode,200);
  const identity=o=>[o.attempt.candidateId,o.attempt.eventMs,o.attempt.captureEndMs];
  const common=new Map(result.outcomes.map(o=>[o.attempt.candidateId,identity(o)]));
  architecture.publicationCompletionTimeChangesAttemptIdentity+=shifted.outcomes.filter(o=>common.has(o.attempt.candidateId)&&JSON.stringify(identity(o))!==JSON.stringify(common.get(o.attempt.candidateId))).length;
  const dangerous=result.outcomes.filter(o=>o.verdict==='MATCH'&&!o.corroborated);
  for(const o of dangerous){
   const category=c.family.endsWith('negative')?'heldPedalFalseMatch':variant.name==='subset'?'extraPhysicalPitchFalseMatch':variant.name==='superset'?'missingExpectedPitchFalseMatch':'wrongPitchFalseMatch';
   empirical[category]++;
   if(c.family==='held_note_negative')empirical.samePitchSustainFalseMatch++;
   if(c.family==='pedal_sustain_negative')empirical.sameChordSustainFalseMatch++;
   witnesses.push({id:c.id,rate:evidence.rate,family:c.family,variant:variant.name,category,outcome:o});
  }
  if(variant.name==='exact')for(const o of result.outcomes){latency.availability.push(Math.min(...o.attempt.observations.map(n=>n.availabilityMs))-o.attempt.eventMs);latency.lock.push(o.attempt.lockMs-o.attempt.eventMs);latency.verdict.push(o.verdictMs-o.attempt.eventMs);}
  rows.push({variant:variant.name,target:variant.pitches,...result});
 }
 cells.push({id:c.id,rate:evidence.rate,family:c.family,source:c.source,guardSeconds:c.family.endsWith('negative')?c.scoredEnd-c.warmBoundary:0,
  rawTokens:evidence.publications.reduce((n,p)=>n+p.observations.length,0),warm:evidence.assembly.warmWitness,rows});
}
const distribution=values=>{values.sort((a,b)=>a-b);return {count:values.length,median:values[Math.floor(values.length*.5)]??null,p95:values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)]??null,max:values.at(-1)??null};};
const usability=contract.families.map(family=>{
 const trials=cells.filter(c=>c.family===family).map(c=>c.rows[0]);
 return {family,trials:trials.length,validWaitingTrials:trials.filter(t=>t.waitingOpportunityAfterActualReady).length,
  corroboratedMatches:trials.reduce((n,t)=>n+t.outcomes.filter(o=>o.verdict==='MATCH'&&o.corroborated).length,0),
  mismatches:trials.reduce((n,t)=>n+t.outcomes.filter(o=>o.verdict==='MISMATCH').length,0),retry:0};
});
const invalidWaiting=cells.filter(c=>!c.rows[0].waitingOpportunityAfterActualReady).map(c=>({id:c.id,rate:c.rate,family:c.family}));
const safety=Object.values(architecture).every(n=>n===0)&&Object.values(empirical).every(n=>n===0);
await newJson(path.join(output,'scores.json'),{...scoringExecutionProof,scoringExecutionProof,acousticSeal:seal,truthOpenedAt,architecture,empirical,
 status:safety&&invalidWaiting.length===0?'PASS':'BLOCKED',cells,witnesses,usability,invalidWaiting,latency:Object.fromEntries(Object.entries(latency).map(([k,v])=>[k,distribution(v)])),
 classifications:{architectureFailure:!Object.values(architecture).every(n=>n===0),acousticQualityFailure:!Object.values(empirical).every(n=>n===0),
 qualificationCorpusWaitingFailure:invalidWaiting.length>0},usabilityQualification:'MEASURED_NOT_YET_PRODUCT_SLO_QUALIFIED',capabilities:contract.capabilities});
console.log(JSON.stringify({safety,architecture,empirical,invalidWaiting,usability}));
if(!safety||invalidWaiting.length)process.exitCode=1;
