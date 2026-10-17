import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from './artifact';
import { StepPracticeRuntime } from './step-runtime';
import { ManualClock } from './timebase';
import { MAX_STEP_HISTORY_RECORDS, type StepAttemptEvidence, type StepAttemptIdentity } from './step-attempt';

const artifact = fixture as PracticeScoreArtifact;
function setup(index = 0, id = 'step-test') {
  const clock = new ManualClock(100);
  const groupId = artifact.expectedPracticeGroups[index].groupId;
  const runtime = new StepPracticeRuntime({ artifact, clock, inputSource: 'MIDI', localSessionId: id,
    scope: { kind: 'RANGE', startGroupId: groupId, endGroupId: artifact.expectedPracticeGroups.at(-1)!.groupId } });
  const time = (ms = clock.nowMs()) => ({ domainId: id, ms });
  const begin = () => { clock.advance(100); return runtime.openAttempt(time())!; };
  const finish = (identity: StepAttemptIdentity, pitches: readonly string[]) => {
    runtime.analyzeAttempt(identity);
    return runtime.completeAttempt(identity, { kind: 'EVIDENCE', confidence: 1,
      observedAttackPitches: pitches, captureEndSessionTime: time(identity.attemptStartSessionTime.ms + 35) });
  };
  return { runtime, clock, time, begin, finish };
}
describe('one target / one bounded attempt / one verdict', () => {
  it.each([
    [0, ['C4'], 'MATCH'], [0, ['C#4'], 'MISMATCH'], [0, ['C5'], 'MISMATCH'],
    [3, ['A4'], 'MISMATCH'], [3, ['A4', 'C5', 'D5'], 'MISMATCH'],
    [3, ['C5', 'A4'], 'MATCH'], [3, ['G4'], 'MISMATCH'],
  ] as const)('target %s, gesture %j yields %s', (index, pitches, verdict) => {
    const { runtime, begin, finish } = setup(index), identity = begin();
    const result = finish(identity, pitches);
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { verdict, ...identity } });
    expect(runtime.currentStepIndex).toBe(index + (verdict === 'MATCH' ? 1 : 0));
    expect(runtime.snapshot().step.attempts).toHaveLength(1);
    expect(Object.isFrozen(runtime.snapshot().step.attempts[0].observedAttackPitches)).toBe(true);
    expect(finish(identity, pitches)).toMatchObject({ kind: 'REJECTED' });
    expect(runtime.snapshot().step.attempts).toHaveLength(1);
  });
  it('partial pitches never accumulate; mismatch then a fresh correct attempt', () => {
    const { runtime, begin, finish } = setup(3);
    finish(begin(), ['A4']); runtime.rearm(); finish(begin(), ['C5']);
    expect(runtime.currentStepIndex).toBe(3);
    runtime.rearm(); finish(begin(), ['A4', 'C5']);
    expect(runtime.currentStepIndex).toBe(4);
    expect(runtime.snapshot().step.attempts.map(r => r.verdict)).toEqual(['MISMATCH', 'MISMATCH', 'MATCH']);
  });
  it('repeated notes need new identity and RESET is explicit backpressure', () => {
    const { runtime, begin, finish, time } = setup(), first = begin();
    expect(runtime.openAttempt(time(205))).toBeNull();
    finish(first, ['C4']); expect(runtime.snapshot().step.attemptState).toBe('RESET');
    expect(runtime.openAttempt(time(240))).toBeNull(); runtime.rearm();
    const second = begin(); expect(second.attemptId).not.toBe(first.attemptId);
    finish(second, ['C4']); expect(runtime.currentStepIndex).toBe(2);
  });
  it.each(['UNCERTAIN', 'TOO_QUIET'] as const)('RETRY %s records without advancing', reason => {
    const { runtime, begin, time } = setup(), identity = begin(); runtime.analyzeAttempt(identity);
    expect(runtime.completeAttempt(identity, { kind: 'RETRY', reason, captureEndSessionTime: time(235) }))
      .toMatchObject({ kind: 'FINALIZED', record: { verdict: 'RETRY', retryReason: reason, confidence: null } });
    expect(runtime.currentStepIndex).toBe(0); expect(runtime.snapshot().step.attemptState).toBe('RESET');
    runtime.rearm(); expect(runtime.snapshot().step.attemptState).toBe('READY');
  });
  it.each(['pause', 'skip', 'end'] as const)('%s invalidates active capture and late analysis', command => {
    const { runtime, begin, finish } = setup(), old = begin(); runtime[command]();
    expect(finish(old, ['C4'])).toMatchObject({ kind: 'REJECTED' });
    expect(runtime.snapshot().step.attempts).toHaveLength(0);
    expect(runtime.snapshot().step.activeAttempt).toBeNull();
    expect(runtime.snapshot().step.skips).toHaveLength(command === 'skip' ? 1 : 0);
  });
  it('resume uses same target and a fresh generation; old session cannot complete', () => {
    const a = setup(), identity = a.begin(); a.runtime.pause(); a.runtime.resume();
    const next = a.begin(); expect(next.stepId).toBe(identity.stepId);
    expect(next.activationGeneration).toBeGreaterThan(identity.activationGeneration);
    expect(a.finish(identity, ['C4']).kind).toBe('REJECTED');
    const b = setup(0, 'restart'); b.begin(); expect(b.finish(identity, ['C4']).kind).toBe('REJECTED');
  });
  it('finish never fabricates a verdict and is idempotent', () => {
    const { runtime, begin } = setup(); begin(); runtime.end(); const snapshot = runtime.snapshot(); runtime.end();
    expect(runtime.snapshot().step).toEqual(snapshot.step); expect(snapshot.step.attempts).toEqual([]);
    expect(snapshot.completionReason).toBe('STOPPED_BY_USER');
  });
  it('scope completion, separate skip history, v2 snapshot, immutable output', () => {
    const { runtime, begin, finish } = setup(4); finish(begin(), ['D5']);
    expect(runtime.snapshot()).toMatchObject({ version: { schemaVersion: 2, runtimeVersion: 'step-bounded-attempt-v2' },
      lifecycleState: 'ENDED', completionReason: 'SCOPE_COMPLETED', step: { completed: true } });
    expect(runtime.currentTarget()).toBeNull(); expect(runtime.skip()).toBe(false);
  });
  it('rejects stale source time, foreign domain, invalid confidence and forged identity', () => {
    const s = setup(); expect(s.runtime.openAttempt(s.time(99))).toBeNull();
    expect(() => s.runtime.openAttempt({ domainId: 'other', ms: 200 })).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    const id = s.begin(); s.runtime.analyzeAttempt(id);
    const evidence: StepAttemptEvidence = { kind: 'EVIDENCE', observedAttackPitches: ['C4'], confidence: NaN, captureEndSessionTime: s.time(235) };
    expect(() => s.runtime.completeAttempt(id, evidence)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(s.runtime.completeAttempt({ ...id, inputSource: 'MICROPHONE' }, { ...evidence, confidence: 1 }).kind).toBe('REJECTED');
  });
  it('history ceiling fails before opening another attempt, retaining every record', () => {
    const s = setup();
    for (let i = 0; i < MAX_STEP_HISTORY_RECORDS; i++) { s.finish(s.begin(), ['D4']); s.runtime.rearm(); }
    expect(() => s.begin()).toThrow('STEP_HISTORY_LIMIT_EXCEEDED');
    const result = s.runtime.snapshot();
    expect(result.lifecycleState).toBe('ENDED'); expect(result.step.activeAttempt).toBeNull();
    expect(result.step.attempts.length).toBe(MAX_STEP_HISTORY_RECORDS);
    expect(result.step.attempts[0].attemptId).toBe('step-test:attempt:1');
  });
  it('deterministic many-cycle activation property: one result, no cross-generation or partial carry', () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = setup(3, `property-${seed}`);
      for (let cycle = 0; cycle < 10; cycle++) {
        const stale = s.begin(); s.runtime.pause(); s.runtime.resume();
        expect(s.finish(stale, ['A4','C5']).kind).toBe('REJECTED');
        s.finish(s.begin(), cycle % 2 ? ['A4'] : ['C5']); s.runtime.rearm();
        expect(s.runtime.currentStepIndex).toBe(3);
      }
      const id = s.begin(); s.finish(id, ['C5','A4']);
      expect(s.runtime.currentStepIndex).toBe(4); expect(s.finish(id, ['A4','C5']).kind).toBe('REJECTED');
      expect(s.runtime.snapshot().step.attempts).toHaveLength(11);
    }
  });
});
