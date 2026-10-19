import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const ROOT=path.resolve(import.meta.dirname,'../../..');
export const DIR='backend/research/step_acoustic_assembler_v24';
export const OUT='backend/research/reports/step_acoustic_assembler_v24';
export const WORK='backend/data/work/step_acoustic_assembler_v24';
export const START='d60605ea96285e5dba85a0cb98a01dd8613f67ad';
export const BRANCH='codex/customer-web-delivery-boundary';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const now=()=>new Date().toISOString();
export const bytes=p=>readFile(path.join(ROOT,p));
export const load=async p=>JSON.parse(await bytes(p));
export async function save(p,value){
  if(!p.startsWith(OUT+'/'))throw Error('WRITE_OUTSIDE_V24_REPORTS');
  await mkdir(path.dirname(path.join(ROOT,p)),{recursive:true});
  await writeFile(path.join(ROOT,p),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
export const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024}).trim();
export const zero=Object.freeze({newNeuralRuns:0,modelSessionLoads:0,modelRuns:0,AcousticModelWorkerRuns:0,
  decoderRuns:0,decoderARuns:0,decoderBRuns:0,decoderCRuns:0,PCMDecodeRuns:0,freshHoldoutAccess:0,ContinuousAcousticRuns:0});
