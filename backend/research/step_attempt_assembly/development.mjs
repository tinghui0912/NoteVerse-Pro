import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ROOT,git,hash,newJson,verify} from '../../../apps/customer-web/scripts/step-assembly/protocol.mjs';
const developmentExecutionProof=await verify(),work=path.join(ROOT,'backend/data/work/step_attempt_assembly/development-v1');
const reports=path.join(ROOT,'backend/research/reports/step_decoded_sufficiency_v1');
const seal=JSON.parse(await readFile(path.join(reports,'acoustic-seal.json'),'utf8'));
const bytes=await readFile(path.join(reports,'acoustic.json'));assert.equal(hash(bytes),seal.sha256);
const acoustic=JSON.parse(bytes);
// This is already-exposed development evidence, not a new truth-isolated evaluation.
const truth=JSON.parse(await readFile(path.join(reports,'truth.json'),'utf8'));
const plan=JSON.parse(await readFile(path.join(ROOT,'backend/research/step_attempt_assembly/development-plan.json'),'utf8'));
assert.ok(git('merge-base','--is-ancestor',developmentExecutionProof.freezeCommit,'HEAD')==='');
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const bundle=path.join(work,'replay.mjs');
await esbuild.build({entryPoints:[path.join(ROOT,'backend/research/step_attempt_assembly/replay.ts')],outfile:bundle,bundle:true,format:'esm',platform:'node',target:'es2022'});
const {replay}=await import(pathToFileURL(bundle).href),trials=[];
for(const widthMs of [plan.baselineMs,...plan.candidateHsMs]){
 const cells=[];
 for(const cell of acoustic.result.results){
  const c=truth.cases.find(c=>c.id===cell.id);
  cells.push({id:cell.id,rate:cell.rate,scenarios:c.scenarios.map(s=>replay(`${cell.id}:${cell.rate}`,s,cell.publications,c.ownedStartSeconds*1000,cell.rate,widthMs))});
 }
 const mandatoryBachProbe=acoustic.result.results.filter(c=>c.id==='s00-05').map(cell=>replay(`bach-probe:${cell.rate}`,
  {name:'mandatory_Bach_subset_probe',targets:[[64]]},cell.publications.map(p=>({...p,
    observations:p.observations.filter(o=>o.eventMs>=4250&&o.eventMs<4400)})),4250,cell.rate,widthMs));
 trials.push({widthMs,cells,mandatoryBachProbe});
}
await newJson(path.join(work,'development-output.json'),{...developmentExecutionProof,developmentExecutionProof,acousticSealSha256:seal.sha256,
 developmentPlanSha256:hash(await readFile(path.join(ROOT,'backend/research/step_attempt_assembly/development-plan.json'))),trials,
 modelInferenceRuns:0,holdoutOpened:false,completedAt:new Date().toISOString()});
execFileSync('docker',['run','--rm','--mount',`type=bind,source=${ROOT},target=/workspace`,'-w','/workspace','--entrypoint','python',
 'noteverse-xc1-r3d-science:local','backend/research/step_attempt_assembly/metrics.py'],{stdio:'inherit'});
