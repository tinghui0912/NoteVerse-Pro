import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const DIR='backend/research/step_microphone_browser_v27',OUT='backend/research/reports/step_microphone_browser_v27';
export const V26='backend/research/reports/step_microphone_browser_v26',V26SRC='backend/research/step_microphone_browser_v26';
export const START='82856a1bb9e4c16d3cdbde13172952efb8d9e10e',BRANCH='codex/customer-web-delivery-boundary';
export const sha=b=>createHash('sha256').update(b).digest('hex'),bytes=p=>readFile(path.join(ROOT,p)),load=async p=>JSON.parse(await bytes(p));
export const now=()=>new Date().toISOString();
export const save=async(name,v)=>{await mkdir(path.join(ROOT,OUT),{recursive:true});await writeFile(path.join(ROOT,OUT,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});};
export const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
export const exists=p=>access(path.join(ROOT,p)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
export function scope(){
  assert.equal(git('branch','--show-current'),BRANCH);assert.equal(git('merge-base',START,'HEAD'),START);
  const files=[...new Set([...git('diff','--name-only',START).split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(files.every(p=>p.startsWith(DIR+'/')||p.startsWith(OUT+'/')),'PRODUCTION_OR_HISTORY_MUTATION');return files;
}
export function remote(clean=true){const h=git('rev-parse','HEAD');assert.equal(git('rev-parse','origin/'+BRANCH),h);
  assert.equal(git('ls-remote','origin','refs/heads/'+BRANCH).split(/\s/)[0],h);if(clean)assert.equal(git('status','--porcelain'),'');return h;}
export const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']'
  :'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
