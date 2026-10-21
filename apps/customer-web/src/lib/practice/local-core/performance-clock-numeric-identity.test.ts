import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from './artifact';
import { PerformanceClockRuntime } from './performance-runtime';
import { ManualClock, PracticeTimebase } from './timebase';

function setup(origin = 0, countInBeats = 0, scoreEndBeat = 1000000) {
  const clock = new ManualClock(origin);
  const artifact: PracticeScoreArtifact = { ...fixture as PracticeScoreArtifact,
    scoreEndBeat, scoreTempoSegments: [{ startBeat: 0, bpm: 120 }] };
  const runtime = new PerformanceClockRuntime({ artifact, scope: { kind: 'FULL' }, clock, countInBeats,
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 },
    timebase: new PracticeTimebase({ domainId: 'numeric-identity-test', runtimeOriginMs: origin }) });
  return { clock, runtime };
}

describe('PerformanceClock segment numeric identity', () => {
  it('preserves the exact V2 failing pause coordinate at immediate resume', () => {
    const { clock, runtime } = setup();
    runtime.start();
    clock.set(3610.7029478458053);
    const paused = runtime.pause();
    expect(paused.performanceTimeMs).toBe(3610.7029478458053);
    clock.set(5622.131519274377);
    const resumed = runtime.resume();
    expect(resumed.performanceTimeMs).toBe(paused.performanceTimeMs);
    expect(runtime.performanceTimeAtCapture(clock.nowMs())).toBe(paused.performanceTimeMs);
    expect(runtime.snapshot().performanceTimeMs).toBe(paused.performanceTimeMs);
  });

  for (const origin of [0, .123456789, 1000000000.2345678, 1000000000000.3457]) {
    it(`keeps exact anchors through 128 deterministic fractional cycles at origin ${origin}`, () => {
      const { clock, runtime } = setup(origin);
      runtime.start();
      let seed = 13371;
      const fraction = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      let now = origin;
      for (let i = 0; i < 128; i++) {
        now += 1 + fraction() * 2000; clock.set(now);
        const paused = runtime.pause();
        now += 1 + fraction() * 500; clock.set(now);
        const resumed = runtime.resume();
        expect(resumed.performanceTimeMs).toBe(paused.performanceTimeMs);
        expect(runtime.snapshot().performanceTimeMs).toBe(paused.performanceTimeMs);
        const sessionAnchor = runtime.timebase.runtimeToSessionTime(now).ms;
        expect(runtime.performanceTimeAtCapture(sessionAnchor)).toBe(paused.performanceTimeMs);
      }
    });
  }

  it('keeps the forward and inverse helpers exact at 1024 awkward segment anchors', () => {
    const { runtime } = setup();
    let seed = 13371;
    for (let i = 0; i < 1024; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const activeElapsedStartMs = 3610.7029478458053 + seed / 44100;
      const clockStartMs = 5622.131519274377 + (i % 2 ? 1e12 : i / 48000);
      const segment = { state: 'RUNNING' as const, activeElapsedStartMs, clockStartMs };
      expect(runtime['activeElapsedAtSessionTime'](segment, clockStartMs)).toBe(activeElapsedStartMs);
      expect(runtime['sessionTimeAtActiveElapsed'](segment, activeElapsedStartMs)).toBe(clockStartMs);
    }
  });

  it('preserves capture mapping at a resumed segment anchor and a local delta', () => {
    const { clock, runtime } = setup(); runtime.start();
    clock.set(3610.7029478458053); const paused = runtime.pause();
    clock.set(5622.131519274377); runtime.resume();
    const anchor = clock.nowMs(); clock.set(anchor + 123.456789);
    expect(runtime.performanceTimeAtCapture(anchor)).toBe(paused.performanceTimeMs);
    expect(runtime.performanceTimeAtCapture(clock.nowMs())).toBe(paused.performanceTimeMs + (clock.nowMs() - anchor));
    runtime.pause();
    expect(runtime.performanceTimeAtCapture(anchor)).toBe(paused.performanceTimeMs);
  });

  it('keeps count-in transition anchors and immediate pause/resume exact', () => {
    const { clock, runtime } = setup(1000000.123456789, 1);
    const start = runtime.start(); expect(start.state).toBe('COUNT_IN');
    clock.advance(500);
    const running = runtime.snapshot(); expect(running.state).toBe('RUNNING'); expect(running.performanceTimeMs).toBe(0);
    const paused = runtime.pause(); clock.advance(211.7029478458053);
    expect(runtime.resume().performanceTimeMs).toBe(paused.performanceTimeMs);
    expect(runtime.performanceTimeAtCapture(runtime.timebase.runtimeToSessionTime(clock.nowMs()).ms)).toBe(0);
  });

  it('manual Stop at a resumed anchor preserves the paused coordinate', () => {
    const { clock, runtime } = setup(); runtime.start();
    clock.set(3610.7029478458053); const paused = runtime.pause();
    clock.set(5622.131519274377); runtime.resume();
    const stopped = runtime.end('STOPPED_BY_USER');
    expect(stopped.performanceTimeMs).toBe(paused.performanceTimeMs);
    expect(stopped.completionReason).toBe('STOPPED_BY_USER');
    clock.advance(999); expect(runtime.snapshot().performanceTimeMs).toBe(stopped.performanceTimeMs);
  });

  it('natural completion inverse mapping uses the local active delta', () => {
    const { clock, runtime } = setup(0, 0, 12); runtime.start();
    clock.set(3610.7029478458053); const paused = runtime.pause();
    clock.set(5622.131519274377); runtime.resume();
    const expectedTerminalSessionMs = clock.nowMs() + (runtime.scopeDurationMs() - paused.performanceTimeMs);
    clock.set(expectedTerminalSessionMs + 1);
    const completed = runtime.snapshot();
    expect(completed.state).toBe('ENDED'); expect(completed.performanceTimeMs).toBe(6000);
    expect(completed.completionReason).toBe('SCOPE_COMPLETED');
    expect(runtime.completionCaptureTime().ms).toBe(expectedTerminalSessionMs);
  });
});
