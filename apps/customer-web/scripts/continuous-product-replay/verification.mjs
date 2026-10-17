import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,WORK,ID,verify,newJson} from './protocol.mjs';
const proof=await verify();
const result=spawnSync(process.execPath,['apps/customer-web/scripts/continuous-controller/verify.mjs',ID],{cwd:ROOT,stdio:'inherit'});
const previous=JSON.parse(await readFile(path.join(ROOT,`backend/data/work/continuous_controller/${ID}/verification.json`),'utf8'));
const truthTests=spawnSync(process.execPath,['--test','apps/customer-web/scripts/continuous-product-replay/truth-matching.test.mjs'],{cwd:ROOT,encoding:'utf8'});
console.log(truthTests.stdout,truthTests.stderr);
const pathsTest=spawnSync('docker',['run','--rm','--mount',`type=bind,source=${ROOT},target=/workspace`,'-w','/workspace','--entrypoint','python','noteverse-xc1-r3d-science:local','-m','unittest','backend.research.qualification.test_product_replay_prepare','-v'],{encoding:'utf8'});
console.log(pathsTest.stdout,pathsTest.stderr);
await newJson(path.join(WORK,'verification.json'),{proof,results:previous.results,
  dockerReceiptPathTests:{exitCode:pathsTest.status,stdout:pathsTest.stdout,stderr:pathsTest.stderr},
  truthMatchingTests:{exitCode:truthTests.status,stdout:truthTests.stdout,stderr:truthTests.stderr},
  status:result.status===0&&truthTests.status===0&&pathsTest.status===0?'PASS':'FAIL'});
if(result.status!==0||truthTests.status!==0||pathsTest.status!==0)process.exitCode=1;
