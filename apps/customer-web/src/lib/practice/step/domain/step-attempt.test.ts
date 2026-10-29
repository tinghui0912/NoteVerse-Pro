import { describe, expect, expectTypeOf, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { type StepPitchEvidence, type StepAttemptIdentity, type StepAttemptRecord } from '@/lib/practice/step/domain/attempt';

const artifact = fixture as PracticeScoreArtifact;
function rearmAtCaptureEnd(runtime: StepPracticeRuntime) {
  const record = runtime.snapshot().step.pendingPostVerdict;
  if (!record) throw Error('Expected a pending answer before rearm');
  runtime.rearm(record.captureEndSessionTime);
}
function setup(index = 0, id = 'step-test', inputSource: 'MIDI' | 'MICROPHONE' = 'MIDI') {
  const clock = new ManualClock(100);
  const groupId = artifact.expectedPracticeGroups[index].groupId;
  const runtime = new StepPracticeRuntime({ artifact, clock, inputSource, localSessionId: id,
    scope: { kind: 'RANGE', startGroupId: groupId, endGroupId: artifact.expectedPracticeGroups.at(-1)!.groupId } });
  const time = (ms = clock.nowMs()) => ({ domainId: id, ms });
  const begin = () => { clock.advance(100); return runtime.openAttempt(time())!; };
  const finish = (identity: StepAttemptIdentity, pitches: StepPitchEvidence['observedAttackPitches']) => {
    runtime.analyzeAttempt(identity);
    return runtime.completeAttempt(identity, { confidence: 1,
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
    expect(runtime.currentStepIndex).toBe(index);
    expect(runtime.currentTarget()?.targetGeneration).toBe(identity.targetGeneration);
    expect(runtime.snapshot().step.pendingPostVerdict).toBe(result.kind === 'FINALIZED' ? result.record : null);
    rearmAtCaptureEnd(runtime);
    expect(runtime.currentStepIndex).toBe(index + (verdict === 'MATCH' ? 1 : 0));
    expect(Object.isFrozen(result.kind === 'FINALIZED' && result.record.observedAttackPitches)).toBe(true);
    expect(finish(identity, pitches)).toMatchObject({ kind: 'REJECTED' });
    expect(runtime.snapshot().step.pendingPostVerdict).toBeNull();
  });
  it('partial pitches never accumulate; mismatch then a fresh correct attempt', () => {
    const { runtime, begin, finish } = setup(3);
    const first = finish(begin(), ['A4']); rearmAtCaptureEnd(runtime); const second = finish(begin(), ['C5']);
    expect(runtime.currentStepIndex).toBe(3);
    rearmAtCaptureEnd(runtime); const third = finish(begin(), ['A4', 'C5']); rearmAtCaptureEnd(runtime);
    expect(runtime.currentStepIndex).toBe(4);
    expect([first, second, third].map(r => r.kind === 'FINALIZED' ? r.record.verdict : r.kind)).toEqual(['MISMATCH', 'MISMATCH', 'MATCH']);
  });
  it('repeated notes need new identity and POST_VERDICT is explicit backpressure', () => {
    const { runtime, begin, finish, time } = setup(), first = begin();
    expect(runtime.openAttempt(time(205))).toBeNull();
    finish(first, ['C4']); expect(runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    expect(runtime.openAttempt(time(240))).toBeNull(); rearmAtCaptureEnd(runtime);
    const second = begin(); expect(second.attemptId).not.toBe(first.attemptId);
    finish(second, ['C4']); rearmAtCaptureEnd(runtime); expect(runtime.currentStepIndex).toBe(2);
  });
  it('non-exact microphone input preserves pitch evidence and stays on the answered target', () => {
    const { runtime, begin, time } = setup(0, 'non-exact', 'MICROPHONE'), identity = begin(); runtime.analyzeAttempt(identity);
    const evidence: StepPitchEvidence = { observedAttackPitches: ['C4','G4'], confidence: .45, captureEndSessionTime: time(250) };
    const result = runtime.completeAttempt(identity, evidence);
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { ...identity, ...evidence, verdict: 'MISMATCH' } });
    expect(runtime.currentStepIndex).toBe(0); expect(runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    rearmAtCaptureEnd(runtime); expect(runtime.snapshot().step.attemptState).toBe('READY');
    expect(runtime.currentStepIndex).toBe(0); expect(runtime.currentTarget()!.targetGeneration).toBe(identity.targetGeneration);
  });
  it.each(['setInputUnavailable', 'end'] as const)('%s invalidates active capture and late analysis', command => {
    const { runtime, begin, finish } = setup(), old = begin(); runtime[command]();
    expect(finish(old, ['C4'])).toMatchObject({ kind: 'REJECTED' });
    expect(runtime.snapshot().step.pendingPostVerdict).toBeNull();
    expect(runtime.snapshot().step.activeAttempt).toBeNull();
  });
  it('input return preserves target generation; old attempt and session cannot complete', () => {
    const a = setup(), identity = a.begin(); a.runtime.setInputUnavailable(); a.runtime.acceptInputAfter(a.time());
    const next = a.begin(); expect(next.stepId).toBe(identity.stepId);
    expect(next.targetGeneration).toBe(identity.targetGeneration);
    expect(a.finish(identity, ['C4']).kind).toBe('REJECTED');
    const b = setup(0, 'restart'); b.begin(); expect(b.finish(identity, ['C4']).kind).toBe('REJECTED');
  });
  it('finish never fabricates a verdict and is idempotent', () => {
    const { runtime, begin } = setup(); begin(); runtime.end(); const snapshot = runtime.snapshot(); runtime.end();
    expect(runtime.snapshot().step).toEqual(snapshot.step); expect(snapshot.step.pendingPostVerdict).toBeNull();
    expect(snapshot.completionReason).toBe('STOPPED_BY_USER');
  });
  it('final MATCH waits in POST_VERDICT; scope ends once at rearm, immutable session snapshot', () => {
    const { runtime, begin, finish } = setup(4); finish(begin(), ['D5']);
    expect(runtime.isCompleted).toBe(false);
    expect(runtime.currentStepIndex).toBe(4);
    expect(runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    rearmAtCaptureEnd(runtime);
    expect(() => runtime.rearm({ domainId: runtime.localSessionId, ms: 0 })).toThrow('STEP_ATTEMPT_STATE_INVALID');
    expect(runtime.snapshot()).toMatchObject({ version: { schemaVersion: 8, runtimeVersion: 'step-exact-pitch-learning-v9' },
      runtimeStatus: 'ENDED', completionReason: 'SCOPE_COMPLETED', step: { completed: true } });
    expect(runtime.currentTarget()).toBeNull(); expect(runtime.skip()).toBe(false);
  });
  it('rejects stale source time, foreign domain, invalid confidence and forged identity', () => {
    const s = setup(); expect(s.runtime.openAttempt(s.time(99))).toBeNull();
    expect(() => s.runtime.openAttempt({ domainId: 'other', ms: 200 })).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    const id = s.begin(); s.runtime.analyzeAttempt(id);
    const evidence: StepPitchEvidence = { observedAttackPitches: ['C4'], confidence: NaN, captureEndSessionTime: s.time(235) };
    expect(() => s.runtime.completeAttempt(id, evidence)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(s.runtime.completeAttempt({ ...id, inputSource: 'MICROPHONE' }, { ...evidence, confidence: 1 }).kind).toBe('REJECTED');
  });
  it('deterministic many-cycle input outage: one result, no stale attempt or partial carry', () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = setup(3, `property-${seed}`);
      for (let cycle = 0; cycle < 10; cycle++) {
        const stale = s.begin(); s.runtime.setInputUnavailable(); s.runtime.acceptInputAfter(s.time());
        expect(s.finish(stale, ['A4','C5']).kind).toBe('REJECTED');
        s.finish(s.begin(), cycle % 2 ? ['A4'] : ['C5']); rearmAtCaptureEnd(s.runtime);
        expect(s.runtime.currentStepIndex).toBe(3);
      }
      const id = s.begin(); s.finish(id, ['C5','A4']); rearmAtCaptureEnd(s.runtime);
      expect(s.runtime.currentStepIndex).toBe(4); expect(s.finish(id, ['A4','C5']).kind).toBe('REJECTED');
      expect(s.runtime.snapshot().step.pendingPostVerdict).toBeNull();
    }
  });
});


describe('STEP evidence and outcome integrity', () => {
  it('only permits nonempty evidence and the two learning outcomes', () => {
    expectTypeOf<[]>().not.toExtend<StepPitchEvidence['observedAttackPitches']>();
    expectTypeOf<StepAttemptRecord['confidence']>().toEqualTypeOf<number>();
    expectTypeOf<StepAttemptRecord['verdict']>().toEqualTypeOf<'MATCH' | 'MISMATCH'>();
    expectTypeOf<keyof StepAttemptRecord>().toEqualTypeOf<keyof StepAttemptIdentity | keyof StepPitchEvidence | 'verdict'>();
  });
  it.each<[string, Record<string, unknown>]>([
    ['empty pitch list', { observedAttackPitches: [] }],
    ['too many pitch entries', { observedAttackPitches: Array(129).fill('C4') }],
    ['missing pitch list', { observedAttackPitches: undefined }],
    ['non-array pitch list', { observedAttackPitches: 'C4' }],
    ['invalid pitch', { observedAttackPitches: ['H4'] }],
    ['non-string pitch', { observedAttackPitches: ['C4', 42] }],
    ['empty pitch string', { observedAttackPitches: [''] }],
    ['non-canonical flat pitch', { observedAttackPitches: ['Ab3'] }],
    ['non-finite confidence', { confidence: NaN }],
    ['infinite confidence', { confidence: Infinity }],
    ['negative confidence', { confidence: -.01 }],
    ['confidence above one', { confidence: 1.01 }],
    ['missing confidence', { confidence: undefined }],
    ['non-numeric confidence', { confidence: '1' }],
    ['foreign capture domain', { captureEndSessionTime: { domainId: 'other', ms: 235 } }],
    ['capture end before start', { captureEndSessionTime: { domainId: 'step-test', ms: 199 } }],
    ['non-finite capture end', { captureEndSessionTime: { domainId: 'step-test', ms: NaN } }],
  ])('rejects %s without fabricating an outcome', (_name, patch) => {
    const s = setup(), identity = s.begin(); s.runtime.analyzeAttempt(identity);
    // Untrusted protocol data deliberately bypasses static shape checks to exercise fail-closed validation.
    const evidence = { observedAttackPitches: ['C4'], confidence: 1, captureEndSessionTime: s.time(235), ...patch } as StepPitchEvidence;
    expect(() => s.runtime.completeAttempt(identity, evidence)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'ANALYZING', pendingPostVerdict: null, activeAttempt: identity });
  });
  it('accepts the pitch-entry upper bound and normalizes without losing evidence identity', () => {
    const s = setup(), identity = s.begin();
    s.runtime.analyzeAttempt(identity);
    const result = s.runtime.completeAttempt(identity, { observedAttackPitches: ['C4', ...Array<string>(127).fill('C4')], confidence: 0,
      captureEndSessionTime: s.time(235) });
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { ...identity, verdict: 'MATCH', observedAttackPitches: ['C4'], confidence: 0 } });
  });
});
