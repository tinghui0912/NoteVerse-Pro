import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,APP,WORK,BASE,verify,newJson,hash} from './protocol.mjs';
const proof=await verify(),read=async p=>JSON.parse(await readFile(p,'utf8'));
const seal=await read(path.join(WORK,'acoustic_seal.json'));
if(hash(await readFile(path.join(WORK,'musical.json')))!==seal.sha256)throw Error('MUSICAL_SEAL_CHANGED');
// Truth opens only after the musical acoustic output seal has been checked.
const musical=await read(path.join(WORK,'musical.json')),truth=await read(path.join(ROOT,'backend/data/work/product_completion_replay/v4/truth.json'));
const baseline=await read(path.join(ROOT,BASE,'musical.json')),baselineScores=await read(path.join(ROOT,BASE,'scores.json'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(APP,'scripts/continuous-product-replay/product-scenarios.ts')],outfile:path.join(WORK,'scenarios.mjs'),bundle:true,format:'esm',platform:'node'});
const {replayProductScenarios}=await import(pathToFileURL(path.join(WORK,'scenarios.mjs')).href);
const clean=value=>{
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['availabilityTimeMs','finalizedAtMs','finalizationTimeMs'].includes(key)).map(([key,v])=>[key,clean(v)]));
 return value;
};
const diffs=[],cells=[],availabilityMeasurements=[];
for(const result of musical.results){
 const prior=baseline.results.find(r=>r.id===result.id&&r.rate===result.rate);
 for(const publication of result.publications){const old=prior.publications.find(p=>p.publicationId===publication.publicationId);
  if(old)availabilityMeasurements.push({id:result.id,rate:result.rate,publicationId:publication.publicationId,
   priorAvailabilityMs:old.availabilityTimeMs,currentAvailabilityMs:publication.availabilityTimeMs,deltaMs:publication.availabilityTimeMs-old.availabilityTimeMs,
   currentEventToAvailabilityMs:publication.observations.map(o=>publication.availabilityTimeMs-o.performanceTimeMs)});}
 const physical=truth.clips.find(c=>c.id===result.id);
 const scenarios=physical?replayProductScenarios(physical.notes,result.publications):[];
 const priorScenarios=baselineScores.cells.find(c=>c.id===result.id&&c.rate===result.rate)?.scenarios;
 const projection=r=>({publications:clean(r.publications),counts:r.snapshot.counts,frontier:r.snapshot.analyzedThroughPerformanceMs,
  outstanding:r.snapshot.outstanding,actualModelRuns:r.actualModelRuns});
 if(JSON.stringify(projection(result))!==JSON.stringify(projection(prior)))diffs.push({id:result.id,rate:result.rate,kind:'PUBLICATION_EVALUATION_PARITY'});
 if(JSON.stringify(clean(scenarios))!==JSON.stringify(clean(priorScenarios)))diffs.push({id:result.id,rate:result.rate,kind:'PRODUCT_SCENARIO_PARITY'});
 cells.push({id:result.id,rate:result.rate,scenarios,publications:result.publications.length,actualModelRuns:result.actualModelRuns});
}
await newJson(path.join(WORK,'parity.json'),{...proof,status:diffs.length?'BLOCKED':'PASS',cells,diffs,
 baseline:BASE,ignoredNonsemanticFields:['availabilityTimeMs','finalizedAtMs','finalizationTimeMs'],controller:musical.controllerResult,
 availabilityMeasurements,latencyRole:'Deterministic backpressured replay processing measurements, not live capture/UX latency SLO; capture fill/ACK/finalization measured separately in engineering cells'});
if(diffs.length)process.exitCode=1;
