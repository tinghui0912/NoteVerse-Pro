import { stepSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { artifactWithKeys } from '@/lib/practice/__fixtures__/piano-key-artifact';
import { describe, expect, it } from 'vitest';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import { normalizePianoKeySet, pianoKeySetsEqual, type StepPianoKeyEvidence } from '@/lib/practice/step/domain/attempt';
import { StepPracticeRuntime, type StepPracticeRuntimeOptions } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';

function setup(inputSource: PracticeInputSource, expected: readonly number[] = [56, 64]) {
  const artifact = artifactWithKeys(Array.from({ length: 5 }, () => normalizePianoKeySet(expected)));
  const clock = new ManualClock(), domainId = 'exact-learning';
  const options: StepPracticeRuntimeOptions = { ...stepSessionPlan(artifact, { inputSource }), clock, localSessionId: domainId,
    metadataClock: { nowEpochMs: () => 0 } };
  const runtime = new StepPracticeRuntime(options);
  const time = (ms: number) => ({ domainId, ms });
  const finish = (observed: readonly number[], start = 100) => {
    const id = runtime.openAttempt(time(start))!;
    expect(runtime.analyzeAttempt(id)).toBe(true);
    const evidence: StepPianoKeyEvidence = { observedAttackKeys: observed as StepPianoKeyEvidence['observedAttackKeys'], confidence: .873,
      captureEndSessionTime: time(start + 50) };
    const result = runtime.completeAttempt(id, evidence);
    if (result.kind !== 'FINALIZED') throw Error('Expected finalized evidence');
    return { id, evidence, record: result.record };
  };
  return { runtime, options, clock, time, finish };
}

describe('STEP exact pianoKey-set learning verdict', () => {
  it.each([
    { left: [60], right: [60], equal: true },
    { left: [60, 64], right: [64, 60], equal: true },
    { left: [60, 60, 64], right: [64, 60, 64], equal: true },
    { left: [60], right: [60, 64], equal: false },
    { left: [60, 64, 67], right: [60, 64], equal: false },
    { left: [60, 64], right: [62, 65], equal: false },
  ])('exact structural numeric set equality: $left / $right', ({ left, right, equal }) => {
    expect(pianoKeySetsEqual(left, right)).toBe(equal);
  });

  it.each([
    { source: 'MIDI', target: [60,64], observed: [62], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [60,64], observed: [60,64], verdict: 'MATCH' },
    { source: 'MICROPHONE', target: [60,64], observed: [60,64,67], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [60,64], observed: [60], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [60,64], observed: [62], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [60,64], observed: [60,67], verdict: 'MISMATCH' },
    { source: 'MIDI', target: [60, 64], observed: [60, 64], verdict: 'MATCH' },
    { source: 'MIDI', target: [60, 64], observed: [60], verdict: 'MISMATCH' },
    { source: 'MIDI', target: [60, 64], observed: [60, 64, 67], verdict: 'MISMATCH' },
    { source: 'MIDI', target: [60, 64], observed: [60, 63], verdict: 'MISMATCH' },
    { source: 'MIDI', target: [60, 64], observed: [48, 64], verdict: 'MISMATCH' },
    { source: 'MIDI', target: [64, 60, 60], observed: [64, 60, 64], verdict: 'MATCH' },
    { source: 'MIDI', target: [56, 64], observed: [20, 64], verdict: 'INVALID' },
    { source: 'MICROPHONE', target: [56, 64], observed: [56, 64], verdict: 'MATCH' },
    { source: 'MICROPHONE', target: [64, 56, 56], observed: [64, 56, 64], verdict: 'MATCH' },
    { source: 'MICROPHONE', target: [56, 64], observed: [52, 56, 64, 68], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [21, 56, 64], observed: [52, 56, 64, 68], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [56, 63], observed: [52, 56, 64, 68], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [52, 56], observed: [52, 56, 64, 68], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: [60], observed: [], verdict: 'INVALID' },
    { source: 'MICROPHONE', target: [60], observed: [60], verdict: 'MATCH' },
  ] as const)('$source $observed relative to $target -> $verdict', ({ source, target, observed, verdict }) => {
    const s = setup(source, target);
    if (verdict === 'INVALID') { expect(() => s.finish(observed)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID'); return; }
    const { record, evidence } = s.finish(observed);
    expect(record).toMatchObject({ verdict,
      observedAttackKeys: normalizePianoKeySet(observed), confidence: evidence.confidence,
      captureEndSessionTime: evidence.captureEndSessionTime });
    expect(record.observedAttackKeys).not.toBe(observed);
    expect(Number.isFinite(record.confidence)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true); expect(Object.isFrozen(record.observedAttackKeys)).toBe(true);
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'POST_VERDICT', currentIndex: 0, targetGeneration: 1 });
  });
  it('input ownership is pinned while target comparison has no source-specific policy', () => {
    const s = setup('MIDI', [60]);
    s.options.inputSource = 'MICROPHONE';
    expect(s.finish([60, 67]).record).toMatchObject({ inputSource: 'MIDI', verdict: 'MISMATCH' });
    expect(s.runtime.snapshot().inputSource).toBe('MIDI');
  });
  it.each(['MIDI', 'MICROPHONE'] as const)('%s confidence is retained metadata, not a verdict threshold', source => {
    for (const confidence of [0, .01, .49, .99, 1]) {
      for (const observed of [[60,64], [60,64,67], [60]] as const) {
        const s = setup(source, [60,64]), id = s.runtime.openAttempt(s.time(100))!;
        s.runtime.analyzeAttempt(id);
        const result = s.runtime.completeAttempt(id, { observedAttackKeys: observed, confidence, captureEndSessionTime: s.time(150) });
        expect(result).toMatchObject({ kind: 'FINALIZED', record: { confidence, verdict: observed.length === 2 ? 'MATCH' : 'MISMATCH' } });
      }
    }
  });
  it('non-exact evidence is preserved, never advances or carries it across rearm', () => {
    const s = setup('MICROPHONE'), target = s.runtime.currentTarget()!, raw = [52, 56, 64, 68];
    const first = s.finish(raw), post = s.runtime.snapshot(); raw.push(84);
    expect(first.record.observedAttackKeys).not.toContain(84);
    expect(s.runtime.currentTarget()).toMatchObject({ stepId: target.stepId,
      targetGeneration: target.targetGeneration, attackKeys: target.attackKeys,
      inputEligibleAfter: first.record.captureEndSessionTime });
    expect(s.runtime.openAttempt(s.time(300))).toBeNull();
    s.runtime.rearm(s.time(500));
    expect(s.runtime.currentTarget()).toMatchObject({ stepId: target.stepId, targetGeneration: 1 });
    for (const ms of [100, 150, 499, 500]) expect(s.runtime.openAttempt(s.time(ms))).toBeNull();
    const second = s.finish([56, 64], 501);
    expect(second.id.attemptId).not.toBe(first.id.attemptId); expect(second.record.verdict).toBe('MATCH');
    expect(s.runtime.currentStepIndex).toBe(0);
    s.runtime.rearm(s.time(700));
    expect(s.runtime.snapshot().step).toMatchObject({ currentIndex: 1, targetGeneration: 2, attemptState: 'READY' });
    expect(s.runtime.analyzeAttempt(first.id)).toBe(false);
    expect(s.runtime.completeAttempt(first.id, first.evidence).kind).toBe('REJECTED');
    expect(post.step.pendingPostVerdict).toBe(first.record);
    expect(s.runtime.snapshot().step.pendingPostVerdict).toBeNull();
  });
  it('exact but hallucinated microphone evidence can still MATCH; no universal safety claim', () => {
    const s = setup('MICROPHONE', [52, 56]);
    expect(s.finish([52, 56]).record.verdict).toBe('MATCH');
  });
});

it.each(['MIDI', 'MICROPHONE'] as const)('%s compares physical piano endpoints and all88 keys without a scope-specific legality rule', inputSource => {
  const keys = Array.from({ length: 88 }, (_, i) => i + 21);
  const artifact = artifactWithKeys([[21, 108], keys]);
  const runtime = new StepPracticeRuntime({ ...stepSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: inputSource }), localSessionId: 'piano-endpoints', clock: new ManualClock() });
  const time = (ms: number) => ({ domainId: 'piano-endpoints', ms });
  expect(runtime.currentTarget()?.attackKeys).toEqual([21, 108]);
  const first = runtime.openAttempt(time(1))!; runtime.analyzeAttempt(first);
  expect(runtime.completeAttempt(first, { observedAttackKeys: [108, 21, 108], confidence: 1, captureEndSessionTime: time(2) }))
    .toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH', observedAttackKeys: [21, 108] } });
  runtime.rearm(time(2)); expect(runtime.currentStepIndex).toBe(1);
  const second = runtime.openAttempt(time(3))!; runtime.analyzeAttempt(second);
  expect(runtime.completeAttempt(second, { observedAttackKeys: [keys[0], ...keys.slice(1)], confidence: 1, captureEndSessionTime: time(4) }))
    .toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH', observedAttackKeys: keys } });
  runtime.rearm(time(4)); expect(runtime.isCompleted).toBe(true);
});
