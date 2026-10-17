import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,APP,DATA,paths,verify,hash,newJson} from '../../../apps/customer-web/scripts/step-waiting-topology-v3/protocol.mjs';
const scoringExecutionProof=await verify(),out=path.join(paths().work,'../holdout');
const seal=JSON.parse(await readFile(path.join(out,'acoustic-seal.json'),'utf8')),bytes=await readFile(path.join(ROOT,seal.file));
if(hash(bytes)!==seal.sha256||seal.status!=='ACOUSTIC_OUTPUT_SEALED')throw Error('INVALID_ACOUSTIC_SEAL');
const acoustic=JSON.parse(bytes),truthOpenedAt=new Date().toISOString();
const truth=JSON.parse(await readFile(path.join(DATA,'truth.json'),'utf8'));
const contract=JSON.parse(await readFile(path.join(ROOT,'backend/research/step_waiting_topology_v3/contract.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(ROOT,'backend/research/step_waiting_topology_v3/product-scoring.ts')],outfile:path.join(out,'product.mjs'),bundle:true,format:'esm',platform:'node',nodePaths:[path.join(APP,'node_modules')]});
const {replayProduct,targetVariants}=await import(pathToFileURL(path.join(out,'product.mjs')).href);
const architecture=Object.fromEntries(contract.architectureCounters.map(k=>[k,0])),empirical=Object.fromEntries(contract.empiricalCounters.map(k=>[k,0]));
const cells=[],dangerousWitnesses=[],invalidReady=[],guardAttempts=[],missingSuppressionWitnesses=[];
const latency={inputDeliveredToLock:[],inputDeliveredToVerdict:[],sourceEventToCompleteCoverage:[]};
for(const cell of acoustic.result.results){
 const c=truth.cases.find(c=>c.id===cell.id),rows=[];
 for(const variant of targetVariants(c.physicalPitches)){
  const result=replayProduct(cell,c,variant.pitches),shifted=replayProduct(cell,c,variant.pitches,200);
  for(const [k,v] of Object.entries(result.architecture))architecture[k]+=v;
  const identity=r=>r.outcomes.map(o=>[o.attemptId,o.attempt.anchor,o.attempt.end]);
  architecture.publicationCompletionTimeChangesAttemptIdentity+=JSON.stringify(identity(result))!==JSON.stringify(identity(shifted))?1:0;
  for(const o of result.outcomes.filter(o=>o.verdict==='MATCH'&&!o.fullPhysicalSupport)){
   empirical.matchWithoutFullPhysicalPitchSupport++;
   const negative=contract.negativeTopologies.includes(c.topology),category=negative?'heldOrPedalFalseMatch':variant.name==='subset'?'extraPhysicalPitchFalseMatch':variant.name==='superset'?'missingExpectedPitchFalseMatch':'wrongPitchFalseMatch';
   empirical[category]++;
   if(c.topology==='held_note')empirical.samePitchSustainFalseMatch++;
   if(c.topology==='pedal_sustain')empirical.sameChordSustainFalseMatch++;
   const physical=o.truthGroup===null?null:c.truth[o.truthGroup];
   const nearby=cell.publications.flatMap(p=>p.observations).filter(n=>Math.abs(n.sourceEventSample/cell.rate*1000-o.attempt.anchor/cell.rate*1000)<=100);
   const missingRaw=physical?.notes.filter(n=>!nearby.some(a=>a.midiPitch===n.pitch)).map(n=>n.pitch)??[];
   const attribution=physical===null?'NO_CORROBORATING_PHYSICAL_GESTURE':missingRaw.length?'FIXED_DECODED_EVIDENCE_LIMITATION':'BOUNDED_ASSEMBLY_OR_ALIGNMENT_LIMITATION';
   dangerousWitnesses.push({id:c.id,rate:cell.rate,topology:c.topology,variant:variant.name,category,attribution,missingRawPhysicalPitches:missingRaw,nearbyRaw:nearby,outcome:o});
  }
  rows.push({variant:variant.name,target:variant.pitches,...result});
 }
 const exact=rows[0];
 if(contract.readyTopologies.includes(c.topology)&&(!exact.readiness.valid||!exact.readiness.causalWarmBeforeArm))invalidReady.push({id:c.id,rate:cell.rate,topology:c.topology,readiness:exact.readiness});
 if(contract.negativeTopologies.includes(c.topology)&&exact.outcomes.length)guardAttempts.push({id:c.id,rate:cell.rate,outcomes:exact.outcomes});
 if(['capturing_outside','analyzing','reset'].includes(c.topology)){
  const expected={capturing_outside:'CAPTURING',analyzing:'ANALYZING',reset:'RESET'}[c.topology];
  if(exact.secondPhysicalCapture?.state!==expected)missingSuppressionWitnesses.push({id:c.id,rate:cell.rate,topology:c.topology,expected,actual:exact.secondPhysicalCapture});
 }
 if(c.topology==='late_publication'&&!cell.receipts.some(r=>r.late))missingSuppressionWitnesses.push({id:c.id,rate:cell.rate,topology:c.topology,expected:'DELAYED_RECEIPT'});
 if(contract.readyTopologies.includes(c.topology))for(const o of exact.outcomes){
  if(o.physicalEventCapture){latency.inputDeliveredToLock.push(o.attempt.lockWallMs-o.physicalEventCapture.wallMs);latency.inputDeliveredToVerdict.push(o.verdictWallMs-o.physicalEventCapture.wallMs);}
  latency.sourceEventToCompleteCoverage.push((o.attempt.frontier-o.attempt.anchor)/cell.rate*1000);
 }
 cells.push({id:c.id,rate:cell.rate,topology:c.topology,source:c.source,rows,rawTokens:cell.publications.reduce((n,p)=>n+p.observations.length,0)});
}
const usability=contract.readyTopologies.flatMap(topology=>[44100,48000].map(rate=>{
 const trials=cells.filter(c=>c.topology===topology&&c.rate===rate).map(c=>c.rows[0]);
 return {topology,rate,independentOccurrences:trials.length,validReadyTrials:trials.filter(t=>t.readiness.valid).length,
  exactTargetMatch:trials.filter(t=>t.outcomes.some(o=>o.verdict==='MATCH'&&o.fullPhysicalSupport)).length,
  mismatch:trials.filter(t=>t.outcomes.some(o=>o.verdict==='MISMATCH')).length,retry:0,noAttempt:trials.filter(t=>!t.outcomes.length).length};
}));
const missingRecognition=usability.filter(u=>u.exactTargetMatch===0);
const distribution=a=>{a.sort((x,y)=>x-y);return {count:a.length,median:a[Math.floor(a.length*.5)]??null,p95:a[Math.min(a.length-1,Math.ceil(a.length*.95)-1)]??null,max:a.at(-1)??null};};
const pass=Object.values(architecture).every(n=>n===0)&&Object.values(empirical).every(n=>n===0)&&!invalidReady.length&&!guardAttempts.length&&!missingRecognition.length&&!missingSuppressionWitnesses.length;
await newJson(path.join(out,'scores.json'),{...scoringExecutionProof,scoringExecutionProof,acousticSeal:seal,truthOpenedAt,status:pass?'PASS':'BLOCKED',
 architecture,empirical,invalidReady,guardAttempts,missingRecognition,missingSuppressionWitnesses,usability,dangerousWitnesses,cells,
 latency:Object.fromEntries(Object.entries(latency).map(([k,v])=>[k,distribution(v)])),
 retry:'RETRY_CLASSIFIER_NOT_IMPLEMENTED',interpretation:'Finite engineering replay only; source event chronology and actual browser wall availability remain distinct. Backpressured replay timing is not human UX/device latency.',capabilities:contract.capabilities});
console.log(JSON.stringify({pass,architecture,empirical,invalidReady,guardAttempts:guardAttempts.length,missingRecognition,missingSuppressionWitnesses,usability}));
if(!pass)process.exitCode=1;
