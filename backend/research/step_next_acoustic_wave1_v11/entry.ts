import {executeSource} from '../step_waiting_h50_holdout_v7/source-execution';
import {decodeRobustPiano} from '../../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder';
const sha=async(v:ArrayBufferView)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength))))].map(n=>n.toString(16).padStart(2,'0')).join('');
const pitch=(n:number)=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+(Math.floor(n/12)-1);
const project=(job:any,window:any,events:any[],available:number,isB=false)=>({sourceDomainId:job.sourceDomainId,sourceSampleRateHz:job.sourceRateHz,window,availabilityTimeMs:available,
 observations:events.map(e=>{const target=isB?e.performanceTimeMs*16:e.targetSample;return {target,e};}).filter(({target})=>target>=window.ownedStartTarget&&target<window.ownedEndTarget).map(({target,e})=>({
  observationId:`${job.sourceDomainId}:r0:w${window.windowIndex}:p${isB?e.pitch:e.midiPitch}:f${target}`,
  pitch:isB?pitch(e.pitch):e.pitch,midiPitch:isB?e.pitch:e.midiPitch,confidence:e.confidence,sourceDomainId:job.sourceDomainId,
  sourceSampleRateHz:job.sourceRateHz,sourceEventSample:(job.sourceOriginSample*16000+target*job.sourceRateHz)/16000,targetSample:target}))});
declare global {interface Window {runWave1:(config:any)=>Promise<any>;waveTrace:any}}
window.runWave1=async config=>{
 let count=0,sequence=0,loads=0,failedJob=null;const requests=new Map<number,any>();
 const worker=new Worker('/worker.js',{type:'module'});
 worker.onmessage=e=>{const pending=requests.get(e.data.id);if(!pending)return;requests.delete(e.data.id);e.data.error?pending.reject(Error(e.data.error)):pending.resolve(e.data.result);};
 worker.onerror=e=>{for(const q of requests.values())q.reject(Error(e.message));requests.clear();};
 const call=(message:any)=>new Promise<any>((resolve,reject)=>{const id=++sequence;requests.set(id,{resolve,reject});worker.postMessage({...message,id});});
 const trace:any={model:config.model,workerConstructions:1,modelSessionLoads:0,actualModelRuns:0,attemptedRuns:0,jobsCompleted:0,unresolvedRuns:0,failure:null};window.waveTrace=trace;
 const post=async(url:string,body:any,binary=false)=>{const response=await fetch(url,{method:'POST',body:binary?body:JSON.stringify(body)});if(!response.ok)throw Error('JOURNAL_FAILURE:'+url);};
 try{
  trace.modelInfo=await call({type:'LOAD',model:config.model});loads++;trace.modelSessionLoads=loads;
  for(const job of config.jobs){failedJob=job.jobId;
   const source=new Float32Array(await(await fetch('/pcm/'+job.jobId)).arrayBuffer());if(source.length!==job.frames||await sha(source)!==job.pcmSha256)throw Error('SOURCE_PCM_MISMATCH');
   const windows:any[]=[],bPublications:any[]=[],directPublications:any[]=[];
   const infer=async(input:any)=>{
    const frozen=job.expectedModelInputs[windows.length];
    const inputSha=await sha(input.pcm);if(!frozen||inputSha!==frozen.sha256||input.window.startSample!==frozen.start||input.window.endSample!==frozen.end)throw Error('MODEL_INPUT_SHA_MISMATCH_BEFORE_INFER');
    trace.attemptedRuns++;trace.unresolvedRuns++;
    const result=await call({type:'INFER',model:config.model,index:count,window:input.window,pcm:input.pcm,domain:job.sourceDomainId});
    if(result.actualSessionRunCount!==count+1)throw Error('RUN_COUNT_DRIFT');count++;trace.actualModelRuns=count;trace.unresolvedRuns--;
    await post('/raw/'+(count-1),new Uint8Array(result.raw.buffer),true);
    const available=performance.now();
    windows.push({window:input.window,inputSha256:inputSha,rawSha256:result.rawSha256,rawIndex:count-1,inferenceMs:result.inferenceMs,decodeAndHashMs:result.decodeAndHashMs});
    if(config.model==='ROBUST_RAW')bPublications.push(project(job,input.window,result.decoderB,available,true));
    if(job.layer==='B')directPublications.push(project(job,input.window,result.events,available));
    return {events:result.events,inferenceMs:result.inferenceMs,decodeMs:result.decodeAndHashMs,actualSessionRunCount:count};
   };
   let primary:any;
   if(job.layer==='A'){
    const fir=new Uint8Array(await(await fetch('/fir-'+job.sourceRateHz+'.f32')).arrayBuffer());
    primary=await executeSource(job,source,fir,{run:infer,dispose:async()=>{}},()=>{},()=>{});
   }else{
    for(const w of job.windows)await infer({window:w,pcm:source.slice(w.startSample,w.endSample)});
    primary={jobId:job.jobId,sourceDomainId:job.sourceDomainId,sourceRateHz:16000,sourceOriginSample:0,publications:directPublications,
      windowsCompleted:windows.length,status:'PASS'};
   }
   if(windows.length!==job.expectedModelInputs.length)throw Error('MISSING_OR_EXTRA_WINDOW');
   await post('/job/'+job.jobId,{jobId:job.jobId,layer:job.layer,primary,decoderBPublications:bPublications,windows,
     actualModelRuns:windows.length,sharedRawForAB:config.model==='ROBUST_RAW',memory:(performance as any).memory?{usedJSHeapSize:(performance as any).memory.usedJSHeapSize}:null});
   trace.jobsCompleted++;
  }
  if(count!==config.plannedRuns||trace.jobsCompleted!==config.jobs.length)throw Error('PLANNED_BUDGET_DRIFT');
  trace.status='COMPLETE';trace.modelRunCountComplete=true;failedJob=null;
 }catch(error){trace.failure=String(error);trace.failedJob=failedJob;trace.status='BLOCKED';trace.modelRunCountComplete=trace.unresolvedRuns===0;}
 finally{
  try{if(!trace.failure)trace.finalOwner=await call({type:'DISPOSE'});}finally{worker.terminate();}
  return trace;
 }
};
