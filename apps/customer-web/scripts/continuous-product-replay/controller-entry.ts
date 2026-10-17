import {ContinuousPracticeController} from '../../src/lib/practice/continuous/continuous-practice-controller';
import {browserContinuousPlatform} from '../../src/lib/practice/continuous/continuous-platform';
import {AcousticModelWorker} from '../../src/lib/practice/acoustic/model/worker-client';
import fixture from '../../src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type {PracticeScoreArtifact} from '../../src/lib/practice/local-core/artifact';
declare global { interface Window {runMusicalControllerReplay(urls:Record<string,string>):Promise<unknown>} }
window.runMusicalControllerReplay=async urls=>{
  const Generator=(globalThis as unknown as {MediaStreamTrackGenerator:new (options:{kind:'audio'})=>MediaStreamTrack}).MediaStreamTrackGenerator;
  if(!Generator)throw new Error('QUALIFICATION_REPLAY_TRACK_UNAVAILABLE');
  const root=new MediaStream([new Generator({kind:'audio'})]);
  const platform={...browserContinuousPlatform,modelUrl:async()=>'/model.onnx',
    acquireMicrophone:async()=>root,createWorker:()=>new AcousticModelWorker(new Worker('/worker.js',{type:'module'})),
    connectCapture:async(options:Parameters<typeof browserContinuousPlatform.connectCapture>[0])=>{
      const {bridge,context}=options,rate=context.sampleRate;
      if(rate!==48000&&rate!==44100)throw new Error('CONTROLLER_REPLAY_UNQUALIFIED_DEFAULT_RATE');
      const audio=new Float32Array(await(await fetch(urls[rate])).arrayBuffer());
      const origin=Math.round(context.currentTime*rate);let next=0,sequence=0,stopped=false,begin:number|null=null;
      const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);detach();};
      const detach=bridge.runtime.attachCaptureCleanup(stop);
      const timer=setInterval(()=>{
        if(stopped)return;
        try{
          const boundary=bridge.snapshot().boundaryDiagnostics.find(b=>b.action==='SCHEDULED'&&b.type==='BEGIN');
          if(boundary)begin??=boundary.sourceSampleIndex;
          const available=Math.floor((context.currentTime*rate-origin)/128)*128;
          while(next+128<=available){
            const samples=new Float32Array(128);
            for(let i=0;i<128;i++){
              // Before BEGIN, actual fixture pre-roll only; once scheduled, audio
              // attack time is anchored to its literal source boundary. No truth input.
              const index=begin===null?next+i:Math.round(1.8*rate)+next+i-begin;
              samples[i]=audio[Math.max(0,Math.min(audio.length-1,index))];
            }
            bridge.receive({type:'pcm-chunk',sequence:sequence++,sourceSampleRateHz:rate,sourceStartSampleIndex:next,sourceEndSampleIndex:next+128,
              audioContextStartFrame:origin+next,captureTimeSeconds:(origin+next)/rate,inputChannelCount:1,samples});next+=128;
          }
        }catch(error){bridge.abort(error);stop();}
      },3);
      return {stop};
    }};
  const artifact={...fixture,scoreEndBeat:12,expectedPracticeGroups:fixture.expectedPracticeGroups.slice(0,1),practiceAttackSteps:fixture.practiceAttackSteps.slice(0,1)} as PracticeScoreArtifact;
  const controller=new ContinuousPracticeController({artifact,scope:{kind:'FULL'},inputSource:'MICROPHONE',countInBeats:0,
    tempoSelection:{mode:'CUSTOM_FIXED_BPM',bpm:120},recordingMode:'OFF'},platform);
  try{
    await controller.start();const deadline=performance.now()+30000;
    while(controller.snapshot().session!=='COMPLETE'){
      if(['FAILED','FAILED_BEFORE_START'].includes(controller.snapshot().session))throw new Error(JSON.stringify(controller.snapshot()));
      if(performance.now()>deadline)throw new Error('MUSICAL_CONTROLLER_TIMEOUT');await new Promise(r=>setTimeout(r,5));
    }
    const snapshot=controller.snapshot(),engineering=controller.engineeringSnapshot();
    if(snapshot.completed?.evaluation.status!=='COMPLETE'||engineering.microphone?.runtime?.outstanding!==0)throw new Error('CONTROLLER_REPLAY_INCOMPLETE');
    return {status:'PASS',snapshot,engineering,actualModelRuns:engineering.microphone.runtime.diagnostics.at(-1)?.actualSessionRunCount??0,
      role:'Controller ingestion/completion witness only; primary acoustic metrics use exact predeclared runtime replay windows, not this render-timeline replay.'};
  }finally{await controller.dispose();root.getTracks().forEach(t=>t.stop());}
};
