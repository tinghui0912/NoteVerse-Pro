import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,APP,WORK,verify,json} from './protocol.mjs';
const staticExecutionProof=await verify();
const vitest=(name,args=[])=>[name,'node',['node_modules/vitest/vitest.mjs','run',...args,'--reporter=json',`--outputFile=${path.join(WORK,name+'.json')}`],APP];
const commands=[
 vitest('vitest'),
 vitest('step-focused',['src/lib/practice/step','src/lib/practice/local-core/step-attempt.test.ts','src/lib/practice/local-core/step-rearm-watermark.test.ts','tests/unit/step-decoded-replay-contract.test.ts']),
 vitest('continuous-midi-focused',['src/lib/practice/local-core/local-practice-core.test.ts','src/lib/practice/continuous/continuous-practice-controller.test.ts','src/lib/practice/step/input-time-contract.test.ts']),
 vitest('browser-midi-focused',['src/lib/practice/midi/browser-midi-controller.test.ts']),
 ['research-metrics','docker',['run','--rm','--mount',`type=bind,source=${ROOT},target=/workspace`,'-w','/workspace/backend/research/step_decoded_sufficiency',
  '--entrypoint','python','noteverse-xc1-r3d-science:local','-m','unittest','-v','metrics_contract.py'],ROOT],
 ['typecheck','node',['node_modules/typescript/bin/tsc','--noEmit','--pretty','false'],APP],
 ['eslint','node',['node_modules/eslint/bin/eslint.js','.','--format=json'],APP],
 ['build','node',['node_modules/next/dist/bin/next','build','--webpack'],APP],
 ['backend-asset-unit','docker',['run','--rm','--env-file',path.join(ROOT,'backend/.env.docker'),'--mount',`type=bind,source=${ROOT},target=/workspace`,
  '-w','/workspace/backend','--entrypoint','python','noteverse-practice-acoustic-qualification:local','-m','unittest','tests.test_practice_acoustic_model_asset','-v'],ROOT],
 ['backend-asset-routes','docker',['run','--rm','--env-file',path.join(ROOT,'backend/.env.docker'),'--mount',`type=bind,source=${ROOT},target=/workspace`,
  '-w','/workspace/backend','--entrypoint','python','noteverse-practice-acoustic-qualification:local','-m','pytest','tests/test_model_assets.py','-q'],ROOT],
];
const results=[];
for(const [name,command,args,cwd] of commands){
 const startedAt=new Date().toISOString();console.log('START',name);
 const r=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',
  NEXT_BACKEND_ORIGIN:'http://localhost:8000',AUTH_COOKIE_NAME:'auth',REFRESH_COOKIE_NAME:'refresh'}});
 const item={...staticExecutionProof,executionStartedAt:startedAt,name,command,args,status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message,completedAt:new Date().toISOString()};
 if(name==='eslint')item.messages=JSON.parse(r.stdout).flatMap(f=>f.messages.map(m=>({path:f.filePath,rule:m.ruleId,message:m.message,severity:m.severity,line:m.line,column:m.column})));
 if(name==='vitest'||name.endsWith('-focused')){
  const v=JSON.parse(await readFile(path.join(WORK,name+'.json'),'utf8'));
  item.counts={files:v.testResults.length,total:v.numTotalTests,passed:v.numPassedTests,failed:v.numFailedTests};
  item.testFiles=v.testResults.map(f=>({path:f.name,status:f.status,tests:f.assertionResults.length}));
 }
 results.push(item);console.log('END',name,r.status,item.counts??'');
}
await json(path.join(WORK,'static.json'),{...staticExecutionProof,staticExecutionProof,results});
if(results.some(r=>r.status!==0))process.exitCode=1;
