import {AcousticModelWorker} from '../../../apps/customer-web/src/lib/practice/acoustic/model/worker-client';
import {executeSource} from './source-execution';
import {assertJobs,RunOwnership,type Job} from './policy';
declare global{interface Window {runBlindStageA:(value:{schema:string;jobs:Job[]})=>Promise<unknown>;stageATrace:unknown}}
window.runBlindStageA=async manifest=>{
  assertJobs(manifest);
  const ownership=new RunOwnership(),results:unknown[]=[],windows:unknown[]=[],publications:unknown[]=[],transactions:unknown[]=[];
  let failedJob:string|null=null,failedWindow:unknown=null,failure:string|null=null,model:any=null;
  let worker:AcousticModelWorker|null=null;const startedAt=new Date().toISOString();
  const trace=()=>({startedAt,completedAt:new Date().toISOString(),results,windows,publications,transactions,failedJob,failedWindow,failure,model,
    actualModelRuns:ownership.completed,modelRunCountComplete:ownership.attempted===ownership.completed,
    attemptedRuns:ownership.attempted,workerConstructions:ownership.workers,modelSessionLoads:ownership.sessions,
    unresolvedRuns:ownership.attempted-ownership.completed,status:failure?'BLOCKED_AUDIO_OUTPUT_SEALED':'ACOUSTIC_OUTPUT_SEALED'});
  window.stageATrace=trace();
  try{
    ownership.worker();const native=new Worker('/worker.js',{type:'module'});
    native.addEventListener('message',e=>transactions.push({direction:'response',id:e.data.id,error:e.data.error??null,
      actualSessionRunCount:e.data.result?.actualSessionRunCount??null,availableAt:performance.now()}));
    worker=new AcousticModelWorker(native);transactions.push({direction:'request',type:'LOAD',at:performance.now()});
    model=await worker.load('/model.onnx');ownership.session();
    if(model.actualSessionLoadCount!==1||model.ortWebVersion!=='1.20.1'||model.executionProvider!=='webgpu'||model.automaticFallback!==false
      ||model.modelSha256!=='4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3')throw Error('FROZEN_MODEL_IDENTITY');
    for(const job of manifest.jobs){failedJob=job.jobId;failedWindow=null;
      const source=new Float32Array(await(await fetch('/pcm/'+job.jobId)).arrayBuffer());
      const coefficients=new Uint8Array(await(await fetch('/fir-'+job.sourceRateHz+'.f32')).arrayBuffer());
      const borrowed={run:async(input:any)=>{
        const transactionIndex=ownership.begin();
        const workerWindow={...input.window,jobIndex:transactionIndex};
        transactions.push({direction:'request',type:'INFER',transactionIndex,runtimeWindow:input.window,workerWindow,at:performance.now()});
        // Only the protocol transaction index is global; source/window/event coordinates are unchanged.
        const result=await worker!.run({window:workerWindow,pcm:input.pcm});ownership.finish(result.actualSessionRunCount);return result;
      },dispose:async()=>{},onFailure:(listener:(error:Error)=>void)=>worker!.onFailure(listener)};
      const result=await executeSource(job,source,coefficients,borrowed,v=>{failedWindow=v;windows.push({jobId:job.jobId,...v as object});},
        v=>{publications.push(v);window.stageATrace=trace();});
      results.push(result);window.stageATrace=trace();
    }
    if(results.length!==18||ownership.completed!==228||ownership.attempted!==228)throw Error('FROZEN_WORKLOAD_DRIFT');
    failedJob=null;failedWindow=null;
  }catch(error){failure=String((error as Error).stack??error);}
  finally{try{await worker?.dispose();}catch(error){failure??=String(error);}window.stageATrace=trace();}
  return window.stageATrace;
};
