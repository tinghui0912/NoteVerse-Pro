// Evidence/Git closure only. Does not import the failed freeze generator or any browser/acoustic executor.
import assert from 'node:assert/strict';
import { readFile,writeFile,access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const OUT='backend/research/reports/step_microphone_browser_v26',DIR='backend/research/step_microphone_browser_v26';
const START='3757d8c38d0ee750a2330fc15550151258e2e517',BRANCH='codex/customer-web-delivery-boundary';
const hash=b=>createHash('sha256').update(b).digest('hex'),bytes=p=>readFile(path.join(ROOT,p)),load=async p=>JSON.parse(await bytes(p));
const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const save=(name,v)=>writeFile(path.join(ROOT,OUT,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
async function audit(){
  assert.equal(git('branch','--show-current'),BRANCH);assert.equal(git('merge-base',START,'HEAD'),START);
  const files=[...new Set([...git('diff','--name-only',START).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(files.every(p=>p.startsWith(DIR+'/')||p.startsWith(OUT+'/')),'PRODUCTION_OR_HISTORY_CHANGE');
  const history=await load(OUT+'/historical-identities.json');
  for(const f of history.files)assert.equal(hash(await bytes(f.path)),f.sha256,'HISTORY_MUTATION:'+f.path);
  for(const p of ['browser-protocol-freeze.json','remote-browser-freeze-proof.json','browser-campaign-started.json','browser-campaign.json']){
    assert.equal(await access(path.join(ROOT,OUT,p)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false,'EXECUTION_NOT_AUTHORIZED');
  }
  const identities=[];for(const p of files)identities.push({path:p,sha256:hash(await bytes(p))});
  return {startingHead:START,checkedAt:new Date().toISOString(),historicalRawFilesVerified:history.files.length,
    V3ThroughV25Diff:[],productionDiff:[],files,identities,freeze:'NOT_CREATED',browserExecution:'NOT_STARTED',
    disposition:'STEP_V26_BROWSER_EXECUTION_INTEGRITY_BLOCKED'};
}
if(process.argv[2]==='audit'){
  const r=await audit();await save('blocked-integrity-audit.json',r);console.log(JSON.stringify({historyFiles:r.historicalRawFilesVerified,productionDiff:[],disposition:r.disposition}));
}else if(process.argv[2]==='receipt'){
  const r=await audit(),head=git('rev-parse','HEAD');assert.equal(git('status','--porcelain'),'');assert.equal(git('rev-parse','origin/'+BRANCH),head);
  assert.equal(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s/)[0],head);
  for(const f of r.identities)assert.equal(hash(execFileSync('git',['show',head+':'+f.path],{cwd:ROOT,maxBuffer:64*1024*1024})),f.sha256);
  const github=JSON.parse(execFileSync('python',['-c',"import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))",head],{cwd:ROOT,encoding:'utf8'}));
  await save('remote-result-proof.json',{...r,resultCommit:head,remoteHead:head,completeCommitChain:git('log','--reverse','--format=%H %s',START+'..HEAD').split('\n'),
    github,cleanWorktree:true,receiptCommitNote:'Additive receipt committed afterwards; final HEAD independently refetched and queried'});
  console.log(JSON.stringify({head,github}));
}else if(process.argv[2]==='verify'){const r=await audit();console.log(JSON.stringify({historicalFiles:r.historicalRawFilesVerified,productionDiff:[],browser:'NOT_STARTED',disposition:r.disposition}));}
else throw Error('Evidence audit/receipt/verify only; no freeze repair or browser execution');
