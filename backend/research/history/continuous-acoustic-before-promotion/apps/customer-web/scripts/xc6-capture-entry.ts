import {Xc6DisabledCaptureBridge,type Xc6CaptureMessage} from '../src/lib/practice/acoustic-inference/xc6-capture-bridge';
import {Xc4BrowserWorkerClient} from '../src/lib/practice/acoustic-inference/xc4-robust-worker-client';
import {XC4} from '../src/lib/practice/acoustic-inference/xc4-robust-runtime-contract';
import {evaluatePracticeInputCapabilities} from '../src/lib/practice/input-capability';
import {qualifyBrowserDsp} from './xc6-dsp-browser';

export async function runXc6CaptureIntegration(){
  const coefficientBytes=new Uint8Array(await(await fetch('/fir48.f32')).arrayBuffer());
  const dsp=await qualifyBrowserDsp(coefficientBytes);
  const capability=evaluatePracticeInputCapabilities().acousticAnalysis.continuous.status;
  if(capability!=='MODEL_NOT_VALIDATED')throw new Error('XC6_PRODUCT_CAPABILITY_BECAME_AVAILABLE');
  const worker=new Xc4BrowserWorkerClient(new Worker('/worker.js',{type:'module'}));
  let stream:MediaStream|undefined,context:AudioContext|undefined,bridge:Xc6DisabledCaptureBridge|undefined;
  const loadStart=performance.now(),modelLoad=await worker.load('/model.onnx'),loadMs=performance.now()-loadStart;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    context=new AudioContext();
    if(context.sampleRate!==48000)throw new Error('XC6_CAPTURE_RATE_DIFFERS_FROM_FROZEN_OBSERVATION');
    let originWall=0,startRaw:number|undefined,stopRaw:number|undefined,clockAnchor:unknown;
    bridge=await Xc6DisabledCaptureBridge.create({engineeringOnly:true,sessionId:'xc6-one-fake-media',sourceSampleRateHz:context.sampleRate,
      coefficientBytes,worker,performanceClock:{nowMs:()=>performance.now()-originWall}});
    let earlyStart='';try{bridge.schedulePerformanceStart({sourceSampleIndex:0});}catch(e){earlyStart=String(e);}
    if(!earlyStart.includes('ACOUSTIC_PREROLL_NOT_READY'))throw new Error('XC6_EARLY_START_NOT_REJECTED');
    const states:{state:string;contextTime:number}[]=[];
    context.onstatechange=()=>{states.push({state:context!.state,contextTime:context!.currentTime});bridge!.contextStateChanged(context!.state);};
    await context.audioWorklet.addModule('/capture.worklet.js');
    const capture=new AudioWorkletNode(context,'noteverse-xc6-disabled-capture'),input=context.createMediaStreamSource(stream),silent=context.createGain();silent.gain.value=0;
    let failure:unknown,resolveTail:(()=>void)|undefined,rejectTail:((e:unknown)=>void)|undefined,tailClosed=false;
    const done=new Promise<void>((resolve,reject)=>{resolveTail=resolve;rejectTail=reject;});
    const timeout=setTimeout(()=>rejectTail!(new Error('XC6_BOUNDED_CAPTURE_TIMEOUT')),20000);
    capture.port.onmessage=({data}:MessageEvent<Xc6CaptureMessage>)=>{
      try{
        bridge!.ingest(data);
        if(startRaw===undefined&&bridge!.preRollReady&&data.sourceEndSampleIndex>=57600){
          // External source-clock command; inference does not choose/advance score time.
          const firstFrame=data.audioContextStartFrame-data.sourceStartSampleIndex;
          const liveSourceBoundary=Math.ceil(context!.currentTime*48000)-firstFrame;
          startRaw=Math.ceil((Math.max(data.sourceEndSampleIndex,liveSourceBoundary)+384)/384)*384;
          stopRaw=startRaw+57600;
          const timestamp=context!.getOutputTimestamp();
          if(timestamp.contextTime===undefined||timestamp.performanceTime===undefined)throw new Error('XC6_EXTERNAL_CLOCK_ANCHOR_UNAVAILABLE');
          const contextOrigin=(firstFrame+startRaw)/48000;
          originWall=timestamp.performanceTime+(contextOrigin-timestamp.contextTime)*1000;
          clockAnchor={method:'AudioContext.getOutputTimestamp affine source-clock anchor, not message arrival',
            firstAudioContextFrame:firstFrame,sourcePerformanceOrigin:startRaw,contextOriginSeconds:contextOrigin,
            outputTimestamp:timestamp,originPerformanceTimestampMs:originWall};
          bridge!.schedulePerformanceStart({sourceSampleIndex:startRaw});
          bridge!.schedulePerformanceStop({sourceSampleIndex:stopRaw});
        }
        if(!tailClosed&&bridge!.realTailReady){
          tailClosed=true;bridge!.closeIngressAfterRealTail();input.disconnect();capture.disconnect();stream!.getTracks().forEach(t=>t.stop());resolveTail!();
        }
      }catch(error){failure=error;rejectTail!(error);}
    };
    input.connect(capture);capture.connect(silent);silent.connect(context.destination);await context.resume();
    try{await done;}finally{clearTimeout(timeout);}
    if(failure)throw failure;
    await bridge.seal();const result=bridge.snapshot();
    const runtimeCalls=result.timings.at(-1)?.workerActualSessionRunCount;
    if(result.state!=='SEALED'||result.outstandingDepth!==0||result.publications.length!==2||runtimeCalls!==2
      ||result.captureMetadata.gapCount!==0||result.acousticCoreIdentitySha256!==XC4.engineeringIdentitySha256)throw new Error('XC6_CAPTURE_ACCEPTANCE_FAILED');
    return{status:'XC6_FAKE_MEDIA_END_TO_END_CAPTURE_SMOKE_PASS',pipeline:['getUserMedia','AudioContext','AudioWorklet','source bridge','qualified48000to16000FIR','XC5 runtime','Worker/WebGPU','acoustic publication'],
      actualCaptureRateHz:context.sampleRate,audioWorkletRateHz:result.sourceSampleRateHz,
      dsp,modelLoad,loadMs,result,clockAnchor,stateTransitions:states,earlyStart,
      actualSessionRunCount:runtimeCalls,productCapability:capability,productionMicrophone:false,
      decoder:'A',onsetThreshold:.30,frameThreshold:.05,ownedMs:600,futureMs:170,
      directPcmInjectionAfterWorklet:false,scoreOrMidiInputs:false,rawMicrophonePcmPersisted:false};
  }finally{await bridge?.dispose();worker.terminate();stream?.getTracks().forEach(t=>t.stop());await context?.close();}
}
if(typeof window!=='undefined')Object.assign(window,{runXc6CaptureIntegration});
