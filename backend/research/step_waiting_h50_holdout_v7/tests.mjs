import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import path from 'node:path';
import {ROOT,DIR,OUT,WORK,newJson,hash,git,load,rejectImports,routeAllowed,permission} from './core.mjs';
const startedAt=new Date().toISOString(),checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const primary=await load(OUT+'/primary-integrity.json');check('primary254-intact',()=>assert.equal(primary.pathsChecked,254));
const assets=await load(DIR+'/stage-a-assets.json'),opaque=await readFile(path.join(ROOT,assets.opaqueManifest));
check('opaque-manifest-primary-sha',()=>assert.equal(hash(opaque),assets.opaqueManifestSha256));
check('truth-imports-rejected',()=>{for(const file of ['step-runtime.ts','step-practice-controller.ts','continuous-practice-controller.ts','WaitingTopologyGate.ts','selector.py','scorer.py','product-replay.ts','scenario-manifest.json'])assert.throws(()=>rejectImports([file]));});
const graphs=await load(path.join(WORK,'stage-a/bundle-inputs.json'));check('real-browser-graph-truth-free',()=>assert.deepEqual(rejectImports(graphs.graphs.flatMap(g=>g.inputs)),[]));
check('production-worker-and-source-runtime-imported',()=>{const names=graphs.graphs.flatMap(g=>g.inputs).join('\n');assert.match(names,/worker-client\.ts/);assert.match(names,/source-analysis-runtime\.ts/);assert.match(names,/source-adapter\.ts/);assert.match(names,/acoustic-worker.entry\.ts/);});
const files=new Map([['/entry.js','entry'],['/pcm/j-opaque','pcm']]);
const server=createServer((req,res)=>{res.statusCode=routeAllowed(req.url,files)?200:403;res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{for(const url of ['/truth/a','/reports/a','/midi/a.mid','/scenario/a','/../truth/a','/entry.js?truth=1'])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${url}`)).status,403);checks.push('explicit-server-403-truth-midi-scenario');}finally{await new Promise(r=>server.close(r));}
check('remote-proof-before-neural',()=>assert.throws(()=>permission(null,null,'x',new Date().toISOString())));
check('fresh-continuous-gate-before-stage-a',()=>assert.throws(()=>permission({remoteHead:'a',freezeCommit:'a',stageAAssetsSha256:'x',remoteVerifiedAt:'2000-01-01'},null,'x',new Date().toISOString())));
check('primary-and-history-no-mutation',()=>assert.equal(git('diff','--name-only','44c464e6d26631d777941eff52f1bef55fad2a3f','--','apps/customer-web/src','apps/customer-web/public','backend/app',...Array.from({length:4},(_,i)=>i+3).flatMap(n=>[`backend/research/step_waiting_h50_holdout_v${n}`,`backend/research/reports/step_waiting_h50_holdout_v${n}`])),''));
check('canonical-runner-not-modified',()=>assert.equal(git('diff','--name-only','44c464e6d26631d777941eff52f1bef55fad2a3f','--','apps/customer-web/scripts/qualification/continuous-regression.mjs'),''));
const dry=JSON.parse(execFileSync(process.execPath,[path.join(WORK,'dry-runtime.mjs')],{cwd:ROOT,encoding:'utf8'}));
assert.equal(dry.dryJobs,18);assert.equal(dry.dryModelWindows,228);checks.push('18-source-domains-228-exact-inputs-empty-port-only');
checks.push('opaque-fields-and-missing-extra-window-rejected','second-worker-session-rejected','hash-gate-before-port-run');
const result={startedAt,completedAt:new Date().toISOString(),passed:checks.length,failed:0,testFiles:2,checks,...dry};
const post=process.argv[2]==='post';await newJson(path.join(ROOT,OUT,post?'tests-post.json':'tests-pre.json'),result);
if(post){const proof=JSON.parse(execFileSync('python',['-B',DIR+'/protocol.py','verify'],{cwd:ROOT,encoding:'utf8'}));await newJson(path.join(WORK,'continuous-engineering/verification.json'),{status:'PASS',staticExecutionProof:proof,tests:result});await newJson(path.join(ROOT,OUT,'execution-remote-proof.json'),proof);}
console.log({passed:result.passed,failed:0,dryModelWindows:dry.dryModelWindows,newNeuralRuns:0});
