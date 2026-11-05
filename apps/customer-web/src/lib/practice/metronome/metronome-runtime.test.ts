import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MetronomeRuntime } from './metronome-runtime';
import { resolveMetronomePlan } from './metronome-plan';
import type { MeterSegment } from '@/lib/practice/kernel/artifact';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';

const tempo: ResolvedPracticeTempoPlan = { selection: { mode: 'SCORE' }, segments: [{ startTick: 0, bpm: 120, source: 'MUSICXML' }] };
const meter = (numerator = 4, denominator = 4, startTick = 0): MeterSegment => ({ startTick, numerator, denominator,
    });
function rig(mode: 'STEP' | 'CONTINUOUS' = 'CONTINUOUS', enabled = true, meters = [meter()], tempoPlan = tempo, startTick = 0, endTick = 32) {
  let now = 0;
  const audio = { activate: vi.fn(), nowMs: () => now, scheduleClick: vi.fn(), dispose: vi.fn() };
  const plan = resolveMetronomePlan({ ticksPerQuarter: 2, mode, initiallyEnabled: enabled, tempoPlan: {...tempoPlan, segments:tempoPlan.segments.map(s=>({...s,startTick:s.startTick*2}))}, meterSegments: meters.map(m=>({...m,startTick:m.startTick*2})),
    timelineEndTick: 64, scopeStartTick: startTick * 2, scopeEndTick: endTick * 2 });
  const runtime = new MetronomeRuntime(plan, audio);
  const advance = (ms: number) => { now += ms; vi.advanceTimersByTime(ms); };
  return { runtime, audio, plan, advance, calls: () => audio.scheduleClick.mock.calls.map(([click]) => click) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('disabled scheduling retains its cursor without producing audio; live enable has no preconsumed or duplicate pulses', () => {
  const r = rig('CONTINUOUS', false); r.runtime.start({ state: 'RUNNING',timelineTimeMs:0.0 });
  r.advance(1000); expect(r.calls()).toEqual([]);
  r.runtime.setEnabled(true); r.advance(500);
  expect(r.calls()).toEqual([{ atMs: 1500, accent: false }]);
  r.runtime.setEnabled(false); r.advance(1000); expect(r.calls()).toHaveLength(1);
  r.runtime.setEnabled(true); r.advance(500); expect(r.calls().map(c => c.atMs)).toEqual([1500, 3000]);
  r.runtime.dispose();
});
it.each([[4,4,500],[3,4,500],[6,8,250],[2,2,1000]])('%i/%i uses the exact meter grid and downbeats', (numerator,denominator,interval) => {
  const r = rig('CONTINUOUS', true, [meter(numerator,denominator)]); r.runtime.start({ state: 'RUNNING',timelineTimeMs:0.0 });
  for (let i = 0; i < numerator + 1; i++) r.advance(interval);
  expect(r.calls().slice(0,numerator + 1)).toEqual(Array.from({ length: numerator + 1 }, (_,i) => ({ atMs: i * interval, accent: i % numerator === 0 })));
  r.runtime.dispose();
});
it('Continuous follows exact meter and score-tempo changes', () => {
  const r = rig('CONTINUOUS', true, [meter(),meter(3,4,4)], { selection: { mode: 'SCORE' }, segments: [
    {startTick:0,bpm:120,source:'MUSICXML'}, {startTick:4,bpm:60,source:'MUSICXML'}] });
  r.runtime.start({state:'RUNNING',timelineTimeMs:0.0}); for(let i=0;i<14;i++)r.advance(500);
  expect(r.calls().map(c=>c.atMs)).toEqual([0,500,1000,1500,2000,3000,4000,5000,6000,7000]);
  expect(r.calls().filter(c=>c.accent).map(c=>c.atMs)).toEqual([0,2000,5000]); r.runtime.dispose();
});
it('selected range starts at its score meter phase and stops at the explicit terminal tick', () => {
  const r=rig('CONTINUOUS',true,[meter()],tempo,5,6); r.runtime.start({state:'RUNNING',timelineTimeMs:2500});
  r.advance(2000); expect(r.calls()).toEqual([{atMs:0,accent:false},{atMs:500,accent:false}]); r.runtime.dispose();
});
it('STEP syncopated target repeats at target BPM across future score tempo changes, then resynchronizes to a new target', () => {
  const r=rig('STEP',true,[meter()],{selection:{mode:'SCORE'},segments:[
    {startTick:0,bpm:100,source:'MUSICXML'},{startTick:8,bpm:80,source:'MUSICXML'}]});
  r.runtime.start(15); r.advance(300); expect(r.calls()).toEqual([{atMs:350,accent:true}]);
  r.advance(600);r.advance(600);expect(r.calls().map(c=>c.atMs)).toEqual([350,950,1550]);
  expect(r.runtime.planningCursor).toMatchObject({phase:'STEP',targetOnsetTick:15,fixedBpm:100});
  r.runtime.setStepContext(16);r.advance(25); expect(r.calls().at(-1)).toEqual({atMs:1550,accent:true});
  expect(r.runtime.planningCursor).toMatchObject({fixedBpm:80}); r.runtime.dispose();
});
it('Continuous mirrors count-in and resumes the exact remaining phase without a second count-in owner', () => {
  const r=rig();r.runtime.start({state:'COUNT_IN',scopeStartTick:0,timelineTimeMs:0,countInTotalMs:2000,countInRemainingMs:2000,countInPulses:4});
  r.advance(500);r.runtime.pause();const before=r.calls().length;r.advance(5000);expect(r.calls()).toHaveLength(before);
  r.runtime.resume({state:'COUNT_IN',scopeStartTick:0,timelineTimeMs:0,countInTotalMs:2000,countInRemainingMs:1000,countInPulses:4});
  r.advance(500);r.advance(500);r.advance(500);
  expect(r.calls()).toEqual([{atMs:0,accent:true},{atMs:500,accent:false},{atMs:5500,accent:false},
    {atMs:6000,accent:false},{atMs:6500,accent:true},{atMs:7000,accent:false}]); r.runtime.dispose();
});
it('Continuous RUNNING resume uses the exact fractional tick and never schedules while paused', () => {
  const r=rig();r.runtime.start({state:'RUNNING',timelineTimeMs:0.0});r.runtime.pause();r.advance(5000);
  r.runtime.resume({state:'RUNNING',timelineTimeMs:750.0});r.advance(200);
  expect(r.calls()).toEqual([{atMs:0,accent:true},{atMs:5250,accent:false}]);r.runtime.dispose();
});
it('stop/disposal clear the sole scheduling timer and late callbacks cannot resurrect runtime', () => {
  const r=rig('STEP'); const interval=vi.spyOn(globalThis,'setInterval');r.runtime.start(0);
  const callback=interval.mock.calls[0][0] as ()=>void;
  expect(vi.getTimerCount()).toBe(1);r.runtime.pause();expect(vi.getTimerCount()).toBe(0);
  r.runtime.resume(2);r.runtime.stop();expect(vi.getTimerCount()).toBe(0);
  r.runtime.dispose();r.runtime.dispose();const count=r.calls().length;
  callback();r.runtime.start(0);r.runtime.resume(0);r.runtime.setEnabled(true);r.runtime.setStepContext(1);
  expect(r.calls()).toHaveLength(count);expect(r.audio.dispose).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('optional audio activation, click and disposal faults cannot escape scheduling or cleanup', async () => {
  const r=rig();r.audio.activate.mockImplementation(()=>{throw new Error('audio');});
  r.audio.scheduleClick.mockImplementation(()=>{throw new Error('click');});
  r.audio.dispose.mockImplementation(()=>{throw new Error('close');});
  expect(()=>r.runtime.start({state:'RUNNING',timelineTimeMs:0.0})).not.toThrow();
  expect(()=>r.runtime.dispose()).not.toThrow();await Promise.resolve();
});
