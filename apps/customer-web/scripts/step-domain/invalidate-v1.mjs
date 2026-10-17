import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,newJson,hash} from '../audio-context-clock/protocol.mjs';
const freeze='backend/research/reports/step_domain_freeze_step_domain_v1_2026-10-17.json';
const verification=JSON.parse(await readFile(path.join(ROOT,'backend/data/work/step_domain/step_domain_v1/controller/verification.json'),'utf8'));
await newJson(path.join(ROOT,'backend/research/reports/step_domain_invalid_static_v1_2026-10-17.json'),verification);
await newJson(path.join(ROOT,'backend/research/reports/step_domain_invalidation_v1_2026-10-17.json'),{
 invalidatedFreeze:'f9646e13da1892731e13c15794b9c5bdde7ed788',freezeSha256:hash(await readFile(path.join(ROOT,freeze))),
 invalidatedAt:new Date().toISOString(),reason:'Full ESLint found synchronous effect presentation reset and an unused migrated test helper.',
 changes:'Bind presentation state to option identity instead of synchronous effect reset; remove unused helper. No domain/acoustic policy change.',
 acceptanceEvidence:false,browserExecutionStarted:false,actualNeuralModelRuns:0,
 requirements:'New implementation/tooling commit, new remote freeze, full rerun. Prior static PASS results are not inherited.'});
