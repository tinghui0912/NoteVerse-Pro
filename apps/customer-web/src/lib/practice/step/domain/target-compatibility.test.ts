import { describe, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { assertPracticeScoreArtifact, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { PracticeScope } from '@/lib/practice/kernel/scope';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { StepDomainError } from './attempt';
import { StepPracticeRuntime } from './runtime';

function artifactWithTarget(pitches: readonly string[], index = 0): PracticeScoreArtifact {
  const artifact = structuredClone(fixture) as PracticeScoreArtifact;
  const group = artifact.expectedPracticeGroups[index], step = artifact.practiceAttackSteps[index];
  const expected = group.expectedNotes[0], note = step.attackTargets[0].notes[0];
  const strike = group.strikeTargets[0], attack = step.attackTargets[0];
  const event = artifact.playableEvents.find(candidate => candidate.eventId === expected.eventId)!;
  const replacedEvents = new Set(group.eventIds);
  const events = pitches.map((pitch, i) => ({ ...event, eventId: `target:${index}:event:${i}`,
    pitches: [pitch], renderNoteIds: [`target:${index}:render:${i}`] }));
  group.pitches = [...pitches]; group.eventIds = events.map(value => value.eventId);
  group.expectedNotes = pitches.map((pitch, i) => ({ ...expected, pitch, eventId: events[i].eventId,
    expectedNoteId: `target:${index}:expected:${i}`, renderNoteId: events[i].renderNoteIds[0] }));
  group.renderNoteIds = group.expectedNotes.map(value => value.renderNoteId);
  group.strikeTargets = group.expectedNotes.map((value, i) => ({ ...strike, pitch: value.pitch,
    strikeId: `target:${index}:strike:${i}`, expectedNotes: [{ ...value }],
    eventIds: [value.eventId], renderNoteIds: [value.renderNoteId] }));
  step.attackTargets = group.expectedNotes.map((value, i) => ({ ...attack, pitch: value.pitch,
    attackId: `target:${index}:attack:${i}`, eventIds: [value.eventId], renderNoteIds: [value.renderNoteId],
    notes: [{ ...note, pitch: value.pitch, eventId: value.eventId,
      stepNoteId: `target:${index}:note:${i}`, renderNoteId: value.renderNoteId }] }));
  step.eventIds = [...group.eventIds]; step.renderNoteIds = [...group.renderNoteIds]; step.continuation = [];
  artifact.playableEvents = artifact.playableEvents.flatMap(value => replacedEvents.has(value.eventId)
    ? value.eventId === event.eventId ? events : [] : [value]);
  artifact.firstPlayableBeat = artifact.playableEvents.find(value => value.playable)?.onsetBeat ?? null;
  assertPracticeScoreArtifact(artifact);
  return artifact;
}

function scopeAt(artifact: PracticeScoreArtifact, start: number, end = start): PracticeScope {
  return { kind: 'RANGE', startGroupId: artifact.expectedPracticeGroups[start].groupId,
    endGroupId: artifact.expectedPracticeGroups[end].groupId };
}

const domainPitches = [...'ABCDEFG'].flatMap(letter => ['', '#'].flatMap(sharp => ['', '-'].flatMap(sign =>
  Array.from({ length: 10 }, (_, octave) => `${letter}${sharp}${sign}${octave}`))));

describe.each(['MIDI', 'MICROPHONE'] as const)('STEP selected-target compatibility / %s', inputSource => {
  const create = (artifact: PracticeScoreArtifact, scope: PracticeScope = { kind: 'FULL' }) =>
    new StepPracticeRuntime({ artifact, scope, inputSource, clock: new ManualClock(), localSessionId: 'compatibility' });

  it('keeps the ordinary canonical fixture compatible', () => {
    const runtime = create(structuredClone(fixture) as PracticeScoreArtifact);
    expect(runtime.currentTarget()?.attackPitches).toEqual(['C4']);
    expect(runtime.canAcceptAttempt).toBe(true);
    expect(runtime.snapshot().version).toEqual({ schemaVersion: 8, runtimeVersion: 'step-exact-pitch-learning-v11' });
  });

  it('admits and directly matches E#4 without imposing either producer universe', () => {
    const artifact = artifactWithTarget(['E#4']), before = structuredClone(artifact), runtime = create(artifact);
    const identity = runtime.openAttempt({ domainId: 'compatibility', ms: 1 })!;
    expect(runtime.analyzeAttempt(identity)).toBe(true);
    expect(runtime.completeAttempt(identity, { observedAttackPitches: ['E#4'], confidence: 1,
      captureEndSessionTime: { domainId: 'compatibility', ms: 2 } })).toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH' } });
    expect(artifact).toEqual(before);
  });

  it.each([
    ['C10', ['C10']], ['opaque nonempty string', ['opaque pitch']],
    ['empty target/group', []], ['129 distinct D280 pitches', domainPitches.slice(0, 129)],
  ] as const)('rejects selected %s as target-owned failure before initialization', (_label, pitches) => {
    const artifact = artifactWithTarget(pitches), before = structuredClone(artifact), now = vi.fn(() => 0);
    expect(() => assertPracticeScoreArtifact(artifact)).not.toThrow();
    expect(() => new StepPracticeRuntime({ artifact, scope: scopeAt(artifact, 0), inputSource,
      clock: { nowMs: now } })).toThrowError(new StepDomainError('STEP_TARGET_INVALID'));
    expect(now).not.toHaveBeenCalled(); expect(artifact).toEqual(before);
  });

  it('admits 128 distinct D280 members and matches their dense direct evidence', () => {
    const pitches = domainPitches.slice(0, 128), runtime = create(artifactWithTarget(pitches));
    expect(runtime.currentTarget()?.attackPitches).toEqual(pitches);
    const identity = runtime.openAttempt({ domainId: 'compatibility', ms: 1 })!; runtime.analyzeAttempt(identity);
    const result = runtime.completeAttempt(identity, { observedAttackPitches: [pitches[0], ...pitches.slice(1)], confidence: 1,
      captureEndSessionTime: { domainId: 'compatibility', ms: 2 } });
    expect(result).toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH' } });
  });

  it('checks both inclusive scope endpoints, leaving unused incompatible targets alone', () => {
    const laterBad = artifactWithTarget(['C10'], 1);
    const good = create(laterBad, scopeAt(laterBad, 0));
    expect(good.currentTarget()?.stepId).toBe(laterBad.practiceAttackSteps[0].stepId);
    expect(() => create(laterBad, scopeAt(laterBad, 1))).toThrowError(new StepDomainError('STEP_TARGET_INVALID'));
    expect(() => create(laterBad, scopeAt(laterBad, 0, 1))).toThrowError(new StepDomainError('STEP_TARGET_INVALID'));
    const earlierBad = artifactWithTarget(['C10'], 0);
    expect(create(earlierBad, scopeAt(earlierBad, 1)).currentTarget()?.stepId).toBe(earlierBad.practiceAttackSteps[1].stepId);
  });

  it('rejects FULL with a later bad target before reading any runtime clock', () => {
    const artifact = artifactWithTarget(['C10'], 1), now = vi.fn(() => 0);
    expect(() => new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' }, inputSource, clock: { nowMs: now } }))
      .toThrowError(new StepDomainError('STEP_TARGET_INVALID'));
    expect(now).not.toHaveBeenCalled();
  });

  it('preserves whole-artifact structural failure before scope and target compatibility', () => {
    const artifact = artifactWithTarget(['C10'], 1);
    artifact.expectedPracticeGroups[1].pitches = ['D4'];
    expect(() => create(artifact, scopeAt(artifact, 0))).toThrow(/step\/group attack pitch mismatch/);
  });

  it('preserves scope-resolution errors before compatibility errors', () => {
    const artifact = artifactWithTarget(['C10']);
    expect(() => create(artifact, { kind: 'RANGE', startGroupId: 'missing', endGroupId: 'missing' }))
      .toThrow('Practice scope target not found: missing');
  });

  it('does not apply attack compatibility to continuation strings', () => {
    const artifact = artifactWithTarget(['C4']), step = artifact.practiceAttackSteps[0];
    const note = { ...step.attackTargets[0].notes[0], pitch: 'C10', stepNoteId: 'continuation:C10', renderNoteId: 'continuation:render' };
    step.continuation.push(note); step.renderNoteIds.push(note.renderNoteId);
    artifact.playableEvents.push({ ...artifact.playableEvents[0], eventId: 'continuation:event', pitches: ['C10'],
      renderNoteIds: [note.renderNoteId], entryCandidate: false });
    note.eventId = 'continuation:event';
    expect(() => assertPracticeScoreArtifact(artifact)).not.toThrow();
    expect(create(artifact).currentTarget()).toMatchObject({ attackPitches: ['C4'], continuationPitches: ['C10'] });
  });

  it('keeps malformed learner evidence separate and retryable for a compatible target', () => {
    const runtime = create(artifactWithTarget(['C4'])), identity = runtime.openAttempt({ domainId: 'compatibility', ms: 1 })!;
    runtime.analyzeAttempt(identity);
    expect(() => runtime.completeAttempt(identity, { observedAttackPitches: ['C10'], confidence: 1,
      captureEndSessionTime: { domainId: 'compatibility', ms: 2 } })).toThrowError(new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID'));
    expect(runtime.snapshot().step).toMatchObject({ attemptState: 'ANALYZING', activeAttempt: identity, pendingPostVerdict: null });
    expect(runtime.completeAttempt(identity, { observedAttackPitches: ['C4'], confidence: 1,
      captureEndSessionTime: { domainId: 'compatibility', ms: 2 } })).toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH' } });
  });
});
