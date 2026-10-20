import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {executeSource} from './source-execution';
import {assertJobs,assertComplete,gateInput,RunOwnership} from './policy';
const manifest=JSON.parse(await readFile('backend/data/work/step_waiting_h50_holdout_v6/audio_only/jobs.json','utf8'));
assertJobs(manifest);let windows=0,jobs=0;
for(const job of manifest.jobs){
 const bytes=await readFile(job.pcmPath);const source=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const fir=new Uint8Array(await readFile('apps/customer-web/public/model-assets/practice-acoustic/'+(job.sourceRateHz===44100?'fir-160-441.f32':'fir-1-3.f32')));
 await executeSource(job,source,fir,{run:async()=>({events:[],inferenceMs:0,decodeMs:0,actualSessionRunCount:++windows}),dispose:async()=>{}},()=>{},()=>{});jobs++;
}
const bad=structuredClone(manifest);bad.jobs[0].family='forbidden';assert.throws(()=>assertJobs(bad));
const missing=structuredClone(manifest);missing.jobs[0].expectedModelInputs.pop();assert.throws(()=>assertJobs(missing));
const extra=structuredClone(manifest);extra.jobs[0].expectedModelInputs.push({...extra.jobs[0].expectedModelInputs.at(-1),windowIndex:999});assert.throws(()=>assertJobs(extra));
const owner=new RunOwnership();owner.worker();owner.session();assert.throws(()=>owner.worker());assert.throws(()=>owner.session());
const zero=new Float32Array(29120),j=manifest.jobs[0];let invoked=false;
await assert.rejects(async()=>{await gateInput(j,0,{window:{windowIndex:0,startSample:2400,endSample:31520},pcm:zero});invoked=true;});assert.equal(invoked,false);
assert.throws(()=>assertComplete(j,0));
console.log(JSON.stringify({role:'SYNTHETIC_EMPTY_PORT_CONTRACT_ONLY_NO_NEURAL_EXECUTION',dryJobs:jobs,dryModelWindows:windows,newNeuralRuns:0,checks:8}));
