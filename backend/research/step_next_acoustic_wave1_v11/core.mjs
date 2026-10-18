import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const ROOT=path.resolve(import.meta.dirname,'../../..');
export const DIR='backend/research/step_next_acoustic_wave1_v11';
export const OUT='backend/research/reports/step_next_acoustic_wave1_v11';
export const WORK='backend/data/work/step_next_acoustic_wave1_v11';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const load=async p=>JSON.parse(await readFile(path.join(ROOT,p),'utf8'));
export async function save(p,v){await mkdir(path.dirname(path.join(ROOT,p)),{recursive:true});await writeFile(path.join(ROOT,p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});}
export function assertGraph(inputs){const bad=inputs.filter(p=>/step-runtime|step-attempt|step-practice-controller|WaitingTopologyGate|selector|scorer|product-replay|scenario|midi-parser|evaluate\.ts/i.test(p));if(bad.length)throw Error('STAGE_A_TRUTH_IMPORT:'+bad);}
export function comparable(publication){return {sourceDomainId:publication.sourceDomainId,sourceSampleRateHz:publication.sourceSampleRateHz,window:publication.window,
  observations:publication.observations.map(o=>({pitch:o.pitch,midiPitch:o.midiPitch,sourceEventSample:o.sourceEventSample,targetSample:o.targetSample,confidence:o.confidence}))};}
