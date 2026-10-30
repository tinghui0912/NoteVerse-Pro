import { describe, expect, expectTypeOf, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { type StepPianoKeyEvidence, type StepAttemptIdentity, type StepAttemptRecord } from '@/lib/practice/step/domain/attempt';

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
  const finish = (identity: StepAttemptIdentity, pianoKeys: StepPianoKeyEvidence['observedAttackKeys']) => {
    runtime.analyzeAttempt(identity);
    return runtime.completeAttempt(identity, { confidence: 1,
      observedAttackKeys: pianoKeys, captureEndSessionTime: time(identity.attemptStartSessionTime.ms + 35) });
  };
  return { runtime, clock, time, begin, finish };
}
describe('one target / one bounded attempt / one verdict', () => {
  it.each([
    [0, [60], 'MATCH'], [0, [61], 'MISMATCH'], [0, [72], 'MISMATCH'],
    [3, [69], 'MISMATCH'], [3, [69, 72, 74], 'MISMATCH'],
    [3, [72, 69], 'MATCH'], [3, [67], 'MISMATCH'],
  ] as const)('target %s, gesture %j yields %s', (index, pianoKeys, verdict) => {
    const { runtime, begin, finish } = setup(index), identity = begin();
    const result = finish(identity, pianoKeys);
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { verdict, ...identity } });
    expect(runtime.currentStepIndex).toBe(index);
    expect(runtime.currentTarget()?.targetGeneration).toBe(identity.targetGeneration);
    expect(runtime.snapshot().step.pendingPostVerdict).toBe(result.kind === 'FINALIZED' ? result.record : null);
    rearmAtCaptureEnd(runtime);
    expect(runtime.currentStepIndex).toBe(index + (verdict === 'MATCH' ? 1 : 0));
    expect(Object.isFrozen(result.kind === 'FINALIZED' && result.record.observedAttackKeys)).toBe(true);
    expect(finish(identity, pianoKeys)).toMatchObject({ kind: 'REJECTED' });
    expect(runtime.snapshot().step.pendingPostVerdict).toBeNull();
  });
  it('partial pianoKeys never accumulate; mismatch then a fresh correct attempt', () => {
    const { runtime, begin, finish } = setup(3);
    const first = finish(begin(), [69]); rearmAtCaptureEnd(runtime); const second = finish(begin(), [72]);
    expect(runtime.currentStepIndex).toBe(3);
    rearmAtCaptureEnd(runtime); const third = finish(begin(), [69, 72]); rearmAtCaptureEnd(runtime);
    expect(runtime.currentStepIndex).toBe(4);
    expect([first, second, third].map(r => r.kind === 'FINALIZED' ? r.record.verdict : r.kind)).toEqual(['MISMATCH', 'MISMATCH', 'MATCH']);
  });
  it('repeated notes need new identity and POST_VERDICT is explicit backpressure', () => {
    const { runtime, begin, finish, time } = setup(), first = begin();
    expect(runtime.openAttempt(time(205))).toBeNull();
    finish(first, [60]); expect(runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    expect(runtime.openAttempt(time(240))).toBeNull(); rearmAtCaptureEnd(runtime);
    const second = begin(); expect(second.attemptId).not.toBe(first.attemptId);
    finish(second, [60]); rearmAtCaptureEnd(runtime); expect(runtime.currentStepIndex).toBe(2);
  });
  it('non-exact microphone input preserves pianoKey evidence and stays on the answered target', () => {
    const { runtime, begin, time } = setup(0, 'non-exact', 'MICROPHONE'), identity = begin(); runtime.analyzeAttempt(identity);
    const evidence: StepPianoKeyEvidence = { observedAttackKeys: [60,67], confidence: .45, captureEndSessionTime: time(250) };
    const result = runtime.completeAttempt(identity, evidence);
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { ...identity, ...evidence, verdict: 'MISMATCH' } });
    expect(runtime.currentStepIndex).toBe(0); expect(runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    rearmAtCaptureEnd(runtime); expect(runtime.snapshot().step.attemptState).toBe('READY');
    expect(runtime.currentStepIndex).toBe(0); expect(runtime.currentTarget()!.targetGeneration).toBe(identity.targetGeneration);
  });
  it.each(['setInputUnavailable', 'end'] as const)('%s invalidates active capture and late analysis', command => {
    const { runtime, begin, finish } = setup(), old = begin(); runtime[command]();
    expect(finish(old, [60])).toMatchObject({ kind: 'REJECTED' });
    expect(runtime.snapshot().step.pendingPostVerdict).toBeNull();
    expect(runtime.snapshot().step.activeAttempt).toBeNull();
  });
  it('input return preserves target generation; old attempt and session cannot complete', () => {
    const a = setup(), identity = a.begin(); a.runtime.setInputUnavailable(); a.runtime.acceptInputAfter(a.time());
    const next = a.begin(); expect(next.stepId).toBe(identity.stepId);
    expect(next.targetGeneration).toBe(identity.targetGeneration);
    expect(a.finish(identity, [60]).kind).toBe('REJECTED');
    const b = setup(0, 'restart'); b.begin(); expect(b.finish(identity, [60]).kind).toBe('REJECTED');
  });
  it('finish never fabricates a verdict and is idempotent', () => {
    const { runtime, begin } = setup(); begin(); runtime.end(); const snapshot = runtime.snapshot(); runtime.end();
    expect(runtime.snapshot().step).toEqual(snapshot.step); expect(snapshot.step.pendingPostVerdict).toBeNull();
    expect(snapshot.completionReason).toBe('STOPPED_BY_USER');
  });
  it('final MATCH waits in POST_VERDICT; scope ends once at rearm, immutable session snapshot', () => {
    const { runtime, begin, finish } = setup(4); finish(begin(), [74]);
    expect(runtime.isCompleted).toBe(false);
    expect(runtime.currentStepIndex).toBe(4);
    expect(runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    rearmAtCaptureEnd(runtime);
    expect(() => runtime.rearm({ domainId: runtime.localSessionId, ms: 0 })).toThrow('STEP_ATTEMPT_STATE_INVALID');
    expect(runtime.snapshot()).toMatchObject({ version: { schemaVersion: 9, runtimeVersion: 'step-piano-key-learning-v12' },
      runtimeStatus: 'ENDED', completionReason: 'SCOPE_COMPLETED', step: { completed: true } });
    expect(runtime.currentTarget()).toBeNull(); expect(runtime.skip()).toBe(false);
  });
  it('rejects stale source time, foreign domain, invalid confidence and forged identity', () => {
    const s = setup(); expect(s.runtime.openAttempt(s.time(99))).toBeNull();
    expect(() => s.runtime.openAttempt({ domainId: 'other', ms: 200 })).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    const id = s.begin(); s.runtime.analyzeAttempt(id);
    const evidence: StepPianoKeyEvidence = { observedAttackKeys: [60], confidence: NaN, captureEndSessionTime: s.time(235) };
    expect(() => s.runtime.completeAttempt(id, evidence)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(s.runtime.completeAttempt({ ...id, inputSource: 'MICROPHONE' }, { ...evidence, confidence: 1 }).kind).toBe('REJECTED');
  });
  it('deterministic many-cycle input outage: one result, no stale attempt or partial carry', () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = setup(3, `property-${seed}`);
      for (let cycle = 0; cycle < 10; cycle++) {
        const stale = s.begin(); s.runtime.setInputUnavailable(); s.runtime.acceptInputAfter(s.time());
        expect(s.finish(stale, [69,72]).kind).toBe('REJECTED');
        s.finish(s.begin(), cycle % 2 ? [69] : [72]); rearmAtCaptureEnd(s.runtime);
        expect(s.runtime.currentStepIndex).toBe(3);
      }
      const id = s.begin(); s.finish(id, [72,69]); rearmAtCaptureEnd(s.runtime);
      expect(s.runtime.currentStepIndex).toBe(4); expect(s.finish(id, [69,72]).kind).toBe('REJECTED');
      expect(s.runtime.snapshot().step.pendingPostVerdict).toBeNull();
    }
  });
});


describe('STEP evidence and outcome integrity', () => {
  it.each([
    { label: 'one-slot sparse', pianoKeys: () => Array<number>(1) },
    { label: 'own first entry and trailing hole', pianoKeys: () => { const value = Array<number>(2); value[0] = 60; return value; } },
    { label: 'leading hole and own later entry', pianoKeys: () => { const value = Array<number>(2); value[1] = 60; return value; } },
    { label: '128 sparse slots', pianoKeys: () => Array<number>(128) },
  ])('rejects $label without losing attempt ownership and accepts a valid retry', ({ pianoKeys }) => {
    const s = setup(), identity = s.begin(); expect(s.runtime.analyzeAttempt(identity)).toBe(true);
    const before = s.runtime.snapshot().step, target = s.runtime.currentTarget();
    const sparse = pianoKeys(), length = sparse.length, ownEntries = Object.keys(sparse);
    // Deliberately malformed direct input cannot satisfy the declared dense string tuple.
    const evidence = { observedAttackKeys: sparse, confidence: 1,
      captureEndSessionTime: s.time(235) } as unknown as StepPianoKeyEvidence;
    expect(() => s.runtime.completeAttempt(identity, evidence)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(s.runtime.snapshot().step).toEqual(before);
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'ANALYZING', activeAttempt: identity,
      pendingPostVerdict: null, currentIndex: 0, targetGeneration: 1 });
    expect(s.runtime.currentTarget()).toEqual(target);
    expect(sparse.length).toBe(length); expect(Object.keys(sparse)).toEqual(ownEntries);
    const result = s.runtime.completeAttempt(identity, { ...evidence, observedAttackKeys: [60] });
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { ...identity, verdict: 'MATCH', observedAttackKeys: [60] } });
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'POST_VERDICT', activeAttempt: null,
      currentIndex: 0, targetGeneration: 1 });
  });

  it('rejects an inherited array index without reading it or fabricating evidence', () => {
    const s = setup(), identity = s.begin(); s.runtime.analyzeAttempt(identity);
    const pianoKeys = Array<number>(1), prototype = Object.create(Array.prototype);
    let inheritedReads = 0;
    Object.defineProperty(prototype, '0', { get: () => { inheritedReads++; throw Error('inherited index read'); } });
    Object.setPrototypeOf(pianoKeys, prototype);
    expect(Array.isArray(pianoKeys)).toBe(true); expect(Object.hasOwn(pianoKeys, 0)).toBe(false);
    expect(() => s.runtime.completeAttempt(identity, { observedAttackKeys: pianoKeys as unknown as StepPianoKeyEvidence['observedAttackKeys'],
      confidence: 1, captureEndSessionTime: s.time(235) })).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(inheritedReads).toBe(0);
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'ANALYZING', activeAttempt: identity, pendingPostVerdict: null });
  });

  it('rejects length129 before any index0 read, keeping the active attempt retryable', () => {
    const s = setup(), identity = s.begin(); s.runtime.analyzeAttempt(identity);
    const pianoKeys = Array<number>(129); let indexReads = 0;
    Object.defineProperty(pianoKeys, '0', { get: () => { indexReads++; throw Error('index0 must not be read'); } });
    expect(() => s.runtime.completeAttempt(identity, { observedAttackKeys: pianoKeys as unknown as StepPianoKeyEvidence['observedAttackKeys'],
      confidence: 1, captureEndSessionTime: s.time(235) })).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(indexReads).toBe(0);
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'ANALYZING', activeAttempt: identity, pendingPostVerdict: null });
    expect(s.runtime.completeAttempt(identity, { observedAttackKeys: [60], confidence: 1, captureEndSessionTime: s.time(235) }))
      .toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH', observedAttackKeys: [60] } });
  });

  it('ignores extra non-index array properties and accepts an ordinary own indexed accessor', () => {
    const s = setup(), identity = s.begin(); s.runtime.analyzeAttempt(identity);
    const pianoKeys: [number, ...number[]] = [60, 60];
    Object.defineProperty(pianoKeys, 'unrelated', { enumerable: true, get: () => { throw Error('non-index property must not be read'); } });
    Object.defineProperty(pianoKeys, '0', { get: () => 60 });
    expect(s.runtime.completeAttempt(identity, { observedAttackKeys: pianoKeys, confidence: 1, captureEndSessionTime: s.time(235) }))
      .toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH', observedAttackKeys: [60] } });
  });

  it('only permits nonempty evidence and the two learning outcomes', () => {
    expectTypeOf<[]>().not.toExtend<StepPianoKeyEvidence['observedAttackKeys']>();
    expectTypeOf<StepAttemptRecord['confidence']>().toEqualTypeOf<number>();
    expectTypeOf<StepAttemptRecord['verdict']>().toEqualTypeOf<'MATCH' | 'MISMATCH'>();
    expectTypeOf<keyof StepAttemptRecord>().toEqualTypeOf<keyof StepAttemptIdentity | keyof StepPianoKeyEvidence | 'verdict'>();
  });
  it.each<[string, Record<string, unknown>]>([
    ['empty pianoKey list', { observedAttackKeys: [] }],
    ['too many pianoKey entries', { observedAttackKeys: Array(129).fill(60) }],
    ['missing pianoKey list', { observedAttackKeys: undefined }],
    ['non-array pianoKey list', { observedAttackKeys: 60 }],
    ['invalid pianoKey', { observedAttackKeys: ['H4'] }],
    ['non-numeric key', { observedAttackKeys: [60, 'C4'] }],
    ['own undefined pianoKey', { observedAttackKeys: [60, undefined] }],
    ['empty pianoKey string', { observedAttackKeys: [''] }],
    ['non-canonical flat pianoKey', { observedAttackKeys: ['Ab3'] }],
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
    const evidence = { observedAttackKeys: [60], confidence: 1, captureEndSessionTime: s.time(235), ...patch } as StepPianoKeyEvidence;
    expect(() => s.runtime.completeAttempt(identity, evidence)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID');
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'ANALYZING', pendingPostVerdict: null, activeAttempt: identity });
  });
  it('accepts the pianoKey-entry upper bound and normalizes without losing evidence identity', () => {
    const s = setup(), identity = s.begin();
    s.runtime.analyzeAttempt(identity);
    const result = s.runtime.completeAttempt(identity, { observedAttackKeys: [60, ...Array<number>(127).fill(60)], confidence: 0,
      captureEndSessionTime: s.time(235) });
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { ...identity, verdict: 'MATCH', observedAttackKeys: [60], confidence: 0 } });
  });
});
