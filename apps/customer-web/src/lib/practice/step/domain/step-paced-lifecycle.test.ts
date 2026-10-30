import { stepSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { describe, expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';

function setup(final = false) {
  const clock = new ManualClock(0), domainId = 'paced';
  const time = (ms: number) => ({ domainId, ms });
  const artifact = fixture as PracticeScoreArtifact;
  const runtime = new StepPracticeRuntime({ ...stepSessionPlan(artifact, { scope: final ? { kind: 'RANGE', startGroupId: artifact.moments.at(-1)!.groupId,
      endGroupId: artifact.moments.at(-1)!.groupId } : { kind: 'FULL' }, inputSource: 'MICROPHONE' }), clock, localSessionId: domainId });
  const start = () => runtime.openAttempt(time(100))!;
  const finish = (verdict: 'MATCH' | 'MISMATCH' = 'MATCH') => {
    const id = start(); runtime.analyzeAttempt(id);
    const expected = runtime.currentTarget()!.attackKeys;
    runtime.completeAttempt(id, { confidence: 1, observedAttackKeys: verdict === 'MATCH'
      ? [expected[0], ...expected.slice(1)] : [61],
      captureEndSessionTime: time(135) });
    return id;
  };
  return { runtime, clock, time, start, finish };
}

describe('paced single-attempt commit boundary', () => {
  it('READY alone opens; no second identity, queue, early skip or cross-target carryover', () => {
    const s = setup(), target = s.runtime.currentTarget()!, id = s.start();
    for (const phase of ['CAPTURING', 'ANALYZING', 'POST_VERDICT']) {
      expect(s.runtime.snapshot().step.attemptState).toBe(phase);
      expect(s.runtime.canAcceptAttempt).toBe(false);
      expect(s.runtime.openAttempt(s.time(200))).toBeNull();
      expect(s.runtime.skip()).toBe(false);
      expect(s.runtime.currentTarget()!.stepId).toBe(target.stepId);
      if (phase === 'CAPTURING') s.runtime.analyzeAttempt(id);
      if (phase === 'ANALYZING') s.runtime.completeAttempt(id, { observedAttackKeys: [60], confidence: 1, captureEndSessionTime: s.time(135) });
    }
    const immutable = s.runtime.snapshot();
    s.runtime.rearm(s.time(500));
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'READY', currentIndex: 1, targetGeneration: 2, activeAttempt: null, pendingPostVerdict: null, canAcceptAttempt: true });
    expect(immutable.step).toMatchObject({ attemptState: 'POST_VERDICT', currentIndex: 0, targetGeneration: 1 });
    expect(Object.isFrozen(immutable.step.pendingPostVerdict)).toBe(true);
    for (const ms of [100, 200, 499, 500]) expect(s.runtime.openAttempt(s.time(ms))).toBeNull();
    expect(s.runtime.snapshot().step.activeAttempt).toBeNull();
    expect(() => s.runtime.rearm(s.time(500))).toThrow('STEP_ATTEMPT_STATE_INVALID');
    const next = s.runtime.openAttempt(s.time(501))!;
    expect(next.attemptId).not.toBe(id.attemptId); expect(next.targetGeneration).toBe(2);
  });
  it.each(['MISMATCH'] as const)('%s retains answered target through explicit retirement', verdict => {
    const s = setup(), target = s.runtime.currentTarget()!; s.finish(verdict);
    expect(s.runtime.currentTarget()!.stepId).toBe(target.stepId);
    s.runtime.rearm(s.time(500));
    expect(s.runtime.currentTarget()).toMatchObject({ stepId: target.stepId, targetGeneration: target.targetGeneration });
    expect(s.runtime.canAcceptAttempt).toBe(true);
  });
  it('final MATCH ends scope only at retirement, once, without double generation increment', () => {
    const s = setup(true), target = s.runtime.currentTarget()!; s.finish();
    expect(s.runtime.state).toBe('ACTIVE'); expect(s.runtime.isCompleted).toBe(false);
    expect(s.runtime.currentTarget()!.stepId).toBe(target.stepId);
    s.runtime.rearm(s.time(500)); const snapshot = s.runtime.snapshot();
    expect(snapshot.completionReason).toBe('SCOPE_COMPLETED'); expect(s.runtime.currentTarget()).toBeNull();
    expect(snapshot.step.targetGeneration).toBe(target.targetGeneration + 1);
    expect(() => s.runtime.rearm(s.time(600))).toThrow('STEP_ATTEMPT_STATE_INVALID');
    s.runtime.end(); expect(s.runtime.snapshot().step).toEqual(snapshot.step);
  });
  it.each(['MATCH', 'MISMATCH'] as const)('disconnect never erases finalized %s and reconnect does not implicitly commit it', verdict => {
    const s = setup(); s.finish(verdict); const before = s.runtime.snapshot();
    s.runtime.setInputUnavailable(); s.runtime.setInputUnavailable();
    expect(s.runtime.snapshot().step.pendingPostVerdict).toBe(before.step.pendingPostVerdict);
    expect(s.runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    s.runtime.acceptInputAfter(s.time(500));
    expect(s.runtime.currentStepIndex).toBe(0); expect(s.runtime.canAcceptAttempt).toBe(false);
    s.runtime.rearm(s.time(500));
    expect(s.runtime.currentStepIndex).toBe(verdict === 'MATCH' ? 1 : 0);
    expect(s.runtime.snapshot().step.pendingPostVerdict).toBeNull();
    expect(() => s.runtime.rearm(s.time(501))).toThrow('STEP_ATTEMPT_STATE_INVALID');
  });
  it.each(['READY', 'CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const)('disconnect/reconnect in %s preserves only finalized ownership', phase => {
    const s = setup(), target = s.runtime.currentTarget()!;
    const id = phase === 'POST_VERDICT' ? s.finish() : phase !== 'READY' ? s.start() : null;
    if (phase === 'ANALYZING') s.runtime.analyzeAttempt(id!);
    const pending = s.runtime.snapshot().step.pendingPostVerdict;
    s.runtime.setInputUnavailable();
    expect(s.runtime.canAcceptAttempt).toBe(false); expect(s.runtime.openAttempt(s.time(300))).toBeNull();
    expect(s.runtime.snapshot().step.activeAttempt).toBeNull();
    expect(s.runtime.currentTarget()!.stepId).toBe(target.stepId);
    if (phase === 'POST_VERDICT') {
      expect(s.runtime.snapshot().step.pendingPostVerdict).toBe(pending);
      expect(s.runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
      expect(() => s.runtime.rearm(s.time(400))).toThrow('STEP_ATTEMPT_STATE_INVALID');
    }
    s.runtime.acceptInputAfter(s.time(500));
    if (id) expect(s.runtime.completeAttempt(id, { observedAttackKeys: [60], confidence: 1, captureEndSessionTime: s.time(535) }).kind).toBe('REJECTED');
    if (phase === 'POST_VERDICT') {
      expect(s.runtime.canAcceptAttempt).toBe(false);
      expect(s.runtime.currentTarget()!.targetGeneration).toBe(1);
      s.runtime.rearm(s.time(500));
    }
    expect(s.runtime.snapshot().step.pendingPostVerdict).toBeNull();
    expect(s.runtime.currentTarget()!.targetGeneration).toBe(phase === 'POST_VERDICT' ? 2 : 1);
    for (const ms of [100, 300, 500]) expect(s.runtime.openAttempt(s.time(ms))).toBeNull();
    expect(s.runtime.openAttempt(s.time(501))).not.toBeNull();
  });
});
