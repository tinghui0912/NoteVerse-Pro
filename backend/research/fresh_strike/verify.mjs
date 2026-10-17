import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,WORK,verify,json} from './protocol.mjs';
const staticExecutionProof=await verify();
const app=path.join(ROOT,'apps/customer-web');
const commands=[
  ['research-node','node',['--test','backend/research/fresh_strike/detectors.test.mjs'],ROOT],
  ['research-python','docker',['run','--rm','--mount',`type=bind,source=${ROOT},target=/workspace`,'-w','/workspace/backend/research/fresh_strike',
    '--entrypoint','python','noteverse-xc1-r3d-science:local','-m','unittest','-v','test_contract.py'],ROOT],
  ['vitest','node',['node_modules/vitest/vitest.mjs','run','--reporter=json',`--outputFile=${path.join(WORK,'vitest.json')}`],app],
  ['typecheck','node',['node_modules/typescript/bin/tsc','--noEmit','--pretty','false'],app],
  ['eslint','node',['node_modules/eslint/bin/eslint.js','.','--format=json'],app],
  ['build','node',['node_modules/next/dist/bin/next','build','--webpack'],app],
];
const results=[];
for(const [name,command,args,cwd] of commands){
  const startedAt=new Date().toISOString();
  const result=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:64*1024*1024,
    env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',NEXT_BACKEND_ORIGIN:'http://localhost:8000',AUTH_COOKIE_NAME:'auth',REFRESH_COOKIE_NAME:'refresh'}});
  const item={name,command,args,cwd,startedAt,completedAt:new Date().toISOString(),status:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message};
  if(name==='eslint')item.messages=JSON.parse(result.stdout).flatMap(f=>f.messages.map(m=>({path:f.filePath,rule:m.ruleId,message:m.message,severity:m.severity,line:m.line,column:m.column})));
  if(name==='vitest'&&result.status===0){const v=JSON.parse(await readFile(path.join(WORK,'vitest.json'),'utf8'));item.counts={files:v.testResults.length,total:v.numTotalTests,passed:v.numPassedTests,failed:v.numFailedTests};}
  results.push(item);console.log(name,result.status);
}
await json(path.join(WORK,'static.json'),{...staticExecutionProof,staticExecutionProof,results,completedAt:new Date().toISOString()});
if(results.some(r=>r.status!==0))process.exitCode=1;
