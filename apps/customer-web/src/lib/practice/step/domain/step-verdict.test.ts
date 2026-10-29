import { describe, expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { assertPracticeScoreArtifact, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import { normalizePitchSet, pitchSetsEqual, type StepPitchEvidence } from '@/lib/practice/step/domain/attempt';
import { StepPracticeRuntime, type StepPracticeRuntimeOptions } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';

function setup(inputSource: PracticeInputSource, expected: readonly string[] = ['G#3', 'E4']) {
  const base = fixture as PracticeScoreArtifact;
  const pitches = normalizePitchSet(expected);
  const artifact: PracticeScoreArtifact = { ...base,
    expectedPracticeGroups: base.expectedPracticeGroups.map(g => {
      const strikeTargets = pitches.map(pitch => {
        const note = { ...g.expectedNotes[0], pitch, expectedNoteId: `${g.groupId}:${pitch}`, renderNoteId: `${g.groupId}:render:${pitch}` };
        return { ...g.strikeTargets[0], strikeId: `${g.groupId}:strike:${pitch}`, pitch, expectedNotes: [note], renderNoteIds: [note.renderNoteId] };
      });
      return { ...g, pitches, strikeTargets, expectedNotes: strikeTargets.flatMap(t => t.expectedNotes), renderNoteIds: strikeTargets.flatMap(t => t.renderNoteIds) };
    }),
    practiceAttackSteps: base.practiceAttackSteps.map(s => {
      const attackTargets = pitches.map(pitch => {
      const note = { ...s.attackTargets[0].notes[0], pitch, stepNoteId: `${s.stepId}:${pitch}`, renderNoteId: `${s.stepId}:render:${pitch}` };
      return { ...s.attackTargets[0], attackId: `${s.stepId}:attack:${pitch}`, pitch, notes: [note], renderNoteIds: [note.renderNoteId] };
      });
      return { ...s, attackTargets, renderNoteIds: [...attackTargets.flatMap(t => t.renderNoteIds), ...s.continuation.map(n => n.renderNoteId)] };
    }) };
  const clock = new ManualClock(), domainId = 'exact-learning';
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

describe('STEP exact pitch-set learning verdict', () => {
  it.each([
    { label: 'one pitch', left: ['C4'], right: ['C4'], equal: true },
    { label: 'reordered pair', left: ['C4', 'E4'], right: ['E4', 'C4'], equal: true },
    { label: 'duplicates on one side', left: ['C4', 'C4', 'E4'], right: ['E4', 'C4'], equal: true },
    { label: 'duplicates on both sides', left: ['E4', 'C4', 'E4'], right: ['C4', 'E4', 'C4'], equal: true },
    { label: 'subset', left: ['C4'], right: ['C4', 'E4'], equal: false },
    { label: 'superset', left: ['C4', 'E4', 'G4'], right: ['C4', 'E4'], equal: false },
    { label: 'disjoint equal cardinality', left: ['C4', 'E4'], right: ['D4', 'F4'], equal: false },
    { label: 'enharmonic spelling stays distinct', left: ['E#4'], right: ['F4'], equal: false },
    { label: 'negative-zero spelling stays distinct', left: ['C-0'], right: ['C0'], equal: false },
    { label: 'delimiter collision', left: ['C4\u001fE4'], right: ['C4', 'E4'], equal: false },
    { label: 'reverse delimiter collision', left: ['C4', 'E4'], right: ['C4\u001fE4'], equal: false },
    { label: 'identical opaque delimiter member', left: ['C4\u001fE4'], right: ['C4\u001fE4'], equal: true },
    { label: 'multiple delimiters stay one opaque member', left: ['C4\u001f\u001fE4'], right: ['C4\u001f\u001fE4'], equal: true },
    { label: 'multiple delimiters are not member syntax', left: ['C4\u001fE4\u001fG4'], right: ['C4', 'E4', 'G4'], equal: false },
    { label: 'same-cardinality serialization collision', left: ['C4\u001fE4', 'G4'], right: ['C4', 'E4\u001fG4'], equal: false },
    { label: 'unusual opaque strings', left: [' \n\0', '🎵'], right: ['🎵', ' \n\0'], equal: true },
  ])('structural normalized set equality: $label', ({ left, right, equal }) => {
    const originalLeft = [...left], originalRight = [...right];
    expect(pitchSetsEqual(left, right)).toBe(equal);
    expect(left).toEqual(originalLeft); expect(right).toEqual(originalRight);
  });

  it.each(['MIDI', 'MICROPHONE'] as const)('%s admitted delimiter target yields MISMATCH and stays on the target after rearm', inputSource => {
    const artifact = structuredClone(fixture) as PracticeScoreArtifact, delimiterPitch = 'C4\u001fE4';
    const replace = (pitch: string) => pitch === 'C4' ? delimiterPitch : pitch;
    // Keep every physical pitch reference consistent, including source events and notation facts.
    for (const event of artifact.playableEvents) event.pitches = event.pitches.map(replace);
    for (const group of artifact.expectedPracticeGroups) {
      group.pitches = group.pitches.map(replace);
      for (const note of group.expectedNotes) note.pitch = replace(note.pitch);
      for (const target of group.strikeTargets) {
        target.pitch = replace(target.pitch);
        for (const note of target.expectedNotes) note.pitch = replace(note.pitch);
      }
    }
    for (const step of artifact.practiceAttackSteps) {
      for (const target of step.attackTargets) {
        target.pitch = replace(target.pitch);
        for (const note of target.notes) note.pitch = replace(note.pitch);
      }
      for (const note of step.continuation) note.pitch = replace(note.pitch);
    }
    expect(() => assertPracticeScoreArtifact(artifact)).not.toThrow();
    const before = structuredClone(artifact), clock = new ManualClock(), domainId = 'delimiter-verdict';
    const time = (ms: number) => ({ domainId, ms });
    const runtime = new StepPracticeRuntime({ artifact, inputSource, localSessionId: domainId, clock,
      scope: { kind: 'FULL' }, metadataClock: { nowEpochMs: () => 0 } });
    const target = runtime.currentTarget()!;
    expect(target.attackPitches).toEqual([delimiterPitch]);
    const identity = runtime.openAttempt(time(100))!; expect(runtime.analyzeAttempt(identity)).toBe(true);
    const raw: StepPitchEvidence['observedAttackPitches'] = ['C4', 'E4'];
    const result = runtime.completeAttempt(identity, { observedAttackPitches: raw, confidence: 1, captureEndSessionTime: time(150) });
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MISMATCH', observedAttackPitches: ['C4', 'E4'] } });
    expect(raw).toEqual(['C4', 'E4']); expect(artifact).toEqual(before);
    expect(runtime.snapshot().step).toMatchObject({ currentIndex: 0, targetGeneration: 1, attemptState: 'POST_VERDICT' });
    runtime.rearm(time(200));
    expect(runtime.currentTarget()).toMatchObject({ stepId: target.stepId, targetGeneration: 1,
      attackPitches: [delimiterPitch], inputEligibleAfter: time(200) });
    const ordinary = setup(inputSource, ['C4']); ordinary.finish(['C4', 'E4']); ordinary.runtime.rearm(ordinary.time(200));
    for (const s of [runtime.snapshot().step, ordinary.runtime.snapshot().step]) {
      expect(s).toMatchObject({ currentIndex: 0, targetGeneration: 1, attemptState: 'READY', pendingPostVerdict: null });
    }
    expect(runtime.snapshot().version).toEqual({ schemaVersion: 8, runtimeVersion: 'step-exact-pitch-learning-v10' });
  });

  it.each([
    { source: 'MIDI', target: ['C4','E4'], observed: ['D4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['C4','E4'], observed: ['C4','E4'], verdict: 'MATCH' },
    { source: 'MICROPHONE', target: ['C4','E4'], observed: ['C4','E4','G4'], verdict: 'MISMATCH' },
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
    { source: 'MICROPHONE', target: ['G#3', 'E4'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['A0', 'G#3', 'E4'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['G#3', 'D#4'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['E3', 'G#3'], observed: ['E3', 'G#3', 'E4', 'G#4'], verdict: 'MISMATCH' },
    { source: 'MICROPHONE', target: ['C4'], observed: [], verdict: 'INVALID' },
    { source: 'MICROPHONE', target: ['C4'], observed: ['C4'], verdict: 'MATCH' },
  ] as const)('$source $observed relative to $target -> $verdict', ({ source, target, observed, verdict }) => {
    const s = setup(source, target);
    if (verdict === 'INVALID') { expect(() => s.finish(observed)).toThrow('STEP_ATTEMPT_EVIDENCE_INVALID'); return; }
    const { record, evidence } = s.finish(observed);
    expect(record).toMatchObject({ verdict,
      observedAttackPitches: normalizePitchSet(observed), confidence: evidence.confidence,
      captureEndSessionTime: evidence.captureEndSessionTime });
    expect(record.observedAttackPitches).not.toBe(observed);
    expect(Number.isFinite(record.confidence)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true); expect(Object.isFrozen(record.observedAttackPitches)).toBe(true);
    expect(s.runtime.snapshot().step).toMatchObject({ attemptState: 'POST_VERDICT', currentIndex: 0, targetGeneration: 1 });
  });
  it('input ownership is pinned while target comparison has no source-specific policy', () => {
    const s = setup('MIDI', ['C4']);
    s.options.inputSource = 'MICROPHONE';
    expect(s.finish(['C4', 'G4']).record).toMatchObject({ inputSource: 'MIDI', verdict: 'MISMATCH' });
    expect(s.runtime.snapshot().inputSource).toBe('MIDI');
  });
  it.each(['MIDI', 'MICROPHONE'] as const)('%s confidence is retained metadata, not a verdict threshold', source => {
    for (const confidence of [0, .01, .49, .99, 1]) {
      for (const observed of [['C4','E4'], ['C4','E4','G4'], ['C4']] as const) {
        const s = setup(source, ['C4','E4']), id = s.runtime.openAttempt(s.time(100))!;
        s.runtime.analyzeAttempt(id);
        const result = s.runtime.completeAttempt(id, { observedAttackPitches: observed, confidence, captureEndSessionTime: s.time(150) });
        expect(result).toMatchObject({ kind: 'FINALIZED', record: { confidence, verdict: observed.length === 2 ? 'MATCH' : 'MISMATCH' } });
      }
    }
  });
  it('non-exact evidence is preserved, never advances or carries it across rearm', () => {
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
    expect(s.runtime.snapshot().step.pendingPostVerdict).toBeNull();
  });
  it('exact but hallucinated microphone evidence can still MATCH; no universal safety claim', () => {
    const s = setup('MICROPHONE', ['E3', 'G#3']);
    expect(s.finish(['E3', 'G#3']).record.verdict).toBe('MATCH');
  });
});
