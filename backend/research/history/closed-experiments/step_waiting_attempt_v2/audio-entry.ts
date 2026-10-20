import {AcousticModelWorker} from '../../../apps/customer-web/src/lib/practice/acoustic/model/worker-client';
import {SourceAnalysisRuntime} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime';
import {sha256} from '../../../apps/customer-web/src/lib/practice/acoustic/model/model-contract';
import {WaitingAcousticAssembly,type SourceDecodedPublication} from './waiting-assembly';
import {SharedWorkerJobs} from './shared-worker-jobs';

type AudioJob={id:string;rate:number;sha256:string;bytes:number;sourceOriginSample:number;regionStartSourceSample:number;
  regionEndSourceSample:number;semanticEndSourceSample:number};
declare global{interface Window{runWaitingAudioOnly(jobs:readonly AudioJob[]):Promise<unknown>}}
window.runWaitingAudioOnly=async jobs=>{
  const worker=new AcousticModelWorker(new Worker('/worker.js',{type:'module'}));
  const model=await worker.load('/model.onnx'),sharedJobs=new SharedWorkerJobs(worker);let actualModelRuns=0,leaseReleases=0;
  const results=[];
  try{
    for(const job of jobs){
      const bytes=new Uint8Array(await(await fetch(`/pcm/${job.id}/${job.rate}`)).arrayBuffer());
      if(bytes.length!==job.bytes||await sha256(bytes)!==job.sha256)throw Error('PCM_IDENTITY');
      const samples=new Float32Array(bytes.buffer),coefficientBytes=new Uint8Array(await(await fetch(`/fir/${job.rate}`)).arrayBuffer());
      const domainId=`${job.id}:${job.rate}`;
      const assembly=new WaitingAcousticAssembly(job.rate,domainId,job.regionStartSourceSample,job.semanticEndSourceSample);
      const publications:SourceDecodedPublication[]=[],attempts=[],receipts=[];
      let next=job.sourceOriginSample,available=next/job.rate*1000;
      const runtime=await SourceAnalysisRuntime.create({sourceDomainId:domainId,sourceSampleRateHz:job.rate,coefficientBytes,
        worker:{run:async input=>{const started=performance.now();const result=await sharedJobs.run(input);
          actualModelRuns=result.actualSessionRunCount;available+=performance.now()-started;return result;},
          // The single run-level model owner lends its inference port to one source session at a time.
          dispose:async()=>{leaseReleases++;}},
        nowAvailabilityMs:()=>available,onPublication:source=>{
          const ownedEndMs=(job.sourceOriginSample+source.window.ownedEndTarget*job.rate/16000)/job.rate*1000;
          const p:SourceDecodedPublication={publicationId:`${domainId}:w${source.window.windowIndex}`,
            analyzedThroughSourceSample:job.sourceOriginSample+source.window.ownedEndTarget*job.rate/16000,
            // Source-domain coverage is the exclusive owned end; this is not a Continuous product publication.
            frontierMs:ownedEndMs,availabilityMs:source.availabilityTimeMs,
            observations:source.observations.map(o=>({observationId:o.observationId,pitch:o.pitch,
              eventMs:o.sourceEventSample/job.rate*1000,availabilityMs:source.availabilityTimeMs,confidence:o.confidence,
              sourceDomainId:o.sourceDomainId,sourceSampleRateHz:o.sourceSampleRateHz,sourceEventSample:o.sourceEventSample}))};
          publications.push(p);const update=assembly.push(p);
          if(update.sealed)attempts.push(Object.freeze({...update.sealed,rearm:assembly.commit(p.availabilityMs)}));
          receipts.push({publicationId:p.publicationId,window:source.window,ownedEndMs,opened:update.opened,sealed:update.sealed?.candidateId??null,assembly:assembly.snapshot()});
        }});
      const through=async(end:number)=>{while(next<end){const stop=Math.min(end,next+1024),offset=next-job.sourceOriginSample;
        available=Math.max(available,stop/job.rate*1000);
        runtime.append({sourceSampleRateHz:job.rate,sourceStartSampleIndex:next,sourceEndSampleIndex:stop,samples:samples.subarray(offset,offset+stop-next)});
        next=stop;await runtime.drain();}};
      try{
        await through(job.regionStartSourceSample);runtime.beginAnalysisRegion(next);
        await through(job.regionEndSourceSample);runtime.endAnalysisRegion(next);runtime.finishRegions();
        await through(job.sourceOriginSample+samples.length);await runtime.seal();
        const snapshot=runtime.snapshot();
        if(snapshot.counts.regionsStarted!==1||snapshot.counts.regionsDrained!==1||snapshot.outstanding!==0)throw Error('SOURCE_REGION_LIFECYCLE');
        results.push({id:job.id,rate:job.rate,publications,attempts,receipts,snapshot,assembly:assembly.snapshot(),sourceGap:0});
      }finally{await runtime.dispose();}
    }
    return {status:'SEALED_AUDIO_ONLY',model,actualModelRuns,submittedJobs:sharedJobs.submittedJobs,workerConstructions:1,modelSessionLoads:1,leaseReleases,results,
      scheduling:'One continuous source region per independent source session, never per semantic attempt; one sequential shared production Worker/model for this complete browser run.'};
  }catch(error){throw Error(JSON.stringify({error:String(error),actualModelRuns,leaseReleases}));}
  finally{await worker.dispose();}
};
