import {SourceAnalysisRuntime} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime';
import type {AcousticInferencePort} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/inference-types';
import {assertComplete,gateInput,sha,type Job} from './policy';

/** A borrowed port has no session disposal authority; the sole run owner does. */
export async function executeSource(job:Job,source:Float32Array,coefficients:Uint8Array,port:AcousticInferencePort,
  onWindow:(value:unknown)=>void,onPublication:(value:unknown)=>void){
  if(source.length!==job.frames||await sha(source)!==job.pcmSha256)throw Error('FROZEN_SOURCE_PCM_MISMATCH');
  const inputs:unknown[]=[],publications:unknown[]=[];let next=job.sourceOriginSample,index=0;
  const runtime=await SourceAnalysisRuntime.create({sourceDomainId:job.sourceDomainId,sourceSampleRateHz:job.sourceRateHz,coefficientBytes:coefficients,
    worker:{run:async input=>{
      const record={...await gateInput(job,index,input),runtimeWindow:input.window,
        sourceOriginSample:job.sourceOriginSample,sourceInputStart:job.sourceOriginSample+input.window.startSample*job.sourceRateHz/16000,
        sourceInputEnd:job.sourceOriginSample+input.window.endSample*job.sourceRateHz/16000,gatePassedAt:performance.now()};
      inputs.push(record);onWindow(record);
      // No Worker call is reachable before exact frozen-input verification.
      const result=await port.run(input);index++;return result;
    },dispose:async()=>{},onFailure:port.onFailure?.bind(port)},
    nowAvailabilityMs:()=>performance.now(),onPublication:p=>{publications.push(p);onPublication(p);}});
  const through=async(end:number)=>{while(next<end){const stop=Math.min(next+2048,end);
    runtime.append({sourceSampleRateHz:job.sourceRateHz,sourceStartSampleIndex:next,sourceEndSampleIndex:stop,
      samples:source.slice(next-job.sourceOriginSample,stop-job.sourceOriginSample)});next=stop;await runtime.drain();}};
  const last=job.expectedModelInputs.at(-1)!;
  // Invert the frozen final input boundary into an integer source region endpoint.
  // Product planWindow still owns rounding/geometry; the SHA gate proves identity.
  const regionEnd=job.sourceOriginSample+Math.round((last.end-2720)*job.sourceRateHz/16000);
  try{
    await through(job.regionStartSourceSample);runtime.beginAnalysisRegion(next);
    await through(regionEnd);runtime.endAnalysisRegion(next);runtime.finishRegions();
    await through(job.sourceOriginSample+source.length);await runtime.seal();assertComplete(job,index);
    const snapshot=runtime.snapshot();
    if(snapshot.outstanding||snapshot.counts.windowsStarted!==index||snapshot.counts.windowsPublished!==index||snapshot.counts.regionsStarted!==1)throw Error('SOURCE_RUNTIME_ACCOUNTING_DRIFT');
    return {jobId:job.jobId,sourceDomainId:job.sourceDomainId,sourceRateHz:job.sourceRateHz,sourceOriginSample:job.sourceOriginSample,
      regionStartSourceSample:job.regionStartSourceSample,regionEndSourceSample:regionEnd,inputs,publications,snapshot,windowsCompleted:index,status:'PASS'};
  }finally{await runtime.dispose();}
}
