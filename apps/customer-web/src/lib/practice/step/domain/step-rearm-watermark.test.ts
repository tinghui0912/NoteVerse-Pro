import { describe, expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';

function harness() {
  const clock = new ManualClock(0), domainId = 'watermark';
  const time = (ms: number) => ({ domainId, ms });
  const runtime = new StepPracticeRuntime({ artifact: fixture as PracticeScoreArtifact,
    scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', localSessionId: domainId, clock });
  const finish = (kind: 'MATCH' | 'MISMATCH') => {
    const identity = runtime.openAttempt(time(100))!;
    expect(runtime.openAttempt(time(110))).toBeNull();
    runtime.analyzeAttempt(identity);
    expect(runtime.openAttempt(time(130))).toBeNull();
    return runtime.completeAttempt(identity, { confidence: 1,
      observedAttackKeys: [kind === 'MATCH' ? 60 : 62], captureEndSessionTime: time(135) });
  };
  return { runtime, clock, time, finish };
}
describe('explicit STEP accepted-input watermark', () => {
  it.each(['MATCH', 'MISMATCH'] as const)('%s cannot carry busy/late evidence across re-arm', verdict => {
    const s = harness(); s.finish(verdict);
    expect(s.runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    expect(s.runtime.openAttempt(s.time(700))).toBeNull();
    const watermark = s.time(700); s.runtime.rearm(watermark); watermark.ms = 1;
    expect(s.runtime.currentTarget()!.inputEligibleAfter.ms).toBe(700);
    for (const stale of [100, 135, 500, 700]) expect(s.runtime.openAttempt(s.time(stale))).toBeNull();
    expect(s.runtime.openAttempt(s.time(701))!.targetGeneration).toBe(verdict === 'MATCH' ? 2 : 1);
    expect(s.runtime.currentStepIndex).toBe(verdict === 'MATCH' ? 1 : 0);
    expect(s.runtime.snapshot().step.pendingPostVerdict).toBeNull();
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
    expect(s.runtime.currentStepIndex).toBe(1);
    expect(s.runtime.currentTarget()!.inputEligibleAfter.ms).toBe(700);
    expect(s.runtime.openAttempt(s.time(700))).toBeNull();
    expect(s.runtime.openAttempt(s.time(701))).not.toBeNull();
  });
  it('physical skip uses an immutable capture boundary rather than the later live clock', () => {
    const s = harness(); s.finish('MISMATCH'); s.runtime.rearm(s.time(700));
    s.clock.set(9000);
    const boundary = { ...s.time(800), sampleIndex: 38400 };
    expect(s.runtime.skip(boundary)).toBe(true); boundary.ms = 1;
    expect(s.runtime.currentTarget()!.inputEligibleAfter.ms).toBe(800);
    expect(s.runtime.snapshot().step.inputEligibleAfter).toEqual({ ...s.time(800), sampleIndex: 38400 });
    expect(s.runtime.openAttempt(s.time(800))).toBeNull();
    expect(s.runtime.openAttempt(s.time(801))).not.toBeNull();
  });
  it('rejects invalid physical skip boundaries before changing the target', () => {
    const s = harness(); s.finish('MISMATCH'); s.runtime.rearm(s.time(700));
    for (const boundary of [s.time(699), s.time(NaN), { domainId: 'foreign', ms: 800 }]) {
      expect(() => s.runtime.skip(boundary)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
      expect(s.runtime.currentStepIndex).toBe(0); expect(s.runtime.snapshot().step.targetGeneration).toBe(1);
      expect(s.runtime.canAcceptAttempt).toBe(true);
    }
  });
});
