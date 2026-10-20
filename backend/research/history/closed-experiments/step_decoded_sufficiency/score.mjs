import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ROOT,WORK,verify,json,hash} from './protocol.mjs';
const productExecutionProof=await verify();
const seal=JSON.parse(await readFile(path.join(WORK,'acoustic-seal.json'),'utf8'));
const acousticBytes=await readFile(path.join(ROOT,seal.path));
if(hash(acousticBytes)!==seal.sha256)throw Error('ACOUSTIC_SEAL_MISMATCH');
const acoustic=JSON.parse(acousticBytes);if(acoustic.status!=='SEALED_AUDIO_ONLY')throw Error('AUDIO_STAGE_NOT_PASS');
// Truth is opened only after verifying the complete acoustic seal.
const truth=JSON.parse(await readFile(path.join(WORK,'truth.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const bundle=path.join(WORK,'product-replay.mjs');
await esbuild.build({entryPoints:[path.join(ROOT,'backend/research/step_decoded_sufficiency/product-replay.ts')],outfile:bundle,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {replayScenario}=await import(pathToFileURL(bundle).href);
const groupBundle=path.join(WORK,'acoustic-gestures.mjs');
await esbuild.build({entryPoints:[path.join(ROOT,'backend/research/step_decoded_sufficiency/acoustic-gestures.ts')],outfile:groupBundle,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {DecodedGestureAssembler}=await import(pathToFileURL(groupBundle).href);
const results=[];
for(const cell of acoustic.result.results){
 const c=truth.cases.find(c=>c.id===cell.id),assembler=new DecodedGestureAssembler();
 const gestures=cell.publications.flatMap(p=>assembler.push(p));
 const scenarios=c.scenarios.map(s=>replayScenario(`${cell.id}:${cell.rate}`,s,cell.publications,c.ownedStartSeconds*1000));
 results.push({id:cell.id,rate:cell.rate,rawObservationCount:cell.publications.reduce((n,p)=>n+p.observations.length,0),gestures,scenarios});
}
await json(path.join(WORK,'product.json'),{...productExecutionProof,productExecutionProof,acousticSealSha256:hash(await readFile(path.join(WORK,'acoustic-seal.json'))),results});
execFileSync('docker',['run','--rm','--mount',`type=bind,source=${ROOT},target=/workspace`,'-w','/workspace','--entrypoint','python',
 'noteverse-xc1-r3d-science:local','backend/research/step_decoded_sufficiency/metrics.py'],{stdio:'inherit'});
