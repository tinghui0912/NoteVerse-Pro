import {AcousticModelWorker} from '../../../apps/customer-web/src/lib/practice/acoustic/model/worker-client';
import {SourceAnalysisRuntime} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime';
import {sha256} from '../../../apps/customer-web/src/lib/practice/acoustic/model/model-contract';
import {SharedWorkerJobs} from '../step_waiting_attempt_v2/shared-worker-jobs';
import {WaitingTopologyGate,sourceReceipt,type Receipt} from './assembly';
export type AudioJob={id:string;rate:number;bytes:number;sha256:string;sourceOriginSample:number;regionStartSourceSample:number;
  regionEndSourceSample:number;armSourceSample:number;semanticEndSourceSample:number;analysisHoldSamples:number;resetHoldSamples:number;delayPublicationIndex:number};
declare global{interface Window{runWaitingTopology(jobs:readonly AudioJob[]):Promise<unknown>}}
window.runWaitingTopology=async jobs=>{
 const worker=new AcousticModelWorker(new Worker('/worker.js',{type:'module'}));
 let runs=0;const results=[];
 try{
  const model=await worker.load('/model.onnx'),sequence=new SharedWorkerJobs(worker);
  for(const job of jobs){
   const bytes=new Uint8Array(await(await fetch(`/pcm/${job.id}/${job.rate}`)).arrayBuffer());
   if(bytes.length!==job.bytes||await sha256(bytes)!==job.sha256)throw Error('PCM_IDENTITY');
   const pcm=new Float32Array(bytes.buffer),coefficientBytes=new Uint8Array(await(await fetch(`/fir/${job.rate}`)).arrayBuffer());
   const domain=`${job.id}:${job.rate}`,gate=new WaitingTopologyGate(job.rate,domain,job.sourceOriginSample,job.semanticEndSourceSample,job.analysisHoldSamples,job.resetHoldSamples);
   const publications:Receipt[]=[];
   const trace: [number,number,string][]=[];let next=job.sourceOriginSample,warm:{wallMs:number;sourceFrontier:number;capturedThrough:number}|null=null,delayed:Receipt|null=null;
   const flush=()=>{if(delayed&&gate.state==='READY'){gate.accept({...delayed,capturedThrough:next,wallMs:performance.now(),late:true});delayed=null;}};
   // Independent source sessions borrow the run-level Worker; only the outer finally owns ONNX disposal.
   const runtime=await SourceAnalysisRuntime.create({sourceDomainId:domain,sourceSampleRateHz:job.rate,coefficientBytes,
    worker:{run:async input=>{const result=await sequence.run(input);runs=result.actualSessionRunCount;return result;},dispose:async()=>{}},
    nowAvailabilityMs:()=>performance.now(),onPublication:source=>{
     const p=sourceReceipt(source,job.sourceOriginSample,job.rate,next,source.availabilityTimeMs);publications.push(p);
     if(source.window.windowIndex===0)warm={wallMs:p.wallMs,sourceFrontier:p.frontier,capturedThrough:next};
     if(source.window.windowIndex===job.delayPublicationIndex){if(delayed)throw Error('FAULT_SCRIPT_QUEUE_LIMIT');delayed=p;}
     else gate.accept(p);
     flush();
    }});
   const through=async(target:number)=>{while(next<target){
    const start=next,stop=Math.min(target,next+128,gate.nextBoundary),state=gate.state;
    if(stop<=next)throw Error('NONPROGRESSING_CAPTURE_SCRIPT');
    next=stop;const wall=performance.now();trace.push([stop,wall,state]);gate.captureThrough(stop,wall);flush();
    runtime.append({sourceSampleRateHz:job.rate,sourceStartSampleIndex:start,sourceEndSampleIndex:stop,
     samples:pcm.subarray(start-job.sourceOriginSample,stop-job.sourceOriginSample)});
    await runtime.drain();
   }};
   try{
    await through(job.regionStartSourceSample);runtime.beginAnalysisRegion(next);
    // Physical future input is not supplied until startup completion and actual semantic arming.
    await through(job.armSourceSample);await runtime.drain();
    if(!warm||(warm as {sourceFrontier:number}).sourceFrontier<job.regionStartSourceSample+job.rate*600/1000)throw Error('WARM_COVERAGE_NOT_READY');
    const readyWallMs=performance.now();gate.arm(next,readyWallMs);
    await through(job.regionEndSourceSample);runtime.endAnalysisRegion(next);runtime.finishRegions();
    await through(job.sourceOriginSample+pcm.length);await runtime.seal();flush();
    const snapshot=runtime.snapshot();if(snapshot.outstanding||snapshot.counts.regionsStarted!==1||snapshot.counts.regionsDrained!==1||delayed)throw Error('SOURCE_SESSION_NOT_DRAINED');
    if(gate.state==='ANALYZING'||gate.state==='RESET'||gate.state==='CAPTURING')throw Error('SEMANTIC_SLOT_NOT_DRAINED');
    results.push({id:job.id,rate:job.rate,modelRuns:snapshot.counts.windowsStarted,publications,actions:gate.actions,receipts:gate.receipts,
     sourceOriginSample:job.sourceOriginSample,captureTrace:trace,warm,ready:{sourceSample:job.armSourceSample,armSourceSample:job.armSourceSample,wallMs:readyWallMs},
     gate:gate.snapshot(),snapshot,chronology:{gap:0,overlap:0},scheduling:'Causal backpressured source replay. Real prefix PCM is supplied before arming; future user PCM only afterward. Source and wall domains remain distinct; not a hardware/UX latency trial.'});
   }finally{await runtime.dispose();}
  }
  return {status:'SEALED_AUDIO_ONLY',model,actualModelRuns:runs,workerConstructions:1,modelSessionLoads:1,results};
 }catch(error){throw Error(JSON.stringify({error:String(error),actualModelRuns:runs}));}
 finally{await worker.dispose();}
};
