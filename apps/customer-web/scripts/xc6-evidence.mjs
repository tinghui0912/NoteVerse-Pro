import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const APP=path.join(ROOT,'apps/customer-web');
export const WORK=path.join(ROOT,'backend/data/work/xc6_capture');
export const REPORTS=path.join(ROOT,'backend/research/reports');
export const PHASE='PHASE_9G_XC6_DISABLED_REAL_CAPTURE_AND_SOURCE_RATE_QUALIFICATION';
export const START='a6ce07d9dc95f52e72beca113f8299961c1e79a2';
export const CORE='93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical)}]`:
  `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
export const git=(...args)=>execFileSync('git',['-c','http.sslBackend=openssl',...args],{cwd:ROOT,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
export const load=async p=>JSON.parse(await readFile(p));
export async function fileId(p){const b=await readFile(p);return{path:path.relative(ROOT,p).replaceAll('\\','/'),bytes:b.length,sha256:hash(b)};}
export async function newJson(p,value){await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(await fileId(p)));}
export const freezePath=stage=>path.join(REPORTS,`phase9g_xc6_${stage}_source_freeze_2026-10-16.json`);
export async function sourceRows(){
  const rows=[];
  for(const dir of ['apps/customer-web/scripts','apps/customer-web/src/lib/practice/acoustic-inference'])
    for(const f of await readdir(path.join(ROOT,dir)))if(f.startsWith('xc6-')||f.startsWith('xc4-')||f==='bytedance-capture.worklet.js')rows.push(await fileId(path.join(ROOT,dir,f)));
  for(const f of ['apps/customer-web/scripts/xc5-smoke-entry.ts','backend/research/browser_runtime/xc1_browser_runtime_shared.mjs'])rows.push(await fileId(path.join(ROOT,f)));
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
export function checkCore(){const f=JSON.parse(git('show',`${START}:backend/research/reports/phase9g_xc4_engineering_default_freeze_2026-10-16.json`));
  if(hash(canonical(f.engineeringDefaultIdentity))!==CORE)throw new Error('COMMITTED_XC4_IDENTITY_DRIFT');return CORE;}
export async function freeze(stage){
  checkCore();if(git('status','--porcelain','--untracked-files=no'))throw new Error('COMMIT_SOURCE_FIRST');
  const f={phase:PHASE,stage,startingRemoteHead:START,implementationCommit:git('rev-parse','HEAD'),xc4CoreIdentitySha256:CORE,
    sources:await sourceRows(),createdAt:new Date().toISOString(),productionMicrophone:false,
    plan:stage==='diagnostics'?'Reproduce unchanged XC5 single synthetic smoke with CDP/Playwright full attribution; exactly4 model runs, no score/MIDI.':
      'Capture metadata first; conditional source-rate adapter only after observed48k; no model/threshold/geometry/finalizer changes.',
    xc5CaveatPreserved:'XC5 artifact preceded smoke but its Git freeze commit followed smoke; do not rewrite history.'};
  f.freezeCanonicalSha256=hash(canonical(f));await newJson(freezePath(stage),f);
}
export async function requireRemoteFreeze(stage){
  const f=await load(freezePath(stage)),{freezeCanonicalSha256,...body}=f;
  if(hash(canonical(body))!==freezeCanonicalSha256||canonical(await sourceRows())!==canonical(f.sources))throw new Error('XC6_FROZEN_SOURCE_DRIFT');
  const commit=git('log','-1','--format=%H','--',path.relative(ROOT,freezePath(stage)));
  if(commit!==git('rev-parse','HEAD')||git('status','--porcelain','--untracked-files=no'))throw new Error('RUN_FROM_CLEAN_FREEZE_COMMIT');
  const remote=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s+/)[0];
  if(remote!==commit)throw new Error('REMOTE_FREEZE_NOT_VERIFIED_STOP');
  return{phase:PHASE,stage,freezeCommit:commit,freezeCanonicalSha256,remoteHead:remote,remoteVerifiedAt:new Date().toISOString(),sourceHashesVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,stage]=process.argv.slice(2);if(command==='freeze')await freeze(stage);else throw new Error('XC6_COMMAND');
}
