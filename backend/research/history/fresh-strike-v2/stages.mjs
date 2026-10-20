import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,WORK,verify,json} from './protocol.mjs';
const stage=process.argv[2];
if(!['baseline','scoring'].includes(stage))throw Error('UNKNOWN_STAGE');
const proof=await verify();
await json(path.join(WORK,`development/${stage}ExecutionProof.json`),proof);
execFileSync('docker',['run','--rm','--mount',`type=bind,source=${ROOT},target=/workspace`,'-w','/workspace','--entrypoint','python',
  'noteverse-xc1-r3d-science:local',`backend/research/fresh_strike/${stage}.py`],{stdio:'inherit'});
