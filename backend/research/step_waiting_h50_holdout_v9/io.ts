import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const ROOT=process.cwd();
export const DIR='backend/research/step_waiting_h50_holdout_v9';
export const OUT='backend/research/reports/step_waiting_h50_holdout_v9';
export const WORK='backend/data/work/step_waiting_h50_holdout_v9';
export const V6='backend/research/reports/step_waiting_h50_holdout_v6';
export const ACOUSTIC='backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic.json';
export const ACOUSTIC_SHA='61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1';
export const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
export const raw=(p:string)=>readFile(path.join(ROOT,p));
export async function load(p:string){if(p===ACOUSTIC)throw Error('USE_PAYLOAD_GATE');return JSON.parse((await raw(p)).toString());}
export async function save(p:string,v:unknown){await mkdir(path.dirname(path.join(ROOT,p)),{recursive:true});await writeFile(path.join(ROOT,p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});}
export async function payload(){
  const proof=await load(OUT+'/evaluation-remote-proof.json');
  const freeze=await load(OUT+'/evaluation-protocol-freeze.json');
  if(proof.freezeSha256!==freeze.freezeCanonicalSha256||proof.remoteHead!==proof.freezeCommit)throw Error('PROSPECTIVE_REMOTE_PROOF_REQUIRED');
  if(hash(await raw(OUT+'/evaluation-protocol-freeze.json'))!==proof.freezeFileSha256)throw Error('REMOTE_FREEZE_BYTES_CHANGED');
  for(const row of freeze.files)if(hash(await raw(row.path))!==row.sha256)throw Error('FROZEN_EVALUATOR_OR_INPUT_CHANGED:'+row.path);
  const b=await raw(ACOUSTIC);if(hash(b)!==ACOUSTIC_SHA)throw Error('ACOUSTIC_SEAL_INTEGRITY_FAILURE');
  const openedAt=new Date().toISOString();if(!(proof.evaluationRemoteVerifiedAt<openedAt))throw Error('PAYLOAD_OPEN_ORDER_INVALID');
  await save(OUT+'/acoustic-payload-opening.json',{acousticPayloadOpenedAt:openedAt,evaluationRemoteVerifiedAt:proof.evaluationRemoteVerifiedAt,
    prospectiveOrder:true,newNeuralRuns:0,acousticOutputSha256:ACOUSTIC_SHA});
  return JSON.parse(b.toString());
}
