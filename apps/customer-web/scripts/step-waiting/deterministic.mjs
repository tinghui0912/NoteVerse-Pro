import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ROOT,APP,paths,newJson,verify} from './protocol.mjs';
const proof=await verify(),work=paths().work;
const verification=JSON.parse(await readFile(path.join(work,'verification.json'),'utf8'));
if(verification.status!=='PASS')throw new Error('STATIC_NOT_PASS');
await mkdir(work,{recursive:true});
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/lib/practice/step','src/lib/practice/local-core/step-attempt.test.ts',
 'src/lib/practice/local-core/step-rearm-watermark.test.ts','src/lib/practice/midi/browser-midi-controller.test.ts',
 'src/hooks/practice/use-local-practice.test.tsx','src/components/practice/practice-controls.test.tsx',
 'src/lib/practice/local-core/continuous-midi-evidence.test.ts','src/lib/practice/continuous',
 'tests/unit/step-decoded-replay-contract.test.ts','--reporter=json','--outputFile='+path.join(work,'step-vitest.json')],{cwd:APP,encoding:'utf8',maxBuffer:16*1024*1024});
await writeFile(path.join(work,'step-tests.stdout.txt'),result.stdout??'');await writeFile(path.join(work,'step-tests.stderr.txt'),result.stderr??'');
const suite=JSON.parse(await readFile(path.join(work,'step-vitest.json'),'utf8'));
await writeFile(path.join(work,'step-vitest.json'),JSON.stringify({...suite,...proof},null,2)+'\n');
const esbuild=await import(pathToFileURL(path.join(ROOT,'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({entryPoints:[path.join(APP,'scripts/step-waiting/witnesses.ts')],outfile:path.join(work,'boundary-witnesses.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
const {runBoundaryWitnesses}=await import(pathToFileURL(path.join(work,'boundary-witnesses.mjs')).href);
const witnesses=runBoundaryWitnesses();
await newJson(path.join(work,'step-deterministic.json'),{...proof,proof,status:result.status===0?'PASS':'FAIL',completedAt:new Date().toISOString(),
 tests:{files:suite.testResults.length,total:suite.numTotalTests,passed:suite.numPassedTests,failed:suite.numFailedTests,
 assertions:suite.testResults.flatMap(f=>f.assertionResults.map(a=>({file:path.relative(APP,f.name),name:a.fullName,status:a.status,failures:a.failureMessages})))},
 witnesses,actualNeuralModelRuns:0});
console.log(JSON.stringify({tests:suite.numTotalTests,failed:suite.numFailedTests,witnessStatus:witnesses.status}));
if(result.status!==0)process.exitCode=1;
