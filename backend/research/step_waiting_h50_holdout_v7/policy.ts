export type Job={jobId:string;sourceDomainId:string;sourceRateHz:number;pcmPath:string;pcmSha256:string;frames:number;
  sourceOriginSample:number;regionStartSourceSample:number;expectedModelInputs:{windowIndex:number;start:number;end:number;sha256:string}[]};
const jobFields=['jobId','sourceDomainId','sourceRateHz','pcmPath','pcmSha256','frames','sourceOriginSample','regionStartSourceSample','expectedModelInputs'];
export function assertJobs(value:{schema:string;jobs:Job[]}):void {
  if(value.schema!=='AUDIO_ONLY_OPAQUE_JOBS_NO_TRUTH_NO_TARGET_NO_FAMILY'||value.jobs.length!==18)throw Error('OPAQUE_MANIFEST_SCHEMA');
  const ids=new Set();let windows=0;
  for(const job of value.jobs){
    if(Object.keys(job).sort().join()!==[...jobFields].sort().join()||!/^j-[a-f0-9]{24}$/.test(job.jobId)||ids.has(job.jobId))throw Error('NON_OPAQUE_JOB');
    ids.add(job.jobId);
    if(job.sourceDomainId!==job.jobId||![44100,48000].includes(job.sourceRateHz)||!Number.isSafeInteger(job.frames)||job.frames<=0
      ||!Number.isSafeInteger(job.sourceOriginSample)||job.regionStartSourceSample!==job.sourceOriginSample+job.sourceRateHz*1.2
      ||job.pcmPath!==`backend/data/work/step_waiting_h50_holdout_v6/audio_only/${job.jobId}.f32`)throw Error('FROZEN_SOURCE_COORDINATES');
    for(const [index,w] of job.expectedModelInputs.entries())if(Object.keys(w).sort().join()!==['windowIndex','start','end','sha256'].sort().join()
      ||w.windowIndex!==index||w.end-w.start!==29120||!Number.isInteger(w.start)||!Number.isInteger(w.end)||!/^[a-f0-9]{64}$/.test(w.sha256))throw Error('FROZEN_WINDOW_SCHEMA');
    windows+=job.expectedModelInputs.length;
  }
  if(windows!==228)throw Error('FROZEN_WINDOW_COUNT');
}
export async function sha(bytes:ArrayBufferView):Promise<string>{
  const copy=new Uint8Array(bytes.byteLength);copy.set(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',copy))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function gateInput(job:Job,index:number,input:{window:{windowIndex:number;startSample:number;endSample:number};pcm:Float32Array}){
  const expected=job.expectedModelInputs[index];
  if(!expected||input.pcm.length!==29120||input.window.windowIndex!==expected.windowIndex||input.window.startSample!==expected.start||input.window.endSample!==expected.end)throw Error('H50_STAGE_A_FROZEN_MODEL_INPUT_MISMATCH');
  const actual=await sha(input.pcm);
  if(actual!==expected.sha256)throw Error('H50_STAGE_A_FROZEN_MODEL_INPUT_MISMATCH');
  return {windowIndex:expected.windowIndex,start:expected.start,end:expected.end,samples:29120,actualSha256:actual,expectedSha256:expected.sha256};
}
export function assertComplete(job:Job,completed:number){if(completed!==job.expectedModelInputs.length)throw Error('MISSING_MODEL_WINDOW');}
export class RunOwnership {
  workers=0;sessions=0;attempted=0;completed=0;
  worker(){if(++this.workers!==1)throw Error('SECOND_WORKER');}
  session(){if(++this.sessions!==1)throw Error('SECOND_MODEL_SESSION');}
  begin(){if(this.attempted!==this.completed)throw Error('UNRESOLVED_WORKER_RUN');return this.attempted++;}
  finish(count:number){if(count!==this.attempted||count!==this.completed+1)throw Error('MODEL_RUN_ACCOUNTING_DRIFT');this.completed=count;}
}
