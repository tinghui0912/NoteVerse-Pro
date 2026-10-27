import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { leadingRestArtifact } from '@/lib/practice/__fixtures__/leading-rest-artifact';
import { PerformanceClockRuntime } from '@/lib/practice/continuous/domain/performance-clock';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { ManualClock, PracticeTimebase } from '@/lib/practice/kernel/timebase';
import { describe, expect, it } from 'vitest';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
function cloneArtifact(overrides: Partial<PracticeScoreArtifact> = {}): PracticeScoreArtifact {
  return structuredClone({ ...artifact, ...overrides });
}
describe('Continuous transport clock', () => {
  it('maps only already-reached RUNNING coordinates, including count-ins and multiple pause segments, without advancing', () => {
    const clock = new ManualClock();
    const runtime = new PerformanceClockRuntime({ artifact, tempoPlan: resolvePracticeTempoPlan(artifact, { mode: 'CUSTOM_FIXED_BPM', bpm: 120 }),
      scope: { kind: 'FULL' }, timebase: new PracticeTimebase({ domainId: 'inverse-clock' }), clock, countInBeats: 1 });
    runtime.start();
    expect(runtime.sessionTimeAtReachedPerformance(0)).toBeNull();
    clock.set(500);
    expect(runtime.snapshot().state).toBe('COUNT_IN');
    expect(runtime.sessionTimeAtReachedPerformance(0)).toBeNull();
    runtime.advanceToNow(); expect(runtime.sessionTimeAtReachedPerformance(0)?.ms).toBe(500);
    clock.set(1500); runtime.pause();
    expect(runtime.sessionTimeAtReachedPerformance(1000)?.ms).toBe(1500);
    clock.set(11500); const resume = runtime.resume();
    clock.advance(resume.countInTotalMs - 1);
    expect(runtime.sessionTimeAtReachedPerformance(1001)).toBeNull();
    runtime.pause(); // Cancel the countdown without opening a running interval.
    clock.advance(500); const secondResume = runtime.resume();
    clock.advance(secondResume.countInTotalMs + 250);
    expect(runtime.sessionTimeAtReachedPerformance(1250)).toBeNull();
    const running = runtime.advanceToNow();
    expect(running.performanceTimeMs).toBe(1250);
    expect(runtime.sessionTimeAtReachedPerformance(1000)?.ms).toBe(1500); // Earliest reach, before the pause.
    expect(runtime.sessionTimeAtReachedPerformance(1250)?.ms).toBe(running.nowMs);
    expect(runtime.sessionTimeAtReachedPerformance(1251)).toBeNull();
    for (const invalid of [-1, NaN, Infinity, 100000]) expect(runtime.sessionTimeAtReachedPerformance(invalid)).toBeNull();
  });
  it("counts in with the tempo at scope start after a leading rest", () => {
    const clock = new ManualClock(0);
    // ContinuousPracticeSession initialized with resolved scope:
    const tempoPlan = resolvePracticeTempoPlan(leadingRestArtifact, { mode: 'SCORE' });
    const perfRuntime = new PerformanceClockRuntime({
      timebase: new PracticeTimebase({ domainId: 'clock-contract' }),
      artifact: leadingRestArtifact,
      tempoPlan,
      scope: { kind: 'FULL' },
      clock,
      countInBeats: 4,
    });
    perfRuntime.start();
    const snap = perfRuntime.advanceToNow();
    expect(snap.state).toBe('COUNT_IN');
    expect(snap.scopeStartBeat).toBe(2.0);
    // At beat 2.0, tempo is 100 BPM. 4 beats at 100 BPM = 2400ms.
    expect(snap.countInTotalMs).toBe(2400);

    // Complete count-in:
    clock.advance(2401);
    expect(perfRuntime.advanceToNow().state).toBe('RUNNING');
    expect(perfRuntime.advanceToNow().musicalBeat).toBeCloseTo(2.0, 1);

  });

  it('supports CONTINUOUS user end vs SCOPE_COMPLETED natural completion', () => {
    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
    const runtime = new PerformanceClockRuntime({ timebase: new PracticeTimebase({ domainId: 'clock-contract' }), artifact, tempoPlan, scope: { kind: 'FULL' }, clock, countInBeats: 0 });
    runtime.start();
    expect(runtime.advanceToNow().state).toBe('RUNNING');
    expect(runtime.advanceToNow().scopeCompleted).toBe(false);
    expect(runtime.terminationReason).toBeNull();

    // User end
    const endedSnapshot = runtime.end('STOPPED_BY_USER');
    expect(endedSnapshot.state).toBe('ENDED');
    expect(endedSnapshot.scopeCompleted).toBe(false);
    expect(endedSnapshot.completionReason).toBe('STOPPED_BY_USER');
    expect(runtime.terminationReason).toBe('STOPPED_BY_USER');

    // Natural scope completion
    const rangeClock = new ManualClock(0);
    const naturalRuntime = new PerformanceClockRuntime({
      timebase: new PracticeTimebase({ domainId: 'clock-contract' }),
      artifact,
      tempoPlan,
      clock: rangeClock,
      countInBeats: 0,
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[0].groupId,
        endGroupId: artifact.expectedPracticeGroups[0].groupId,
      },
    });
    naturalRuntime.start();
    rangeClock.advance(10_000);
    const naturalSnapshot = naturalRuntime.advanceToNow();
    expect(naturalSnapshot.state).toBe('ENDED');
    expect(naturalSnapshot.scopeCompleted).toBe(true);
    expect(naturalSnapshot.completionReason).toBe('SCOPE_COMPLETED');
  });

  it('provides deterministic countInPulse and handles multi-tempo segments correctly', () => {
    const multiTempoArtifact = cloneArtifact({
      scoreTempoSegments: [
        { startBeat: 0, bpm: 120 },
        { startBeat: 4, bpm: 60 },
      ],
    });

    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(multiTempoArtifact, { mode: 'SCORE' });
    const runtime = new PerformanceClockRuntime({
      timebase: new PracticeTimebase({ domainId: 'clock-contract' }),
      artifact: multiTempoArtifact,
      tempoPlan,
      scope: { kind: 'FULL' },
      clock,
      countInBeats: 3,
    });

    runtime.start();
    let snapshot = runtime.advanceToNow();
    expect(snapshot.state).toBe('COUNT_IN');
    expect(snapshot.countInPulses).toBe(3);
    expect(snapshot.countInPulse).toBe(1);

    // Advance through count-in pulses (at 120 bpm, quarter note is 500ms)
    clock.advance(550);
    snapshot = runtime.advanceToNow();
    expect(snapshot.countInPulse).toBe(2);

    clock.advance(500);
    snapshot = runtime.advanceToNow();
    expect(snapshot.countInPulse).toBe(3);

    // Complete count-in (total count-in = 1500ms for 3 beats at 120 bpm)
    clock.advance(500);
    snapshot = runtime.advanceToNow();
    expect(snapshot.state).toBe('RUNNING');
    expect(snapshot.performanceTimeMs).toBe(50);

    // From beat 0 to 4 is at 120 BPM (500ms/beat). 4 beats = 2000ms performance time.
    // Advance to performance time 2000ms (clock advances another 1950ms)
    clock.advance(1950);
    snapshot = runtime.advanceToNow();
    expect(snapshot.performanceTimeMs).toBe(2000);
    expect(snapshot.musicalBeat).toBeCloseTo(4.0, 2);

    // After beat 4, tempo is 60 BPM (1000ms/beat).
    // Advancing performance time by 1000ms should advance beat by 1.0 (to beat 5.0).
    clock.advance(1000);
    snapshot = runtime.advanceToNow();
    expect(snapshot.performanceTimeMs).toBe(3000);
    expect(snapshot.musicalBeat).toBeCloseTo(5.0, 2);
  });
});

describe('meter-aware Resume Count-In', () => {
  it.each([3, 4])('%i/4 keeps performance/beat fixed until the resumed running boundary', beats => {
    const score = cloneArtifact({ meterSegments: [{ startBeat: 0, numerator: beats, denominator: 4, measureDurationBeats: beats, countInPulses: beats, source: 'MUSICXML' }] } as Partial<PracticeScoreArtifact>);
    const clock = new ManualClock(), runtime = new PerformanceClockRuntime({ artifact: score,
      tempoPlan: resolvePracticeTempoPlan(score, { mode: 'CUSTOM_FIXED_BPM', bpm: 120 }), scope: { kind: 'FULL' },
      clock, timebase: new PracticeTimebase({ domainId: 'resume' }), countInBeats: 1 });
    expect(runtime.start()).toMatchObject({ state: 'COUNT_IN', countInKind: 'INITIAL', performanceTimeMs: 0 });
    clock.advance(500); expect(runtime.advanceToNow().performanceTimeMs).toBe(0);
    clock.advance(125); const paused = runtime.pause(); clock.advance(1000);
    const countdown = runtime.resume();
    expect(countdown).toMatchObject({ state: 'COUNT_IN', countInKind: 'RESUME', countInBeats: beats,
      performanceTimeMs: paused.performanceTimeMs, musicalBeat: paused.musicalBeat });
    expect(countdown.countInTotalMs).toBe(beats * 500);
    clock.advance(countdown.countInTotalMs - 1);
    expect(runtime.advanceToNow()).toMatchObject({ state: 'COUNT_IN', performanceTimeMs: paused.performanceTimeMs, musicalBeat: paused.musicalBeat });
    expect(runtime.performanceTimeAtCapture(clock.nowMs())).toBeNull();
    clock.advance(1); expect(runtime.advanceToNow()).toMatchObject({ state: 'RUNNING', countInKind: null, performanceTimeMs: paused.performanceTimeMs });
    clock.advance(50); expect(runtime.advanceToNow().performanceTimeMs).toBe(paused.performanceTimeMs + 50);
    expect(runtime.performanceTimeAtCapture(clock.nowMs())).toBe(paused.performanceTimeMs + 50);
  });
  it('Pause cancels a resume countdown and End abandons without advancing frozen performance time', () => {
    const clock = new ManualClock(), runtime = new PerformanceClockRuntime({ artifact,
      tempoPlan: resolvePracticeTempoPlan(artifact, { mode: 'SCORE' }), scope: { kind: 'FULL' }, clock,
      timebase: new PracticeTimebase({ domainId: 'cancel' }), countInBeats: 0 });
    runtime.start(); clock.advance(100); runtime.pause(); runtime.resume(); clock.advance(500);
    expect(runtime.pause()).toMatchObject({ state: 'PAUSED', performanceTimeMs: 100 });
    clock.advance(5000); expect(runtime.advanceToNow().performanceTimeMs).toBe(100);
    runtime.resume(); clock.advance(100); expect(runtime.end()).toMatchObject({ state: 'ENDED', completionReason: 'STOPPED_BY_USER', performanceTimeMs: 100 });
  });
});
