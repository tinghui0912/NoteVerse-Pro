import { Xc4RobustAcousticRuntime } from '../src/lib/practice/acoustic-inference/xc4-robust-acoustic-runtime';
import { Xc4BrowserWorkerClient } from '../src/lib/practice/acoustic-inference/xc4-robust-worker-client';
import { XC4, sha256 } from '../src/lib/practice/acoustic-inference/xc4-robust-runtime-contract';
import { verifyXc4Model } from '../src/lib/practice/acoustic-inference/xc4-robust-worker-adapter';
import { ByteDanceOnnxInferenceCore, loadOnnxRuntimeWeb } from '../src/lib/practice/acoustic-inference/bytedance-onnx-provider';
import { defaultByteDanceModelManifest } from '../src/lib/practice/acoustic-inference/bytedance-contract';
import { StreamingRationalResampler } from '../../../backend/research/browser_runtime/xc2_r1_streaming_resampler.mjs';
import { decodeRobustRawOutputs, filterOwnedObservations } from '../../../backend/research/browser_runtime/xc1_robust_decoder.mjs';

export async function runXc5Smoke() {
  const coefficientBytes = new Uint8Array(await (await fetch('/fir.f32')).arrayBuffer());
  if (await sha256(coefficientBytes) !== XC4.coefficientSha256) throw new Error('XC5_FIR_DRIFT');
  // One deterministic synthetic source only; no MIDI, score, labels or external audio.
  const rate = 44100, pre = 52920, performanceSamples = 52920, tail = 7938;
  const source = Float32Array.from({length:pre+performanceSamples+tail},(_,i)=>{
    const s=i/rate, envelope=Math.pow(Math.max(0,Math.sin(s*Math.PI*4)),2);
    return Math.fround(.15*envelope*(Math.sin(2*Math.PI*261.625565*s)+.4*Math.sin(2*Math.PI*329.627557*s)));
  });
  const client = new Xc4BrowserWorkerClient(new Worker('/worker.js',{type:'module'}));
  const beforeLoad=performance.now(), modelLoad=await client.load('/model.onnx'), loadMs=performance.now()-beforeLoad;
  let origin=0;
  const runtime=await Xc4RobustAcousticRuntime.create({engineeringOnly:true,sessionId:'xc5-one-synthetic',
    sourceSampleRateHz:44100,mode:'CAPTURE',coefficientBytes,worker:client,
    performanceClock:{nowMs:()=>performance.now()-origin}});
  const append=(start:number,end:number)=>runtime.append({sourceSampleRateHz:rate,
    sourceStartSampleIndex:start,sourceEndSampleIndex:end,samples:source.subarray(start,end)});
  try {
    for(let n=0;n<pre;n+=137) append(n,Math.min(pre,n+137));
    if(runtime.state!=='READY_FOR_PERFORMANCE') throw new Error('XC5_PREROLL_NOT_READY');
    origin=performance.now(); runtime.startPerformance({sourceStartSampleIndex:pre});
    const producerDelays:number[]=[];
    async function feed(begin:number,end:number) {
      for(let start=begin;start<end;start+=441){
        const next=Math.min(start+441,end),due=origin+(next-pre)/rate*1000;
        await new Promise(r=>setTimeout(r,Math.max(0,due-performance.now())));
        producerDelays.push(performance.now()-due); append(start,next);
      }
    }
    await feed(pre,pre+performanceSamples);
    runtime.stopPerformance({sourceEndSampleIndex:pre+performanceSamples});
    await feed(pre+performanceSamples,source.length); await runtime.seal();
    const result=runtime.snapshot(); await runtime.dispose(); client.terminate();
    if(result.publications.length!==2 || result.outstandingDepth!==0 || result.state!=='SEALED') throw new Error('XC5_COVERAGE_OR_QUEUE');

    // Separate frozen research reference, same PCM and exact windows. Not an accuracy benchmark.
    const h=new Float32Array(coefficientBytes.buffer), filtered=new StreamingRationalResampler(h).push(source);
    const base=await loadOnnxRuntimeWeb({executionProvider:'webgpu'});
    const reference=new ByteDanceOnnxInferenceCore(base,async()=>{
      const bytes=new Uint8Array(await (await fetch('/model.onnx')).arrayBuffer());
      await verifyXc4Model(bytes); return {bytes};
    });
    await reference.load(defaultByteDanceModelManifest({modelUrl:'/model.onnx',expectedByteSize:XC4.modelBytes,sha256:XC4.modelSha256}));
    let referenceRunCount=0;
    const expected:{pitch:number;performanceTimeMs:number;confidence:number}[]=[];
    try{
      for(const p of result.publications){
        const w=p.window;
        referenceRunCount++;
        const raw=await reference.infer({requestId:`reference-${w.windowIndex}`,pcm:filtered.slice(w.startSample,w.endSample),
          sampleRateHz:16000,channelCount:1,captureStartSampleIndex:w.startSample,
          captureStartTime:{domainId:'xc5-reference',ms:w.inputWindowStartMs}});
        const decoded=decodeRobustRawOutputs({regData:raw.reg_onset_output,frameData:raw.frame_output,
          dims:[...raw.reg_onset_shape],inputWindowStartMs:w.inputWindowStartMs,inferenceCompletedAtMs:undefined});
        expected.push(...filterOwnedObservations(decoded,w.ownedStartMs,w.ownedEndMs));
      }
    }finally{await reference.dispose();}
    const actual=result.publications.flatMap(p=>p.observations);
    let maxTimeError=0,maxConfidenceError=0;
    if(actual.length!==expected.length) throw new Error(`XC5_EVENT_COUNT_DRIFT:${actual.length}:${expected.length}`);
    actual.forEach((e,i)=>{
      if(e.midiPitch!==expected[i].pitch) throw new Error('XC5_PITCH_DRIFT');
      maxTimeError=Math.max(maxTimeError,Math.abs(e.performanceTimeMs-expected[i].performanceTimeMs));
      maxConfidenceError=Math.max(maxConfidenceError,Math.abs(e.confidence-expected[i].confidence));
    });
    if(maxTimeError>1e-6 || maxConfidenceError>1e-5) throw new Error('XC5_REFERENCE_EVENT_DRIFT');
    const runtimeRunCount=result.timings.at(-1)!.workerActualSessionRunCount;
    return {status:'XC5_BOUNDED_BROWSER_ENGINEERING_SMOKE_PASS',modelLoad,loadMs,
      engineeringIdentitySha256:XC4.engineeringIdentitySha256,
      sourceFixture:{kind:'DETERMINISTIC_SYNTHETIC_ONLY',sampleRateHz:rate,samples:source.length,
        sha256:await sha256(new Uint8Array(source.buffer)),preRollSamples:pre,performanceSamples,tailSamples:tail},
      windowCount:result.publications.length,publicationCount:result.publications.length,
      observationCount:actual.length,eventParity:'PASS',eventTimeParity:'PASS',maxTimeErrorMs:maxTimeError,
      maxConfidenceError,actualSessionRunCount:runtimeRunCount+referenceRunCount,
      runtimeSessionRunCount:runtimeRunCount,referenceSessionRunCount:referenceRunCount,
      actualSessionLoadCount:(modelLoad as {actualSessionLoadCount:number}).actualSessionLoadCount+1,actualModelBytesVerified:XC4.modelBytes,
      provider:'webgpu',ortWebVersion:XC4.ortVersion,automaticFallback:false,
      producerDelayMs:producerDelays,queueDelayMs:result.timings.map(r=>r.queueDelayMs),
      maxOutstandingDepth:result.maxOutstandingDepth,finalOutstandingDepth:result.outstandingDepth,
      result,truthOrExpectedScoreInputs:false,microphoneProbe:'REAL_MICROPHONE_DEVICE_PROBE_NOT_PERFORMED',
      accuracyMetricsProduced:false};
  }finally{await runtime.dispose();client.terminate();}
}

Object.assign(window,{runXc5Smoke});
