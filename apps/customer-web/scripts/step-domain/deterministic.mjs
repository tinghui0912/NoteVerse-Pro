import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ROOT,APP,paths,newJson,verify,hash} from './protocol.mjs';
const proof=await verify(),work=paths().work;
await mkdir(work,{recursive:true});
const startedAt=new Date().toISOString();
const test=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/lib/practice/step','src/lib/practice/local-core/step-attempt.test.ts',
 'src/lib/practice/midi/browser-midi-controller.test.ts','--reporter=json','--outputFile='+path.join(work,'step-vitest.json')],{cwd:APP,encoding:'utf8'});
await writeFile(path.join(work,'step-tests.stdout.txt'),test.stdout??'');await writeFile(path.join(work,'step-tests.stderr.txt'),test.stderr??'');
const suite=JSON.parse(await readFile(path.join(work,'step-vitest.json'),'utf8'));
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const archive='backend/research/history/step-original-bytedance-low-level-before-domain-reset/apps/customer-web/src/lib/practice/acoustic-inference/';
for(const [file,out] of [[archive+'bytedance-decoder.ts','old-decoder.mjs'],['apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts','decoder.mjs']]) {
 await esbuild.build({entryPoints:[path.join(ROOT,file)],outfile:path.join(work,out),bundle:true,platform:'node',format:'esm',target:'node24'});
}
const old=await import(pathToFileURL(path.join(work,'old-decoder.mjs')).href),current=await import(pathToFileURL(path.join(work,'decoder.mjs')).href);
let seed=13371;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const cases=[];
for(let n=0;n<100;n++){
 const raw={reg_onset_output:new Float32Array(183*88),frame_output:new Float32Array(183*88),reg_onset_shape:[1,183,88],frame_shape:[1,183,88]};
 for(let i=0;i<raw.reg_onset_output.length;i++){raw.reg_onset_output[i]=random()<.025?random():0;raw.frame_output[i]=random();}
 const start=n*9600-16800,thresholds={onsetThreshold:.30,frameThreshold:.05};
 const before=old.decodeByteDanceRawOutputs(raw,{requestId:String(n),pcm:new Float32Array(29120),sampleRateHz:16000,channelCount:1,
  captureStartSampleIndex:start,captureStartTime:{domainId:'parity',ms:start/16}},thresholds).map(e=>({pitch:e.pitch,midiPitch:e.midiPitch,targetSample:e.onsetTime.sampleIndex,confidence:e.confidence,onsetScore:e.onsetScore,frameScore:e.frameScore}));
 const after=current.decodeRobustPiano(raw,start,thresholds);assert.deepEqual(after,before);
 cases.push({index:n,events:after.length,sha256:hash(JSON.stringify(after))});
}
await newJson(path.join(work,'step-deterministic.json'),{proof,startedAt,completedAt:new Date().toISOString(),status:test.status===0?'PASS':'FAIL',
 tests:{files:suite.testResults.length,total:suite.numTotalTests,passed:suite.numPassedTests,failed:suite.numFailedTests,
 assertions:suite.testResults.flatMap(f=>f.assertionResults.map(a=>({file:path.relative(APP,f.name),name:a.fullName,status:a.status,failures:a.failureMessages})))},
 decoderRelocationParity:{status:'PASS',syntheticRawTensorFixtures:cases.length,cases,thresholds:{onset:.30,frame:.05},exact:true,
  reference:'Exact archived historical region decoder with explicit current frozen thresholds; no old defaults used.'},actualNeuralModelRuns:0});
if(test.status!==0)process.exitCode=1;
console.log(JSON.stringify({tests:suite.numTotalTests,failed:suite.numFailedTests,decoderFixtures:100}));
