import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {WaitingAcousticAssembly,STEP_ACOUSTIC_GESTURE_WIDTH_MS} from '../../../../backend/research/step_waiting_attempt_v2/waiting-assembly';
import type {SourceDecodedPublication} from '../../../../backend/research/step_waiting_attempt_v2/waiting-assembly';
import {installChronologyDiagnostics,chronologyFailures} from '../../scripts/qualification/chronology-diagnostics';
import {SourceChronology} from '../../src/lib/practice/acoustic/source/source-chronology';
import {microphoneV6} from '../helpers/step-microphone-v6';
import {SharedWorkerJobs} from '../../../../backend/research/step_waiting_attempt_v2/shared-worker-jobs';
import type {AcousticInferenceInput} from '../../src/lib/practice/acoustic/runtime/inference-types';
const p=(n:number,end:number,events:readonly [number,string][],delay=0):SourceDecodedPublication=>({publicationId:`s:w${n}`,frontierMs:end,analyzedThroughSourceSample:end*48,availabilityMs:end+170+delay,
 observations:events.map(([eventMs,pitch],i)=>({observationId:`s:${n}:${i}`,eventMs,pitch,availabilityMs:end+170+delay,confidence:1,
  sourceDomainId:'s',sourceSampleRateHz:48000,sourceEventSample:eventMs*48}))});
it('fixed50 has no candidate selector and initial warm-ready ignores the entire startup interval',()=>{
 expect(STEP_ACOUSTIC_GESTURE_WIDTH_MS).toBe(50);
 const gate=new WaitingAcousticAssembly(48000,'s',0,2400*48);
 expect(gate.push(p(0,600,[[100,'E4'],[599,'G4']]))).toEqual({opened:null,sealed:null});
 expect(gate.snapshot().warmWitness!.inputEligibleAfter).toBe(600);
 const next=gate.push(p(1,1200,[[600,'C4'],[700,'E4'],[740,'G#4'],[750,'B4']]));
 expect(next.sealed!.eventMs).toBe(700);expect(next.sealed!.captureEndMs).toBe(750);
 expect(next.sealed!.pitches).toEqual(['E4','G#4']);
});
it('seals only after complete H coverage across publications, never extends',()=>{
 const gate=new WaitingAcousticAssembly(48000,'s',0,2400*48);gate.push(p(0,600,[]));
 expect(gate.push(p(1,720,[[700,'C4']])).sealed).toBeNull();
 const sealed=gate.push(p(2,750,[[740,'E4'],[750,'G4']])).sealed!;
 expect(sealed.pitches).toEqual(['C4','E4']);expect(sealed.captureEndMs).toBe(750);
});
it('busy physical source chronology, not analysis frontier, retires late publications',()=>{
 const gate=new WaitingAcousticAssembly(48000,'s',0,3000*48);gate.push(p(0,600,[]));
 expect(gate.push(p(1,1200,[[900,'C4']])).sealed).not.toBeNull();
 expect(gate.push(p(2,1800,[[1500,'C4']])).opened).toBeNull();
 const commit=gate.commit(2000);expect(commit.capturedThroughSourceSample).toBe(96000);expect(commit.inputEligibleAfter).toBe(2000);
 expect(gate.push({...p(2,1800,[[1500,'C4']]),availabilityMs:2100}).opened).toBeNull();
 expect(gate.push(p(3,2400,[[2000,'C4'],[2100,'C4']])).sealed!.eventMs).toBe(2100);
});
it('availability changes latency but never anchor, source identity or fixed capture end',()=>{
 const run=(delay:number)=>{const gate=new WaitingAcousticAssembly(48000,'s',0,2400*48);gate.push(p(0,600,[],delay));return gate.push(p(1,1200,[[900,'C4']],delay)).sealed!;};
 const a=run(0),b=run(300);expect(a.candidateId).toBe(b.candidateId);expect(a.eventMs).toBe(b.eventMs);expect(a.captureEndMs).toBe(b.captureEndMs);
 expect(a.sealedAtMs).not.toBe(b.sealedAtMs);
});
it('diagnostic wrapper records the actual rejected chunk without weakening chronology',()=>{
 installChronologyDiagnostics();const chronology=new SourceChronology(44100);
 const first={type:'pcm-chunk' as const,sequence:0,sourceSampleRateHz:44100,sourceStartSampleIndex:0,sourceEndSampleIndex:128,
  audioContextStartFrame:0,inputChannelCount:1,captureTimeSeconds:0,samples:new Float32Array(128)};
 chronology.accept(first);expect(chronology.snapshot().nextSequence).toBe(1);
 expect(()=>chronology.accept({...first,sequence:2,sourceStartSampleIndex:256,sourceEndSampleIndex:384,audioContextStartFrame:256,captureTimeSeconds:256/44100})).toThrow('CAPTURE_CHRONOLOGY_VIOLATION');
 expect(chronology.snapshot().nextSequence).toBe(1);
 expect(chronologyFailures().at(-1)).toMatchObject({expectedSequence:1,actualSequence:2,expectedSourceStartSampleIndex:128,
  actualSourceStartSampleIndex:256,sourceEndSampleIndex:384,sampleLength:128,sourceSampleRateHz:44100,expectedRate:44100,
  audioContextStartFrame:256,captureTimeSeconds:256/44100,derivedFrameTime:256/44100,inputChannelCount:1});
});
it('Stage A and assembly cannot import product targets or read truth files',()=>{
 const dir=path.resolve(__dirname,'../../../../backend/research/step_waiting_attempt_v2');
 for(const file of ['audio-entry.ts','waiting-assembly.ts'])expect(readFileSync(path.join(dir,file),'utf8')).not.toMatch(/StepPracticeRuntime|StepTarget|expectedPitch|truth\.json|targetGeneration|MISMATCH|MATCH/);
});
it('post-seal product verification uses the actual STEP runtime, with full pitch sets and physical rearm',()=>{
 const gate=new WaitingAcousticAssembly(48000,'s',0,2400*48);gate.push(p(0,600,[]));
 const sealed=gate.push(p(1,1200,[[900,'E4'],[940,'G#4']])).sealed!;
 expect(sealed.pitches).toEqual(['E4','G#4']);expect(sealed.captureEndMs).toBe(sealed.eventMs+50);
 expect(gate.push(p(2,1800,[[1500,'E4']])).opened).toBeNull();
 const physical=gate.commit(2370);
 expect(physical.capturedThroughSourceSample).toBe(2370*48);
 const evidence={anchorMs:sealed.eventMs,endMs:sealed.captureEndMs,pitches:sealed.pitches,confidence:sealed.confidence};
 for(const [target,verdict] of [[['E4','G#4'],'MATCH'],[['E4'],'RETRY'],[['D4'],'MISMATCH']] as const){
  const current=microphoneV6(target,600),record=current.complete(evidence,physical.inputEligibleAfter);
  expect(record.verdict).toBe(verdict);expect(record.retryReason).toBe(verdict==='RETRY'?'UNCERTAIN':null);
  expect(record.observedAttackPitches).toEqual(sealed.pitches);
  expect(current.runtime.currentStepIndex).toBe(verdict==='MATCH'?1:0);
  expect(current.runtime.openAttempt(current.time(1500))).toBeNull();
  expect(current.runtime.snapshot().step.attempts).toHaveLength(1);
 }
 expect(gate.push({...p(1,1200,[[900,'E4'],[940,'G#4']]),availabilityMs:2371}).opened).toBeNull();
 expect(gate.push(p(3,2400,[[2370,'E4'],[2380,'E4']])).opened).not.toBeNull();
 expect(gate.snapshot().active!.eventMs).toBe(2380);
});
it('Stage B verifies the acoustic seal before opening truth; Stage A has an asset-only HTTP allowlist',()=>{
 const dir=path.resolve(__dirname,'../../../../backend/research/step_waiting_attempt_v2');
 const scorer=readFileSync(path.join(dir,'score.mjs'),'utf8');
 expect(scorer.indexOf("hash(bytes)!==seal.sha256")).toBeLessThan(scorer.indexOf("path.join(DATA,'truth.json')"));
 const browser=readFileSync(path.join(dir,'browser.mjs'),'utf8');
 expect(browser).not.toContain("path.join(DATA,'truth.json')");expect(browser).toContain('AUDIO_ASSETS_ONLY');
 expect(browser).toContain('await chmod(file,0o444)');
});
it('independent source planners borrow one Worker without restarting its global job sequence or changing acoustic geometry',async()=>{
 const submitted:AcousticInferenceInput[]=[];
 const sequence=new SharedWorkerJobs({run:async input=>{submitted.push(input);return {events:[],inferenceMs:1,decodeMs:0,actualSessionRunCount:submitted.length};},dispose:async()=>{}});
 const input:AcousticInferenceInput={window:{jobIndex:0,regionIndex:0,windowIndex:0,ownedStartTarget:19200,ownedEndTarget:28800,startSample:2400,endSample:31520},pcm:new Float32Array(29120)};
 await sequence.run(input);await sequence.run({...input,window:{...input.window,jobIndex:1,windowIndex:1}});await sequence.run(input);
 expect(submitted.map(i=>i.window.jobIndex)).toEqual([0,1,2]);expect(submitted[2].pcm).toBe(input.pcm);
 expect({...submitted[2].window,jobIndex:0}).toEqual(input.window);expect(sequence.submittedJobs).toBe(3);
});
it('every selected source origin warms on its first full 600ms source interval without floating-time equality or tolerance',()=>{
 const jobs=JSON.parse(readFileSync(path.resolve(__dirname,'../../../../backend/data/work/step_waiting_attempt_v2/v2/audio_only/jobs.json'),'utf8')).jobs as {id:string;rate:number;sourceOriginSample:number;regionStartSourceSample:number;semanticEndSourceSample:number}[];
 for(const j of jobs){
  const gate=new WaitingAcousticAssembly(j.rate,j.id,j.regionStartSourceSample,j.semanticEndSourceSample);
  const end=j.regionStartSourceSample+j.rate*600/1000;
  const ms=(j.sourceOriginSample+((j.regionStartSourceSample-j.sourceOriginSample)*16000/j.rate+9600)*j.rate/16000)/j.rate*1000;
  gate.push({publicationId:j.id,analyzedThroughSourceSample:end,frontierMs:ms,availabilityMs:ms+170,observations:[]});
  expect(gate.snapshot().warmReady).toBe(true);expect(gate.snapshot().inputEligibleAfter).toBe(end/j.rate*1000);
 }
});
