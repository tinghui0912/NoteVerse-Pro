import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {BoundedAcousticAssembler} from '../../../../backend/research/step_attempt_assembly/assembler';
import {replay} from '../../../../backend/research/step_attempt_assembly/replay';
import type {DecodedPublication} from '../../../../backend/research/step_decoded_sufficiency/acoustic-gestures';

const pub=(id:number,frontierMs:number,events:readonly [number,string][],availabilityMs=frontierMs+170):DecodedPublication=>({
  publicationId:`p${id}`,frontierMs,availabilityMs,observations:events.map(([eventMs,pitch],i)=>({eventMs,pitch,
    observationId:`p${id}:o${i}`,availabilityMs,confidence:1,sourceDomainId:'s',sourceSampleRateHz:48000,sourceEventSample:eventMs*48}))});
const ready={ready:true,inputEligibleAfterMs:0};
describe('research fixed first-anchor acoustic assembly',()=>{
  it.each([35,50,70,90,120])('H=%s owns a fixed half-open interval, never extends',h=>{
    const a=new BoundedAcousticAssembler(h),r=a.push(pub(0,400,[[100,'C4'],[100+h-1,'E4'],[100+h,'G4'],[100+h+1,'A4']]),ready);
    expect(r.opened).toEqual({eventMs:100,captureEndMs:100+h});
    expect(r.sealed!.pitches).toEqual(['C4','E4']);expect(Object.isFrozen(r.sealed!.observations)).toBe(true);
  });
  it('collects across publications and cannot seal before the end is covered',()=>{
    const a=new BoundedAcousticAssembler(50);
    expect(a.push(pub(0,120,[[100,'C4']]),ready).sealed).toBeNull();
    const second=a.push(pub(1,149,[[140,'E4']]),{...ready,ready:false});expect(second.sealed).toBeNull();
    const end=a.push(pub(2,150,[[150,'G4']]),{...ready,ready:false});
    expect(end.sealed!.pitches).toEqual(['C4','E4']);expect(end.opened).toBeNull();
  });
  it('known Bach 40ms decoded split becomes generic full-set evidence at H50',()=>{
    const a=new BoundedAcousticAssembler(50),r=a.push(pub(0,4500,[[4260,'E4'],[4300,'G#4']]),ready);
    expect(r.sealed!.pitches).toEqual(['E4','G#4']);
    const result=replay('bach',{name:'extra_note_in_gesture',targets:[[64]]},[pub(0,4500,[[4260,'E4'],[4300,'G#4']])],4000,48000,50);
    expect(result.outcomes[0].verdict).toBe('MISMATCH');
  });
  it('excludes equal/old watermark, has no busy attempt queue',()=>{
    const a=new BoundedAcousticAssembler(50);
    expect(a.push(pub(0,600,[[100,'C4']]),{ready:false,inputEligibleAfterMs:0}).opened).toBeNull();
    expect(a.push(pub(1,1200,[[700,'C4'],[701,'D4']]),{ready:true,inputEligibleAfterMs:700}).sealed!.pitches).toEqual(['D4']);
  });
  it('same publication opens at most one attempt and preserves extra pitches',()=>{
    const r=replay('one',{name:'single',targets:[[60],[60],[60]]},[pub(0,600,[[100,'C4'],[120,'C#4'],[400,'C4']])],0,48000,50);
    expect(r.outcomes).toHaveLength(1);expect(r.outcomes[0].verdict).toBe('MISMATCH');
  });
  it('source sample watermark retires a delayed busy physical attack',()=>{
    const result=replay('busy',{name:'busy_period_input',targets:[[60],[60]]},[
      pub(0,600,[[100,'C4']]),pub(1,1200,[[800,'C4']]),pub(2,1800,[[1500,'C4']])],0,48000,50);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0].rearmWatermarkMs).toBe(1270);
    expect(result.outcomes[0].analysisFrontierMs).toBe(600);
    expect(result.outcomes.every(o=>o.eventMs!==800)).toBe(true);
    expect(result.outcomes[0].captureWitness.capturedThroughSourceSample).toBe(60960);
  });
  it('observation order cannot change sealed evidence; IDs remain auditable',()=>{
    const p=pub(0,600,[[100,'C4'],[100,'E4'],[120,'C4']]);
    const a=new BoundedAcousticAssembler(50).push(p,ready);
    const b=new BoundedAcousticAssembler(50).push({...p,observations:[...p.observations].reverse()},ready);
    expect(a).toEqual(b);expect(a.sealed!.observations).toHaveLength(3);expect(a.sealed!.pitches).toHaveLength(2);
  });
  it('assembler reads no score/target/runtime/truth and cannot gate perception',()=>{
    const source=readFileSync(path.resolve(__dirname,'../../../../backend/research/step_attempt_assembly/assembler.ts'),'utf8');
    expect(source).not.toMatch(/StepPractice|StepTarget|targetGeneration|expectedPitch|MATCH|MISMATCH|\.onnx|InferenceSession|MIDI|truth\.json/);
    expect(source).not.toContain('STEP_MIDI_CHORD_COHERENCE_MS');
  });
});
