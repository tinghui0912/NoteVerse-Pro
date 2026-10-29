import { describe, expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { StepAttemptIdentity } from '@/lib/practice/step/domain/attempt';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';

function setup() {
  const artifact = fixture as PracticeScoreArtifact, clock = new ManualClock(100), domainId = 'local-instance';
  const last = artifact.expectedPracticeGroups.at(-1)!.groupId;
  const runtime = new StepPracticeRuntime({ artifact, clock, localSessionId: domainId, inputSource: 'MIDI',
    metadataClock: { nowEpochMs: () => 12345 }, scope: { kind: 'RANGE', startGroupId: last, endGroupId: last } });
  const time = (ms: number) => ({ domainId, ms });
  const begin = () => runtime.openAttempt(time(200))!;
  const finish = (identity: StepAttemptIdentity) => {
    expect(runtime.analyzeAttempt(identity)).toBe(true);
    return runtime.completeAttempt(identity, { observedAttackPitches: ['D5'], confidence: 1, captureEndSessionTime: time(235) });
  };
  return { runtime, clock, time, begin, finish };
}

describe('local STEP domain status, independent of browser resources', () => {
  it('constructs ACTIVE with local instance identity and versioned snapshot', () => {
    const s = setup(), snapshot = s.runtime.snapshot();
    expect(s.runtime.state).toBe('ACTIVE');
    expect(snapshot).toMatchObject({ localSessionId: 'local-instance', runtimeStatus: 'ACTIVE', completionReason: null,
      version: { schemaVersion: 8, runtimeVersion: 'step-exact-pitch-learning-v11' }, step: { completed: false, attemptState: 'READY' } });
    expect(snapshot).not.toHaveProperty('lifecycleState');
    expect(snapshot.scoreId).toBe(fixture.scoreId);
    expect(snapshot.revisionId).toBe(fixture.revisionId); expect(snapshot.artifactId).toBe(fixture.artifactId);
    expect(snapshot.createdAtMs).toBe(12345); expect(snapshot.updatedAtMs).toBe(12345);
  });
  it('natural final MATCH consumes pending transition and ends only at rearm', () => {
    const s = setup(), id = s.begin(); s.finish(id);
    expect(s.runtime.snapshot()).toMatchObject({ runtimeStatus: 'ACTIVE', completionReason: null,
      step: { currentIndex: 4, targetGeneration: 1, completed: false, attemptState: 'POST_VERDICT', pendingPostVerdict: { verdict: 'MATCH' } } });
    s.runtime.rearm(s.time(400));
    const ended = s.runtime.snapshot();
    expect(ended).toMatchObject({ runtimeStatus: 'ENDED', completionReason: 'SCOPE_COMPLETED',
      step: { currentIndex: 5, targetGeneration: 2, completed: true, pendingPostVerdict: null } });
    s.runtime.end(); expect(s.runtime.snapshot()).toEqual(ended);
  });
  it('explicit Stop during POST_VERDICT retains finalized record but never commits pending MATCH', () => {
    const s = setup(), id = s.begin(); s.finish(id); const pending = s.runtime.snapshot().step.pendingPostVerdict;
    s.runtime.end();
    expect(s.runtime.snapshot()).toMatchObject({ runtimeStatus: 'ENDED', completionReason: 'STOPPED_BY_USER',
      step: { currentIndex: 4, targetGeneration: 1, completed: false, pendingPostVerdict: pending } });
    expect(s.runtime.snapshot().step.pendingPostVerdict).toBe(pending);
    expect(() => s.runtime.rearm(s.time(500))).toThrow('STEP_ATTEMPT_STATE_INVALID');
    expect(s.runtime.currentStepIndex).toBe(4);
  });
  it.each(['READY', 'CAPTURING', 'ANALYZING', 'POST_VERDICT', 'SCOPE_COMPLETED'] as const)('no attempt/input API revives terminal runtime after %s', terminalFrom => {
    const s = setup();
    const id = terminalFrom === 'READY' ? { attemptId: 'never-opened', localSessionId: 'local-instance',
      stepId: s.runtime.currentTarget()!.stepId, targetGeneration: 1, inputSource: 'MIDI' as const,
      attemptStartSessionTime: s.time(200) } : s.begin();
    if (terminalFrom === 'ANALYZING') s.runtime.analyzeAttempt(id);
    if (terminalFrom === 'POST_VERDICT' || terminalFrom === 'SCOPE_COMPLETED') s.finish(id);
    if (terminalFrom === 'SCOPE_COMPLETED') s.runtime.rearm(s.time(400)); else s.runtime.end();
    const ended = s.runtime.snapshot();
    expect(ended.runtimeStatus).toBe('ENDED');
    expect(ended.step.completed).toBe(terminalFrom === 'SCOPE_COMPLETED');
    expect(ended.completionReason).toBe(terminalFrom === 'SCOPE_COMPLETED' ? 'SCOPE_COMPLETED' : 'STOPPED_BY_USER');
    expect(s.runtime.currentTarget()).toBeNull(); expect(s.runtime.canAcceptAttempt).toBe(false);
    expect(s.runtime.openAttempt(s.time(500))).toBeNull(); expect(s.runtime.analyzeAttempt(id)).toBe(false);
    expect(s.runtime.completeAttempt(id, { confidence: 1, observedAttackPitches: ['D5'], captureEndSessionTime: s.time(535) }).kind).toBe('REJECTED');
    expect(() => s.runtime.rearm(s.time(600))).toThrow('STEP_ATTEMPT_STATE_INVALID');
    expect(s.runtime.skip()).toBe(false); s.runtime.setInputUnavailable();
    expect(() => s.runtime.acceptInputAfter(s.time(700))).toThrow('STEP_ATTEMPT_STATE_INVALID');
    s.runtime.end(); expect(s.runtime.snapshot()).toEqual(ended);
  });
});
