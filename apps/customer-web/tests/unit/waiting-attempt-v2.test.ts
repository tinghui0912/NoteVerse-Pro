import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {WaitingAcousticAssembly,STEP_ACOUSTIC_GESTURE_WIDTH_MS} from '../../../../backend/research/step_waiting_attempt_v2/waiting-assembly';
import type {DecodedPublication} from '../../../../backend/research/step_decoded_sufficiency/acoustic-gestures';
import {installChronologyDiagnostics,chronologyFailures} from '../../scripts/qualification/chronology-diagnostics';
import {SourceChronology} from '../../src/lib/practice/acoustic/source/source-chronology';
import {scoreProduct,targetVariants,type TruthCase} from '../../../../backend/research/step_waiting_attempt_v2/product-scoring';
import {SharedWorkerJobs} from '../../../../backend/research/step_waiting_attempt_v2/shared-worker-jobs';
import type {AcousticInferenceInput} from '../../src/lib/practice/acoustic/runtime/inference-types';
const p=(n:number,end:number,events:readonly [number,string][],delay=0):DecodedPublication=>({publicationId:`s:w${n}`,frontierMs:end,availabilityMs:end+170+delay,
 observations:events.map(([eventMs,pitch],i)=>({observationId:`s:${n}:${i}`,eventMs,pitch,availabilityMs:end+170+delay,confidence:1,
  sourceDomainId:'s',sourceSampleRateHz:48000,sourceEventSample:eventMs*48}))});
it('fixed50 has no candidate selector and initial warm-ready ignores the entire startup interval',()=>{
 expect(STEP_ACOUSTIC_GESTURE_WIDTH_MS).toBe(50);
 const gate=new WaitingAcousticAssembly(48000,'s',0,2400);
 expect(gate.push(p(0,600,[[100,'E4'],[599,'G4']]))).toEqual({opened:null,sealed:null});
 expect(gate.snapshot().warmWitness!.inputEligibleAfter).toBe(600);
 const next=gate.push(p(1,1200,[[600,'C4'],[700,'E4'],[740,'G#4'],[750,'B4']]));
 expect(next.sealed!.eventMs).toBe(700);expect(next.sealed!.captureEndMs).toBe(750);
 expect(next.sealed!.pitches).toEqual(['E4','G#4']);
});
it('seals only after complete H coverage across publications, never extends',()=>{
 const gate=new WaitingAcousticAssembly(48000,'s',0,2400);gate.push(p(0,600,[]));
 expect(gate.push(p(1,720,[[700,'C4']])).sealed).toBeNull();
 const sealed=gate.push(p(2,750,[[740,'E4'],[750,'G4']])).sealed!;
 expect(sealed.pitches).toEqual(['C4','E4']);expect(sealed.captureEndMs).toBe(750);
});
it('busy physical source chronology, not analysis frontier, retires late publications',()=>{
 const gate=new WaitingAcousticAssembly(48000,'s',0,3000);gate.push(p(0,600,[]));
 expect(gate.push(p(1,1200,[[900,'C4']])).sealed).not.toBeNull();
 expect(gate.push(p(2,1800,[[1500,'C4']])).opened).toBeNull();
 const commit=gate.commit(2000);expect(commit.capturedThroughSourceSample).toBe(96000);expect(commit.inputEligibleAfter).toBe(2000);
 expect(gate.push({...p(2,1800,[[1500,'C4']]),availabilityMs:2100}).opened).toBeNull();
 expect(gate.push(p(3,2400,[[2000,'C4'],[2100,'C4']])).sealed!.eventMs).toBe(2100);
});
it('availability changes latency but never anchor, source identity or fixed capture end',()=>{
 const run=(delay:number)=>{const gate=new WaitingAcousticAssembly(48000,'s',0,2400);gate.push(p(0,600,[],delay));return gate.push(p(1,1200,[[900,'C4']],delay)).sealed!;};
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
 const evidence={id:'s',rate:48000,assembly:{warmWitness:{availableMs:770}},publications:[p(0,600,[]),p(1,1200,[[900,'E4'],[940,'G#4']]),p(2,1800,[[1500,'E4']]),p(3,2400,[])]};
 const truth:TruthCase={id:'s',family:'busy_period_input',physicalPitches:[64,68],ownedStart:0,ownedEnd:2.4,
  scoredEnd:2.4,eventTime:.9,warmBoundary:.6,truth:[{time:.9,notes:[{pitch:64,time:.9},{pitch:68,time:.94}]}],guards:[]};
 expect(targetVariants([64,68]).map(v=>v.name)).toEqual(['exact','subset','superset','semitone','octave']);
 const full=scoreProduct(evidence,truth,[64,68],'late');
 expect(full.outcomes.map(o=>o.verdict)).toEqual(['MATCH']);expect(full.outcomes[0].corroborated).toBe(true);
 expect(Object.values(full.architecture)).toEqual([0,0,0,0,0,0]);
 expect(full.outcomes[0].watermark).toBe(2370);expect(full.snapshot.step.attempts).toHaveLength(1);
 const subset=scoreProduct(evidence,truth,[64]);expect(subset.outcomes[0].verdict).toBe('MISMATCH');
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
