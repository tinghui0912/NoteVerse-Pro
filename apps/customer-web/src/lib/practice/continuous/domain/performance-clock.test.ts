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
    const snap = perfRuntime.snapshot();
    expect(snap.state).toBe('COUNT_IN');
    expect(snap.scopeStartBeat).toBe(2.0);
    // At beat 2.0, tempo is 100 BPM. 4 beats at 100 BPM = 2400ms.
    expect(snap.countInTotalMs).toBe(2400);

    // Complete count-in:
    clock.advance(2401);
    expect(perfRuntime.snapshot().state).toBe('RUNNING');
    expect(perfRuntime.snapshot().musicalBeat).toBeCloseTo(2.0, 1);

  });

  it('supports CONTINUOUS user end vs SCOPE_COMPLETED natural completion', () => {
    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
    const runtime = new PerformanceClockRuntime({ timebase: new PracticeTimebase({ domainId: 'clock-contract' }), artifact, tempoPlan, scope: { kind: 'FULL' }, clock, countInBeats: 0 });
    runtime.start();
    expect(runtime.snapshot().state).toBe('RUNNING');
    expect(runtime.snapshot().scopeCompleted).toBe(false);
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
    const naturalSnapshot = naturalRuntime.snapshot();
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
    let snapshot = runtime.snapshot();
    expect(snapshot.state).toBe('COUNT_IN');
    expect(snapshot.countInPulses).toBe(3);
    expect(snapshot.countInPulse).toBe(1);

    // Advance through count-in pulses (at 120 bpm, quarter note is 500ms)
    clock.advance(550);
    snapshot = runtime.snapshot();
    expect(snapshot.countInPulse).toBe(2);

    clock.advance(500);
    snapshot = runtime.snapshot();
    expect(snapshot.countInPulse).toBe(3);

    // Complete count-in (total count-in = 1500ms for 3 beats at 120 bpm)
    clock.advance(500);
    snapshot = runtime.snapshot();
    expect(snapshot.state).toBe('RUNNING');
    expect(snapshot.performanceTimeMs).toBe(50);

    // From beat 0 to 4 is at 120 BPM (500ms/beat). 4 beats = 2000ms performance time.
    // Advance to performance time 2000ms (clock advances another 1950ms)
    clock.advance(1950);
    snapshot = runtime.snapshot();
    expect(snapshot.performanceTimeMs).toBe(2000);
    expect(snapshot.musicalBeat).toBeCloseTo(4.0, 2);

    // After beat 4, tempo is 60 BPM (1000ms/beat).
    // Advancing performance time by 1000ms should advance beat by 1.0 (to beat 5.0).
    clock.advance(1000);
    snapshot = runtime.snapshot();
    expect(snapshot.performanceTimeMs).toBe(3000);
    expect(snapshot.musicalBeat).toBeCloseTo(5.0, 2);
  });
});
