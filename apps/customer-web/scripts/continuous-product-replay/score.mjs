import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,APP,WORK,newJson,hash} from './protocol.mjs';
import {matchTruth} from './truth-matching.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const sealed=await read(path.join(WORK,'acoustic_seal.json'));
for(const item of sealed.files)if(hash(await readFile(path.join(ROOT,item.path)))!==item.sha256)throw new Error('SEALED_OUTPUT_CHANGED');
const musical=await read(path.join(WORK,'musical.json')),truth=await read(path.join(WORK,'truth.json'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(APP,'scripts/continuous-product-replay/product-scenarios.ts')],outfile:path.join(WORK,'product-scenarios.mjs'),bundle:true,format:'esm',platform:'node',target:'node24'});
const {replayProductScenarios}=await import(pathToFileURL(path.join(WORK,'product-scenarios.mjs')).href);
const midi=p=>{const m=/^([A-G])(#?)(-?\d+)$/.exec(p);if(!m)throw new Error('PITCH');return (Number(m[3])+1)*12+{C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]?1:0);};
const cells=[];
for(const result of musical.results){
  const physical=truth.clips.find(c=>c.id===result.id),notes=physical?.notes??[];
  if(physical?.alignmentSanity.grossOffsetScan.warning)throw new Error('PAIRED_ALIGNMENT_REQUIRES_REVIEW:'+result.id);
  const observations=result.publications.flatMap(p=>p.observations).map(o=>({id:o.observationId,timeMs:o.performanceTimeMs,pitch:midi(o.pitch)}));
  if(new Set(observations.map(o=>o.id)).size!==observations.length)throw new Error('OBSERVATION_DUPLICATE');
  const metrics=matchTruth(notes,observations),matched=new Set(metrics.pairs.map(p=>p.truthId));
  const by=(label,predicate)=>{const selected=notes.filter(predicate);return {label,truthCount:selected.length,matchedCount:selected.filter(n=>matched.has(n.id)).length,recall:selected.length?selected.filter(n=>matched.has(n.id)).length/selected.length:null};};
  const breakdown=[by('low',n=>n.pitch<48),by('middle',n=>n.pitch>=48&&n.pitch<72),by('high',n=>n.pitch>=72),
    by('soft MIDI velocity<=50',n=>n.velocity<=50),by('medium MIDI velocity51..90',n=>n.velocity>50&&n.velocity<=90),by('loud MIDI velocity>90',n=>n.velocity>90),
    by('chord component within20ms',n=>notes.some(m=>m.id!==n.id&&m.pitch!==n.pitch&&Math.abs(m.timeMs-n.timeMs)<=20)),
    by('single',n=>!notes.some(m=>m.id!==n.id&&Math.abs(m.timeMs-n.timeMs)<=20)),
    by('same-pitch retrigger <=500ms',n=>notes.some(m=>m.id!==n.id&&m.pitch===n.pitch&&Math.abs(m.timeMs-n.timeMs)<=500))];
  const scenarios=physical?replayProductScenarios(notes,result.publications):[];
  const confusion={};for(const s of scenarios){confusion[s.truth]??={};confusion[s.truth][s.predicted]=(confusion[s.truth][s.predicted]??0)+1;}
  cells.push({id:result.id,rate:result.rate,metrics,breakdown,scenarios,confusion,
    falsePositivePerMinute:result.id==='silence'?observations.length/1.8*60:null,
    physicalResidualAccounting:{count:metrics.unmatchedCount,observationIds:metrics.unmatchedIds,notCounterfactualAmplified:true},
    classification:'PRODUCT_REPLAY_QUALIFICATION_NOT_REAL_DEVICE_EVIDENCE',
    deficiencies:metrics.missedCount||metrics.unmatchedCount?['known fixed-model acoustic limitation; see note-level witnesses; dense grouping/alignment may contribute, no tuning or shifted truth']:[]});
}
await newJson(path.join(WORK,'scores.json'),{classification:'PRODUCT_REPLAY_QUALIFICATION_NOT_REAL_DEVICE_EVIDENCE',cells,
  matching:{windowMs:250,objective:'one-to-one max cardinality then min total error then stable ID',independentOfProductFinalizer:true},
  interpretation:'No model acceptance thresholds or tuning. MIDI velocity is a performance proxy, not measured room sound level. Counterfactual group timing is canonical earliest onset, not a natural independent fixed-BPM human trial.',
  newDatasetDownloads:0,realPhysicalMicrophones:0,realDeviceQualification:'DEFERRED',hardwareEnablementGate:'NOT_EXECUTED'});
console.log(JSON.stringify(cells.map(c=>({id:c.id,rate:c.rate,truth:c.metrics.truthCount,matched:c.metrics.matchedCount,precision:c.metrics.precision,recall:c.metrics.recall,confusion:c.confusion})),null,2));
