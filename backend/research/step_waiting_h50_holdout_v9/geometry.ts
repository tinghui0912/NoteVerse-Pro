import {QualifiedSourceAdapter} from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter';
import {planWindow,type AnalysisRegion} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner';

export type Job={jobId:string;sourceDomainId:string;sourceRateHz:number;sourceOriginSample:number;regionStartSourceSample:number;frames:number;
  expectedModelInputs:{windowIndex:number;start:number;end:number;sha256:string}[]};
export async function reconstruct(job:Job,fir:Uint8Array,value=0){
  const adapter=await QualifiedSourceAdapter.create(job.sourceRateHz,fir);
  let next=job.sourceOriginSample,targetFrames=0,region:AnalysisRegion|null=null;
  const blocks:{start:number;end:number;targetFrames:number}[]=[],windows:any[]=[];
  const final=job.expectedModelInputs.at(-1)!;
  const regionEnd=job.sourceOriginSample+Math.round((final.end-2720)*job.sourceRateHz/16000);
  const plan=()=>{if(!region)return;while(true){
    const window=planWindow(region,windows.length);if(!window||window.endSample>targetFrames)break;
    const expected=job.expectedModelInputs[windows.length];
    if(!expected||window.windowIndex!==expected.windowIndex||window.startSample!==expected.start||window.endSample!==expected.end)throw Error('GEOMETRY_FROZEN_WINDOW_DRIFT');
    const prior=blocks.at(-2)?.targetFrames??0;
    if(prior>=window.endSample&&region.endTarget===undefined)throw Error('CAPTURE_ENDPOINT_NOT_FIRST_ELIGIBLE');
    windows.push({window,capturedThroughSourceSample:next,previousBlockTargetFrames:prior,producedTargetFrames:targetFrames,
      captureEndpointUnique:true,sourceEventClock:'ORIGINAL_SOURCE_SAMPLES'});
    region.nextWindow++;region.queuedEndTarget=window.ownedEndTarget;
  }};
  const through=(end:number)=>{while(next<end){const start=next;next=Math.min(next+2048,end);
    targetFrames+=adapter.push(new Float32Array(next-start).fill(value)).length;
    blocks.push({start,end:next,targetFrames});plan();
  }};
  through(job.regionStartSourceSample);
  region={index:0,sourceStart:next,originTarget:(next-job.sourceOriginSample)*16000/job.sourceRateHz,nextWindow:0,queuedEndTarget:0};
  plan();through(regionEnd);
  region.sourceEnd=next;region.endTarget=region.originTarget+(next-region.sourceStart)*16000/job.sourceRateHz;
  plan();through(job.sourceOriginSample+job.frames);
  if(windows.length!==job.expectedModelInputs.length)throw Error('CAPTURE_GEOMETRY_INCOMPLETE');
  return {jobId:job.jobId,sourceRateHz:job.sourceRateHz,sourceOriginSample:job.sourceOriginSample,
    sourceEndSample:next,regionStart:job.regionStartSourceSample,regionEnd,blocks,windows,
    firstAuthoritativeBlockEnd:blocks[0].end,acousticPrerollReadySourceSample:job.regionStartSourceSample,
    firstCompleteOwnedIntervalAnalyzedAt:windows[0].capturedThroughSourceSample,
    adapterIdentity:adapter.identitySha256,geometryOnly:true,selectedPcmRead:false,neuralRuns:0};
}

export function selectLateWindow(windows:any[],secondPhysicalSourceSample:number,origin:number,rate:number){
  const target=(secondPhysicalSourceSample-origin)*16000/rate;
  const matches=windows.filter(r=>r.window.ownedStartTarget<=target&&target<r.window.ownedEndTarget);
  if(matches.length!==1)throw Error('STAGE_B_LATE_PUBLICATION_FAULT_SCRIPT_NOT_ESTABLISHED');
  return matches[0].window.windowIndex;
}
