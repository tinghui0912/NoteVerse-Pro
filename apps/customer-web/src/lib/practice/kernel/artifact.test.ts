import { assertPracticeScoreArtifact } from './artifact';
import { attackPitchesForStep } from '@/lib/practice/step/domain/target';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { buildContinuousExpectedStrikes } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';

import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { describe, expect, it } from 'vitest';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
describe('Canonical PracticeScoreArtifact', () => {
  it("retains canonical artifact identity, attack targets and continuations", () => {

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.artifactId).toBe('practice-score-artifact:ec2262af8d689ffb');
    expect(artifact.expectedPracticeGroups.map((group) => group.pitches)).toEqual([
      ['C4'],
      ['C4'],
      ['G4'],
      ['A4', 'C5'],
      ['D5'],
    ]);

    expect(artifact.practiceAttackSteps[3]).toMatchObject({
      attackTargets: [{ pitch: 'A4' }, { pitch: 'C5' }],
      continuation: [{ pitch: 'G4' }],
    });

  });
});


function unisonArtifact(): PracticeScoreArtifact {
  const value = structuredClone(artifact);
  const group = value.expectedPracticeGroups[0], step = value.practiceAttackSteps[0];
  const upper = group.expectedNotes[0], lower = { ...upper, expectedNoteId: 'lower:C4', eventId: 'lower-event', renderNoteId: 'lower-render' };
  group.expectedNotes.push(lower); group.eventIds.push(lower.eventId); group.renderNoteIds.push(lower.renderNoteId);
  group.staffIds = ['1', '2']; group.voiceIds = ['1', '2'];
  group.strikeTargets[0].expectedNotes.push(structuredClone(lower));
  group.strikeTargets[0].eventIds.push(lower.eventId); group.strikeTargets[0].renderNoteIds.push(lower.renderNoteId);
  const lowerStep = { ...step.attackTargets[0].notes[0], stepNoteId: 'lower-step:C4', eventId: lower.eventId,
    renderNoteId: lower.renderNoteId, staffIds: ['2'], voiceIds: ['2'] };
  step.attackTargets[0].notes.push(lowerStep); step.attackTargets[0].eventIds.push(lower.eventId);
  step.attackTargets[0].renderNoteIds.push(lower.renderNoteId); step.renderNoteIds.push(lower.renderNoteId);
  step.eventIds.push(lower.eventId); step.staffIds = ['1','2']; step.voiceIds = ['1','2'];
  return value;
}

describe('physical-strike artifact boundary', () => {
  it('accepts canonical and same-pitch multi-voice notation without discarding render metadata or mutating it', () => {
    expect(() => assertPracticeScoreArtifact(artifact)).not.toThrow();
    const value = unisonArtifact(), before = structuredClone(value), serialized = JSON.stringify(value);
    expect(() => assertPracticeScoreArtifact(JSON.parse(serialized))).not.toThrow();
    assertPracticeScoreArtifact(value);
    expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serialized);
    expect(value.expectedPracticeGroups[0]).toMatchObject({ pitches: ['C4'], staffIds: ['1','2'], voiceIds: ['1','2'] });
    expect(value.expectedPracticeGroups[0].strikeTargets).toHaveLength(1);
    expect(value.expectedPracticeGroups[0].strikeTargets[0].expectedNotes).toHaveLength(2);
    expect(value.expectedPracticeGroups[0].strikeTargets[0].renderNoteIds).toEqual(['n1','lower-render']);
    expect(value.expectedPracticeGroups[0].renderNoteIds).toEqual(['n1','lower-render']);
    expect(value.practiceAttackSteps[0].attackTargets).toHaveLength(1);
    expect(value.practiceAttackSteps[0].attackTargets[0].notes).toHaveLength(2);
    expect(value.practiceAttackSteps[0].renderNoteIds).toEqual(['n1','lower-render']);
    expect(value.practiceAttackSteps[0].attackTargets[0].notes[1]).toMatchObject({ voiceIds: ['2'], staffIds: ['2'] });
  });
  const corruptions: [string, (value: PracticeScoreArtifact) => void, string][] = [
    ['duplicate group pitch', v => { v.expectedPracticeGroups[0].pitches.push('C4'); }, 'physical pitch in group'],
    ['duplicate strike pitch', v => { const t = structuredClone(v.expectedPracticeGroups[0].strikeTargets[0]); t.strikeId = 'second-C4'; v.expectedPracticeGroups[0].strikeTargets.push(t); }, 'physical pitch in strike targets'],
    ['duplicate attack pitch', v => { const t = structuredClone(v.practiceAttackSteps[0].attackTargets[0]); t.attackId = 'second-C4'; v.practiceAttackSteps[0].attackTargets.push(t); }, 'physical pitch in attack targets'],
    ['strike nested wrong pitch', v => { v.expectedPracticeGroups[0].strikeTargets[0].expectedNotes[0].pitch = 'D4'; }, 'target notation pitches'],
    ['attack nested wrong pitch', v => { v.practiceAttackSteps[0].attackTargets[0].notes[0].pitch = 'D4'; }, 'target notation pitches'],
    ['empty strike notation', v => { v.expectedPracticeGroups[0].strikeTargets[0].expectedNotes = []; }, 'target notation pitches'],
    ['empty attack notation', v => { v.practiceAttackSteps[0].attackTargets[0].notes = []; }, 'target notation pitches'],
    ['duplicated expected note ownership', v => { const g = v.expectedPracticeGroups[0]; g.strikeTargets[0].expectedNotes.push(structuredClone(g.expectedNotes[0])); }, 'target render-note identities'],
    ['expected note owned by two targets', v => { const g = v.expectedPracticeGroups[3]; g.strikeTargets[1].expectedNotes.push(structuredClone(g.expectedNotes[0])); g.strikeTargets[1].renderNoteIds.push(g.expectedNotes[0].renderNoteId); }, 'target notation pitches'],
    ['missing expected note', v => { const t = v.expectedPracticeGroups[0].strikeTargets[0]; t.expectedNotes.pop(); t.renderNoteIds.pop(); }, 'partition is incomplete'],
    ['strike render identities', v => { v.expectedPracticeGroups[0].strikeTargets[0].renderNoteIds = ['wrong']; }, 'target render-note identities'],
    ['attack render identities', v => { v.practiceAttackSteps[0].attackTargets[0].renderNoteIds = ['wrong']; }, 'target render-note identities'],
    ['extra strike render identity', v => { v.expectedPracticeGroups[0].strikeTargets[0].renderNoteIds.push('extra'); }, 'target render-note identities'],
    ['duplicate attack render identity', v => { v.practiceAttackSteps[0].attackTargets[0].renderNoteIds.push('n1'); }, 'target render-note identities'],
  ];
  it.each(corruptions)('rejects %s without repair', (_name, mutate, error) => {
    const value = unisonArtifact(); mutate(value);
    const before = structuredClone(value), serialized = JSON.stringify(value);
    expect(() => assertPracticeScoreArtifact(value)).toThrow(error);
    expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serialized);
  });
  it('allows continuation C4 and new physical C4 attack without treating continuation as another target', () => {
    const value = unisonArtifact(), step = value.practiceAttackSteps[0];
    step.continuation.push({ ...structuredClone(step.attackTargets[0].notes[0]), stepNoteId: 'tied:C4', renderNoteId: 'tied-render' });
    step.renderNoteIds.push('tied-render');
    expect(() => assertPracticeScoreArtifact(value)).not.toThrow();
    expect(attackPitchesForStep(step)).toEqual(['C4']);
  });
  it('STEP recognizes one C4 physical key for two notation voices', () => {
    const value = unisonArtifact(); expect(attackPitchesForStep(value.practiceAttackSteps[0])).toEqual(['C4']);
    const runtime = new StepPracticeRuntime({ artifact: value, scope: { kind: 'FULL' }, inputSource: 'MIDI', clock: new ManualClock(), localSessionId: 'unison' });
    const id = runtime.openAttempt({ domainId: 'unison', ms: 1 })!; runtime.analyzeAttempt(id);
    runtime.completeAttempt(id, { observedAttackPitches: ['C4'], confidence: 1, captureEndSessionTime: { domainId: 'unison', ms: 2 } });
    expect(runtime.snapshot().step.pendingPostVerdict?.verdict).toBe('MATCH');
  });
  it('Continuous projects one C4 strike retaining both render identities', () => {
    const value = unisonArtifact();
    const strikes = buildContinuousExpectedStrikes({ artifact: value, scope: { kind: 'FULL' }, tempoSelection: { mode: 'SCORE' } });
    const firstGroup = strikes.filter(strike => strike.groupId === value.expectedPracticeGroups[0].groupId);
    expect(firstGroup).toHaveLength(1);
    expect(firstGroup[0]).toMatchObject({ pitch: 'C4', renderNoteIds: ['n1','lower-render'] });
  });
});

describe('exact retained notation identities', () => {
  const corruptions: [string, (value: PracticeScoreArtifact) => void][] = [
    ['strike nested render alias with distinct expectedNoteIds', v => {
      const t = v.expectedPracticeGroups[0].strikeTargets[0]; t.expectedNotes[1].renderNoteId = 'n1'; t.renderNoteIds = ['n1'];
    }],
    ['distinct expected notes sharing a render identity', v => {
      const g = v.expectedPracticeGroups[0], t = g.strikeTargets[0];
      g.expectedNotes[1].renderNoteId = 'n1'; t.expectedNotes[1].renderNoteId = 'n1';
      g.renderNoteIds = ['n1']; t.renderNoteIds = ['n1'];
    }],
    ['distinct step notes sharing a render identity', v => {
      const s = v.practiceAttackSteps[0]; s.attackTargets[0].notes[1].renderNoteId = 'n1';
      s.attackTargets[0].renderNoteIds = ['n1']; s.renderNoteIds = ['n1'];
    }],
    ['missing group flat render identity', v => { v.expectedPracticeGroups[0].renderNoteIds.pop(); }],
    ['missing step attack flat render identity', v => { v.practiceAttackSteps[0].renderNoteIds.pop(); }],
    ['missing step continuation flat render identity', v => { v.practiceAttackSteps[3].renderNoteIds = v.practiceAttackSteps[3].attackTargets.flatMap(t => t.renderNoteIds); }],
    ['duplicate stepNoteId across attack notes', v => { const n = v.practiceAttackSteps[0].attackTargets[0].notes; n[1].stepNoteId = n[0].stepNoteId; }],
    ['duplicate stepNoteId across attack targets', v => { const t = v.practiceAttackSteps[3].attackTargets; t[1].notes[0].stepNoteId = t[0].notes[0].stepNoteId; }],
    ['stepNoteId shared by attack and continuation', v => { const s = v.practiceAttackSteps[3]; s.continuation[0].stepNoteId = s.attackTargets[0].notes[0].stepNoteId; }],
    ['empty attack stepNoteId', v => { v.practiceAttackSteps[0].attackTargets[0].notes[0].stepNoteId = ''; }],
    ['empty continuation stepNoteId', v => { v.practiceAttackSteps[3].continuation[0].stepNoteId = ''; }],
    ['empty expectedNoteId', v => { const g = v.expectedPracticeGroups[0]; g.expectedNotes[0].expectedNoteId = ''; g.strikeTargets[0].expectedNotes[0].expectedNoteId = ''; }],
    ['empty nested strike render identity', v => { v.expectedPracticeGroups[0].strikeTargets[0].expectedNotes[0].renderNoteId = ''; }],
    ['empty nested attack render identity', v => { v.practiceAttackSteps[0].attackTargets[0].notes[0].renderNoteId = ''; }],
    ['duplicate group flat render identity', v => { v.expectedPracticeGroups[0].renderNoteIds.push('n1'); }],
    ['duplicate step flat render identity', v => { v.practiceAttackSteps[0].renderNoteIds.push('n1'); }],
    ['empty group flat render identity', v => { v.expectedPracticeGroups[0].renderNoteIds[0] = ''; }],
    ['empty step flat render identity', v => { v.practiceAttackSteps[0].renderNoteIds[0] = ''; }],
    ['attack and continuation sharing render identity', v => { const s = v.practiceAttackSteps[3]; s.continuation[0].renderNoteId = s.attackTargets[0].notes[0].renderNoteId; }],
  ];
  it.each(corruptions)('rejects %s without mutation or deduplication', (_name, mutate) => {
    const value = unisonArtifact(); mutate(value);
    const before = structuredClone(value), serialized = JSON.stringify(value);
    expect(() => assertPracticeScoreArtifact(value)).toThrow();
    expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serialized);
  });
  it('accepts order-independent exact render aggregates without reordering caller data', () => {
    const value = unisonArtifact();
    value.expectedPracticeGroups[0].renderNoteIds.reverse();
    value.expectedPracticeGroups[0].strikeTargets[0].renderNoteIds.reverse();
    value.practiceAttackSteps[0].renderNoteIds.reverse();
    value.practiceAttackSteps[0].attackTargets[0].renderNoteIds.reverse();
    const before = structuredClone(value), serialized = JSON.stringify(value);
    assertPracticeScoreArtifact(value);
    expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serialized);
  });
});
