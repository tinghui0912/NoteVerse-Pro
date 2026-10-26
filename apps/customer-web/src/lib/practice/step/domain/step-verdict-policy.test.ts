import { describe, expect, expectTypeOf, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import { normalizePitchSet, type StepPitchEvidence } from '@/lib/practice/step/domain/attempt';
import { StepPracticeRuntime, type StepPracticeRuntimeOptions } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';

function setup(inputSource: PracticeInputSource, expected: readonly string[] = ['G#3', 'E4']) {
  const base = fixture as PracticeScoreArtifact;
  const artifact: PracticeScoreArtifact = { ...base,
    expectedPracticeGroups: base.expectedPracticeGroups.map(g => ({ ...g, pitches: [...expected],
      strikeTargets: expected.map(pitch => ({ ...g.strikeTargets[0], pitch })) })),
    practiceAttackSteps: base.practiceAttackSteps.map(s => ({ ...s,
      attackTargets: expected.map(pitch => ({ ...s.attackTargets[0], pitch })) })) };
  const clock = new ManualClock(), domainId = 'source-policy';
  const options: StepPracticeRuntimeOptions = { artifact, inputSource, clock, localSessionId: domainId,
    metadataClock: { nowEpochMs: () => 0 }, scope: { kind: 'FULL' } };
  const runtime = new StepPracticeRuntime(options);
  const time = (ms: number) => ({ domainId, ms });
  const finish = (observed: readonly string[], start = 100) => {
    const id = runtime.openAttempt(time(start))!;
    expect(runtime.analyzeAttempt(id)).toBe(true);
    const evidence: StepPitchEvidence = { observedAttackPitches: observed as StepPitchEvidence['observedAttackPitches'], confidence: .873,
      captureEndSessionTime: time(start + 50) };
    const result = runtime.completeAttempt(id, evidence);
    if (result.kind !== 'FINALIZED') throw Error('Expected finalized evidence');
    return { id, evidence, record: result.record };
  };
  return { runtime, options, clock, time, finish };
}

describe('source-bound STEP pitch-evidence verdict policy', () => {
  it.each([
    { source: 'MIDI', target: ['C4','E4'], observed: ['D4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['C4','E4'], observed: ['C4','E4'], verdict: 'MATCH' },
    { source: 'MICROPHONE', target: ['C4','E4'], observed: ['C4','E4','G4'], verdict: 'RETRY' },
    { source: 'MICROPHONE', target: ['C4','E4'], observed: ['C4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['C4','E4'], observed: ['D4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['C4','E4'], observed: ['C4','G4'], verdict: 'MISMATCH' },
    { source: 'MIDI', target: ['C4', 'E4'], observed: ['C4', 'E4'], verdict: 'MATCH' },
    { source: 'MIDI', target: ['C4', 'E4'], observed: ['C4'], verdict: 'MISMATCH' },
    { source: 'MIDI', target: ['C4', 'E4'], observed: ['C4', 'E4', 'G4'], verdict: 'MISMATCH' },
    { source: 'MIDI', target: ['C4', 'E4'], observed: ['C4', 'D#4'], verdict: 'MISMATCH' },
    { source: 'MIDI', target: ['C4', 'E4'], observed: ['C3', 'E4'], verdict: 'MISMATCH' },
    { source: 'MIDI', target: ['E4', 'C4', 'C4'], observed: ['E4', 'C4', 'E4'], verdict: 'MATCH' },
    { source: 'MIDI', target: ['G#3', 'E4'], observed: ['Ab3', 'E4'], verdict: 'INVALID' },
    { source: 'MICROPHONE', target: ['G#3', 'E4'], observed: ['G#3', 'E4'], verdict: 'MATCH' },
    { source: 'MICROPHONE', target: ['E4', 'G#3', 'G#3'], observed: ['E4', 'G#3', 'E4'], verdict: 'MATCH' },
    { source: 'MICROPHONE', target: ['G#3', 'E4'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'RETRY' },
    { source: 'MICROPHONE', target: ['A0', 'G#3', 'E4'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['G#3', 'D#4'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['E3', 'G#3'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'RETRY' },
    { source: 'MICROPHONE', target: ['C4'], observed: [], verdict: 'INVALID' },
    { source: 'MICROPHONE', target: ['C4'], observed: ['C4'], verdict: 'MATCH' },
  ] as const)('$source $observed relative to $target -> $verdict', ({ source, target, observed, verdict }) => {
    const s = setup(source, target);
    if (verdict === 'INVALID') { expect(() => s.finish(observed)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID'); return; }
    const { record, evidence } = s.finish(observed);
    expect(record).toMatchObject({ verdict, retry: verdict === 'RETRY' ? { origin: 'TARGET_POLICY', reason: 'TARGET_COVERED_WITH_EXTRA' } : null,
      observedAttackPitches: normalizePitchSet(observed), confidence: evidence.confidence,
      captureEndSessionTime: evidence.captureEndSessionTime });
    expect(record.observedAttackPitches).not.toBe(observed);
    expect(Number.isFinite(record.confidence)).toBe(true);
    if (record.verdict === 'RETRY') expect(Object.isFrozen(record.retry)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true); expect(Object.isFrozen(record.observedAttackPitches)).toBe(true);
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'POST_VERDICT', currentIndex: 0, targetGeneration: 1,
      verdictPolicy: source === 'MIDI' ? 'MIDI_EXACT_SET_V1' : 'MICROPHONE_EXACT_SET_WITH_SUPERSET_ABSTENTION_V1' });
  });
  it('policy is resolved from pinned input source, never a caller-selectable policy', () => {
    expectTypeOf<Extract<keyof StepPracticeRuntimeOptions, 'verdictPolicy'>>().toEqualTypeOf<never>();
    const s = setup('MIDI', ['C4']);
    s.options.inputSource = 'MICROPHONE';
    expect(s.runtime.verdictPolicy).toBe('MIDI_EXACT_SET_V1');
    expect(s.finish(['C4', 'G4']).record).toMatchObject({ inputSource: 'MIDI', verdict: 'MISMATCH' });
    expect(s.runtime.snapshot().inputSource).toBe('MIDI');
  });
  it.each(['MIDI', 'MICROPHONE'] as const)('%s confidence is retained metadata, not a verdict threshold', source => {
    for (const confidence of [0, .01, .49, .99, 1]) {
      for (const observed of [['C4','E4'], ['C4','E4','G4'], ['C4']] as const) {
        const s = setup(source, ['C4','E4']), id = s.runtime.openAttempt(s.time(100))!;
        s.runtime.analyzeAttempt(id);
        const result = s.runtime.completeAttempt(id, { observedAttackPitches: observed, confidence, captureEndSessionTime: s.time(150) });
        expect(result).toMatchObject({ kind: 'FINALIZED', record: { confidence, verdict: observed.length === 2 ? 'MATCH'
          : source === 'MICROPHONE' && observed.length === 3 ? 'RETRY' : 'MISMATCH' } });
      }
    }
  });
  it('target-policy abstention preserves evidence, never advances or carries it across rearm', () => {
    const s = setup('MICROPHONE'), target = s.runtime.currentTarget()!, raw = ['E3', 'G#3', 'E4', 'G#4'];
    const first = s.finish(raw), post = s.runtime.snapshot(); raw.push('C6');
    expect(first.record.observedAttackPitches).not.toContain('C6');
    expect(s.runtime.currentTarget()).toMatchObject({ stepId: target.stepId,
      targetGeneration: target.targetGeneration, attackPitches: target.attackPitches,
      inputEligibleAfter: first.record.captureEndSessionTime });
    expect(s.runtime.openAttempt(s.time(300))).toBeNull();
    s.runtime.rearm(s.time(500));
    expect(s.runtime.currentTarget()).toMatchObject({ stepId: target.stepId, targetGeneration: 1 });
    for (const ms of [100, 150, 499, 500]) expect(s.runtime.openAttempt(s.time(ms))).toBeNull();
    const second = s.finish(['G#3', 'E4'], 501);
    expect(second.id.attemptId).not.toBe(first.id.attemptId); expect(second.record.verdict).toBe('MATCH');
    expect(s.runtime.currentStepIndex).toBe(0);
    s.runtime.rearm(s.time(700));
    expect(s.runtime.snapshot().step).toMatchObject({ currentIndex: 1, targetGeneration: 2, attemptState: 'READY' });
    expect(s.runtime.analyzeAttempt(first.id)).toBe(false);
    expect(s.runtime.completeAttempt(first.id, first.evidence).kind).toBe('REJECTED');
    expect(post.step.pendingPostVerdict).toBe(first.record);
    expect(s.runtime.snapshot().step.attempts).toEqual([first.record, second.record]);
  });
  it('exact but hallucinated microphone evidence can still MATCH; no universal safety claim', () => {
    const s = setup('MICROPHONE', ['E3', 'G#3']);
    expect(s.finish(['E3', 'G#3']).record.verdict).toBe('MATCH');
  });
});
