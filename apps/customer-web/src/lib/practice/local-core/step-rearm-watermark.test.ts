import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from './artifact';
import { StepPracticeRuntime } from './step-runtime';
import { ManualClock } from './timebase';

function harness() {
  const clock = new ManualClock(0), domainId = 'watermark';
  const time = (ms: number) => ({ domainId, ms });
  const runtime = new StepPracticeRuntime({ artifact: fixture as PracticeScoreArtifact,
    scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', localSessionId: domainId, clock });
  const finish = (kind: 'MATCH' | 'MISMATCH' | 'RETRY') => {
    const identity = runtime.openAttempt(time(100))!;
    expect(runtime.openAttempt(time(110))).toBeNull();
    runtime.analyzeAttempt(identity);
    expect(runtime.openAttempt(time(130))).toBeNull();
    return runtime.completeAttempt(identity, kind === 'RETRY'
      ? { kind: 'RETRY', reason: 'UNCERTAIN', captureEndSessionTime: time(135) }
      : { kind: 'EVIDENCE', confidence: 1, observedAttackPitches: [kind === 'MATCH' ? 'C4' : 'D4'], captureEndSessionTime: time(135) });
  };
  return { runtime, clock, time, finish };
}
describe('explicit STEP accepted-input watermark', () => {
  it.each(['MATCH', 'MISMATCH', 'RETRY'] as const)('%s cannot carry busy/late evidence across re-arm', verdict => {
    const s = harness(); s.finish(verdict);
    expect(s.runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    expect(s.runtime.openAttempt(s.time(700))).toBeNull();
    const watermark = s.time(700); s.runtime.rearm(watermark); watermark.ms = 1;
    expect(s.runtime.currentTarget()!.inputEligibleAfter.ms).toBe(700);
    for (const stale of [100, 135, 500, 700]) expect(s.runtime.openAttempt(s.time(stale))).toBeNull();
    expect(s.runtime.openAttempt(s.time(701))!.targetGeneration).toBe(verdict === 'MATCH' ? 2 : 1);
    expect(s.runtime.currentStepIndex).toBe(verdict === 'MATCH' ? 1 : 0);
    expect(s.runtime.snapshot().step.attempts).toHaveLength(1);
  });
  it('rejects foreign/nonfinite/backward watermark without leaving POST_VERDICT', () => {
    const s = harness(); s.finish('MISMATCH');
    for (const invalid of [{ domainId: 'foreign', ms: 700 }, s.time(NaN), s.time(Infinity), s.time(134)]) {
      expect(() => s.runtime.rearm(invalid)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
      expect(s.runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    }
    s.runtime.rearm(s.time(135)); expect(s.runtime.openAttempt(s.time(135))).toBeNull();
    expect(s.runtime.openAttempt(s.time(136))).not.toBeNull();
  });
  it('requires POST_VERDICT and ACTIVE, never reads implicit now to re-arm', () => {
    const s = harness(); expect(() => s.runtime.rearm(s.time(0))).toThrow('STEP_ATTEMPT_STATE_INVALID');
    s.finish('MISMATCH'); s.clock.set(9000); s.runtime.rearm(s.time(500));
    expect(s.runtime.currentTarget()!.inputEligibleAfter.ms).toBe(500);
    s.runtime.end(); expect(() => s.runtime.rearm(s.time(9000))).toThrow('STEP_ATTEMPT_STATE_INVALID');
  });
  it('reconnect and skip cannot revive input already retired by an explicit watermark', () => {
    const s = harness(); s.finish('MISMATCH'); s.runtime.rearm(s.time(700));
    s.clock.set(400); s.runtime.setInputUnavailable();
    expect(() => s.runtime.acceptInputAfter(s.time(400))).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    s.runtime.acceptInputAfter(s.time(700));
    expect(s.runtime.currentTarget()!.inputEligibleAfter.ms).toBe(700);
    s.clock.set(500); s.runtime.skip();
    expect(s.runtime.snapshot().step.skips[0].sessionTime.ms).toBe(500);
    expect(s.runtime.currentTarget()!.inputEligibleAfter.ms).toBe(700);
    expect(s.runtime.openAttempt(s.time(700))).toBeNull();
    expect(s.runtime.openAttempt(s.time(701))).not.toBeNull();
  });
});
