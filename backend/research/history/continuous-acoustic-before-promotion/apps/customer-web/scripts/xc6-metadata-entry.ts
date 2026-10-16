export async function probeCaptureMetadata() {
  const startedAt=new Date().toISOString();let stream:MediaStream|undefined,context:AudioContext|undefined;
  const states:{state:string;contextTime:number}[]=[],sizes:Record<string,number>={},channels:Record<string,number>={};
  let blocks=0,gaps=0,next=0,firstFrame:number|undefined,rate:number|undefined,sequence=0;
  try{
    const permission=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    const timeout=new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('NORMAL_PERMISSION_NOT_GRANTED_WITHIN_12_SECONDS')),12000));
    stream=await Promise.race([permission,timeout]);
    context=new AudioContext();states.push({state:context.state,contextTime:context.currentTime});
    context.onstatechange=()=>states.push({state:context!.state,contextTime:context!.currentTime});
    await context.audioWorklet.addModule('/capture.worklet.js');
    const node=new AudioWorkletNode(context,'noteverse-xc6-disabled-capture');
    node.port.onmessage=({data:d})=>{
      // PCM exists only in the renderer's transient message and is never copied to a report.
      rate=d.sourceSampleRateHz;firstFrame??=d.audioContextStartFrame;
      if(d.sourceStartSampleIndex!==next||d.sequence!==sequence++)gaps++;
      next=d.sourceEndSampleIndex;blocks++;sizes[d.samples.length]=(sizes[d.samples.length]??0)+1;
      channels[d.inputChannelCount]=(channels[d.inputChannelCount]??0)+1;
    };
    const input=context.createMediaStreamSource(stream),silent=context.createGain();silent.gain.value=0;
    input.connect(node);node.connect(silent);silent.connect(context.destination);await context.resume();
    await new Promise(r=>setTimeout(r,1200));input.disconnect();node.disconnect();
    return{status:'CAPTURE_METADATA_PROBE_COMPLETE',startedAt,audioContextSampleRateHz:context.sampleRate,
      audioWorkletSampleRateHz:rate,blocks,chunkSizeDistribution:sizes,inputChannelCountDistribution:channels,
      firstAudioContextFrame:firstFrame,sourceEndSampleIndex:next,gapCount:gaps,stateTransitions:states,pcmPersisted:false};
  }catch(error){return{status:'REAL_MICROPHONE_DEVICE_PROBE_NOT_PERFORMED',startedAt,error:String(error),pcmPersisted:false,stateTransitions:states};}
  finally{stream?.getTracks().forEach(t=>t.stop());await context?.close();}
}
if(typeof window!=='undefined')Object.assign(window,{probeCaptureMetadata});
