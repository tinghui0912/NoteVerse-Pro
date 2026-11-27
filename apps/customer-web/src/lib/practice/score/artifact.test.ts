import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { PracticeTempoTimeline } from '@/lib/practice/planning/tempo';
import { stepPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { describe, expect, it } from 'vitest';
import canonical from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { artifactWithKeys } from '@/lib/practice/__fixtures__/piano-key-artifact';
import { notesForIds, type PracticeScoreArtifact } from './artifact';
import { projectPracticeMomentView } from '@/lib/practice/score-view/moment-view';
import { resolvePracticeScope } from '../planning/scope';
import { StepPracticeSession } from '@/lib/practice/step/domain/practice-session';
import { ManualClock } from '../session/timebase';
import { buildContinuousExpectedStrikesFromTimeline } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';
const fixture = canonical as PracticeScoreArtifact;
function unison(): PracticeScoreArtifact {
  const value = structuredClone(fixture), upper = value.notes[0];
  value.notes.splice(1, 0, { ...upper, noteId: 'lower-note', eventId: 'lower-event', renderNoteId: 'lower-render', staffId: '2', voiceId: '2' });
  value.events.splice(1, 0, { ...value.events[0], eventId: 'lower-event' });
  value.moments[0].attacks[0].noteIds.push('lower-note');
  return value;
}
function strikes(artifact: PracticeScoreArtifact) {
  const plan = continuousPracticePlan(artifact);
  return buildContinuousExpectedStrikesFromTimeline(artifact, new PracticeTempoTimeline(plan.tempoPlan, artifact.scoreEndTick, artifact.ticksPerQuarter), plan.scope);
}
describe('one canonical Practice note graph and moment sequence', () => {
  it('accepts the deterministic producer fixture and exact canonical transport fields', () => {

    expect(fixture.schemaVersion).toBe(1); expect(fixture.artifactId).toBe('practice-score-artifact:f302746d7229b692');
    expect(fixture.notes).toHaveLength(7);
    expect(new Set(fixture.notes.map(n => n.noteId)).size).toBe(fixture.notes.length);
    expect(fixture.moments.map(m => m.attacks.map(a => a.pianoKey))).toEqual([[60],[60],[67],[69,72],[74]]);
    expect(Object.keys(fixture.meterSegments[0]).sort()).toEqual(['startTick','numerator','denominator'].sort());
    expect(Object.keys(fixture).sort()).toEqual(['schemaVersion','artifactId','notes','events','moments',
      'meterSegments','scoreTempoSegments','scoreEndTick','ticksPerQuarter'].sort());
  });
  it('two unison notation identities produce one STEP attack and one Continuous strike carrying both render IDs', () => {
    const value = unison(), before = structuredClone(value);

    const attack = value.moments[0].attacks[0];
    expect(attack.noteIds).toHaveLength(2);
    expect(notesForIds(value, attack.noteIds).map(n => n.renderNoteId)).toEqual(['n1','lower-render']);
    const runtime = new StepPracticeSession({ plan: stepPracticePlan(value, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock: new ManualClock(), localSessionId: 'unison' });
    expect(runtime.currentTarget()).toMatchObject({ stepId: value.moments[0].groupId, attackKeys: [60] });
    const time = (ms: number) => ({ domainId: 'unison', ms });
    const id = runtime.openAttempt(time(1))!; runtime.analyzeAttempt(id);
    expect(runtime.completeAttempt(id, { observedAttackKeys: [60], confidence: .8, captureEndSessionTime: time(2) }))
      .toMatchObject({ kind: 'FINALIZED', record: { verdict: 'MATCH' } });
    expect(strikes(value).filter(s => s.groupId === value.moments[0].groupId)).toEqual([
      expect.objectContaining({ strikeId: attack.attackId, pianoKey: 60, renderNoteIds: ['n1','lower-render'] })]);
    const view = projectPracticeMomentView(value, value.moments[0]);
    expect(view.renderNoteIds).toEqual(['n1','lower-render']); expect(Object.isFrozen(view.renderNoteIds)).toBe(true);
    expect(value).toEqual(before);
  });
  it('a C4/E4 chord owns exactly two attacks for both modes; continuation is never a second strike', () => {
    const value = artifactWithKeys([[60,64]]);

    expect(value.moments[0].attacks.map(a => a.pianoKey)).toEqual([60,64]);
    expect(strikes(value).map(s => s.pianoKey)).toEqual([60,64]);
    const tied = structuredClone(fixture), moment = tied.moments[3];
    const continuation = notesForIds(tied, moment.continuationNoteIds);
    expect(continuation.map(n => n.pianoKey)).toEqual([67]);
    expect(strikes(tied).filter(s => s.groupId === moment.groupId).map(s => s.pianoKey)).toEqual([69,72]);
    // The canonical graph still resolves all continuation render facts for cursor consumers.
    expect(continuation.map(n => n.renderNoteId)).toEqual(['n4']);
    const runtime = new StepPracticeSession({ plan: stepPracticePlan(tied, { scope: { kind: 'RANGE', startGroupId: moment.groupId, endGroupId: moment.groupId }, inputSource: 'MICROPHONE' }), clock: new ManualClock() });
    expect(runtime.currentTarget()).toMatchObject({ attackKeys: [69,72], continuationKeys: [67] });
  });
  it('FULL and RANGE use the same valid graph and canonical group identity', () => {
    expect(resolvePracticeScope(fixture, { kind: 'FULL' })).toMatchObject({ startIndex: 0, endIndex: 4 });
    for (const moment of fixture.moments) expect(resolvePracticeScope(fixture, { kind: 'RANGE', startGroupId: moment.groupId, endGroupId: moment.groupId })).toMatchObject({ startTick: moment.onsetTick, terminalTick: moment.canonicalEndTick });
  });
});
