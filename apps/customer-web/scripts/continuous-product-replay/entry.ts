import { ContinuousAcousticRuntime } from '../../src/lib/practice/acoustic-inference/continuous/acoustic-runtime';
import { ContinuousAcousticWorker } from '../../src/lib/practice/acoustic-inference/continuous/worker-client';
import type { ContinuousEvidencePublication } from '../../src/lib/practice/local-core/continuous-evaluation-types';
import {replayAvailabilityMs} from './replay-clock';

declare global { interface Window { runProductReplay(input: {id:string;rate:number;durationMs:number;url:string}):Promise<unknown> } }
// Audio-only entry: no truth, expected groups or product evaluator is bundled here.
window.runProductReplay=async input=>{
  const source=new Float32Array(await(await fetch(input.url)).arrayBuffer());
  const coefficients=new Uint8Array(await(await fetch(`/fir-${input.rate}.f32`)).arrayBuffer());
  const worker=new ContinuousAcousticWorker(new Worker('/worker.js',{type:'module'}));
  const model=await worker.load('/model.onnx');
  const publications:ContinuousEvidencePublication[]=[];
  const start=performance.now();
  const begin=Math.round(input.rate*1.8),end=begin+Math.round(input.rate*input.durationMs/1000);
  let next=0,actualModelRuns=0;
  const runtime=await ContinuousAcousticRuntime.create({sessionDomainId:input.id,sourceDomainId:input.id+':source',
    sourceSampleRateHz:input.rate,coefficientBytes:coefficients,
    worker:{run:async data=>{const r=await worker.run(data);actualModelRuns=r.actualSessionRunCount;return r;},dispose:()=>worker.dispose()},
    nowAvailabilityMs:()=>replayAvailabilityMs((next-begin)*1000/input.rate,performance.now()-start),onPublication:p=>{publications.push(p);}});
  const through=async(target:number)=>{
    while(next<target){const stop=Math.min(target,next+1024);runtime.append({sourceSampleRateHz:input.rate,
      sourceStartSampleIndex:next,sourceEndSampleIndex:stop,samples:source.slice(next,stop)});next=stop;await runtime.drain();}
  };
  try{
    await through(begin);runtime.beginSegment(0);await through(end);runtime.requestTerminal(input.durationMs);
    await through(source.length);await runtime.seal();
    const snapshot=runtime.snapshot();
    if(snapshot.outstanding!==0||snapshot.analyzedThroughPerformanceMs!==input.durationMs||snapshot.counts.terminalPublications!==1)throw new Error('REPLAY_TERMINAL_FAILED');
    return {id:input.id,rate:input.rate,model,publications,snapshot,
      actualModelRuns,
      scheduling:'Deterministic backpressured offline replay, not causal wall-clock latency qualification',status:'PASS'};
  }catch(error){throw new Error(JSON.stringify({reason:String(error),actualModelRuns,snapshot:runtime.snapshot()}));}
  finally{await runtime.dispose();}
};
