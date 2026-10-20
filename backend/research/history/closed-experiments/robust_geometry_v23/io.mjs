import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const ROOT=path.resolve(import.meta.dirname,'../../..');
export const DIR='backend/research/robust_geometry_v23';
export const OUT='backend/research/reports/robust_geometry_v23';
export const WORK='backend/data/work/robust_geometry_v23';
export const START='160d7b3a0e315bc99b8a31d0d41e09c11c776c7f';
export const BRANCH='codex/customer-web-delivery-boundary';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const now=()=>new Date().toISOString();
export const bytes=p=>readFile(path.join(ROOT,p));
export const load=async p=>JSON.parse(await bytes(p));
export async function save(p,value){
  if(!p.startsWith(OUT+'/')&&!p.startsWith(WORK+'/')&&!p.startsWith(DIR+'/'))throw Error('WRITE_SCOPE');
  await mkdir(path.dirname(path.join(ROOT,p)),{recursive:true});
  await writeFile(path.join(ROOT,p),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
export const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
export const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']'
  :'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export const corpusIdentity=windows=>hash(canonical(windows.map(w=>({jobId:w.jobId,runOrdinal:w.runOrdinal,
  runtimeWindow:w.runtimeWindow,inputSha256:w.inputSha256,onsetSha256:w.onsetSha256,frameSha256:w.frameSha256,pairSha256:w.pairSha256}))));
