import { continuousSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { PracticeTempoTimeline } from '@/lib/practice/kernel/tempo';
import { stepSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { describe, expect, it } from 'vitest';
import canonical from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { artifactWithKeys } from '@/lib/practice/__fixtures__/piano-key-artifact';
import { assertPracticeScoreArtifact, parsePracticeScoreArtifact, notesForIds, type PracticeScoreArtifact } from './artifact';
import { projectPracticeMomentView } from '@/lib/practice/score-view/moment-view';
import { resolvePracticeScope } from './scope';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from './timebase';
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
  const plan = continuousSessionPlan(artifact);
  return buildContinuousExpectedStrikesFromTimeline(artifact, new PracticeTempoTimeline(plan.tempoPlan, artifact.scoreEndBeat), plan.scope);
}
describe('one canonical Practice note graph and moment sequence', () => {
  it('accepts the deterministic producer fixture and exact canonical transport fields', () => {
    assertPracticeScoreArtifact(fixture);
    expect(fixture.schemaVersion).toBe(3); expect(fixture.artifactId).toBe('practice-score-artifact:c2f3275222932efa');
    expect(fixture.notes).toHaveLength(7);
    expect(new Set(fixture.notes.map(n => n.noteId)).size).toBe(fixture.notes.length);
    expect(fixture.moments.map(m => m.attacks.map(a => a.pianoKey))).toEqual([[60],[60],[67],[69,72],[74]]);
    expect(Object.keys(fixture).sort()).toEqual(['schemaVersion','scoreId','revisionId','artifactId','notes','events','moments',
      'meterSegments','scoreTempoSegments','firstPlayableBeat','scoreEndBeat'].sort());
  });
  it('two unison notation identities produce one STEP attack and one Continuous strike carrying both render IDs', () => {
    const value = unison(), before = structuredClone(value);
    assertPracticeScoreArtifact(value);
    const attack = value.moments[0].attacks[0];
    expect(attack.noteIds).toHaveLength(2);
    expect(notesForIds(value, attack.noteIds).map(n => n.renderNoteId)).toEqual(['n1','lower-render']);
    const runtime = new StepPracticeRuntime({ ...stepSessionPlan(value, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock: new ManualClock(), localSessionId: 'unison' });
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
    assertPracticeScoreArtifact(value);
    expect(value.moments[0].attacks.map(a => a.pianoKey)).toEqual([60,64]);
    expect(strikes(value).map(s => s.pianoKey)).toEqual([60,64]);
    const tied = structuredClone(fixture), moment = tied.moments[3];
    const continuation = notesForIds(tied, moment.continuationNoteIds);
    expect(continuation.map(n => n.pianoKey)).toEqual([67]);
    expect(strikes(tied).filter(s => s.groupId === moment.groupId).map(s => s.pianoKey)).toEqual([69,72]);
    // The canonical graph still resolves all continuation render facts for cursor consumers.
    expect(continuation.map(n => n.renderNoteId)).toEqual(['n4']);
    const runtime = new StepPracticeRuntime({ ...stepSessionPlan(tied, { scope: { kind: 'RANGE', startGroupId: moment.groupId, endGroupId: moment.groupId }, inputSource: 'MICROPHONE' }), clock: new ManualClock() });
    expect(runtime.currentTarget()).toMatchObject({ attackKeys: [69,72], continuationKeys: [67] });
  });
  it('FULL and RANGE use the same valid graph and canonical group identity', () => {
    expect(resolvePracticeScope(fixture, { kind: 'FULL' })).toMatchObject({ startIndex: 0, endIndex: 4 });
    for (const moment of fixture.moments) expect(resolvePracticeScope(fixture, { kind: 'RANGE', startGroupId: moment.groupId, endGroupId: moment.groupId })).toMatchObject({ startBeat: moment.onsetBeat, terminalBeat: moment.canonicalEndBeat });
  });
});

type Corrupt = (value: PracticeScoreArtifact) => void;
const corruptions: [string, Corrupt][] = [
  ['dangling note', v => { v.moments[0].attacks[0].noteIds[0] = 'missing'; }],
  ['duplicate canonical note', v => { v.notes.push(structuredClone(v.notes[0])); }],
  ['duplicate render identity', v => { v.notes[1].renderNoteId = v.notes[0].renderNoteId; }],
  ['wrong physical key reference', v => { v.moments[0].attacks[0].pianoKey = 62; }],
  ['same note owned by two attacks', v => { v.moments[0].attacks.push({ ...v.moments[0].attacks[0], attackId: 'other', pianoKey: 62 }); }],
  ['missing attack reference', v => { v.moments[0].attacks[0].noteIds.pop(); }],
  ['duplicate reference', v => { v.moments[0].attacks[0].noteIds.push(v.moments[0].attacks[0].noteIds[0]); }],
  ['duplicate attack identity', v => { v.moments[1].attacks[0].attackId = v.moments[0].attacks[0].attackId; }],
  ['duplicate physical attack', v => { v.moments[0].attacks.push({ ...v.moments[0].attacks[0], attackId: 'second' }); }],
  ['dangling event', v => { v.notes[0].eventId = 'missing'; }],
  ['empty event', v => { v.events.splice(1, 0, { ...v.events[0], eventId: 'empty' }); }],
  ['event/moment onset disagreement', v => { v.events[0].onsetBeat = -1; }],
  ['reordered chronology', v => { v.events.reverse(); }],
  ['nonfinite event duration', v => { v.events[0].durationBeats = Infinity; }],
  ['duplicate moment', v => { v.moments[1].groupId = v.moments[0].groupId; }],
  ['moment chronology', v => { v.moments[1].onsetBeat = .5; }],
  ['missing moment', v => { v.moments.pop(); }],
  ['bad canonical endpoint', v => { v.moments[0].canonicalEndBeat += 1; }],
  ['NaN endpoint', v => { v.moments[0].canonicalEndBeat = NaN; }],
  ['empty attacks', v => { v.moments[0].attacks = []; }],
  ['missing continuation', v => { v.moments[3].continuationNoteIds = []; }],
  ['duplicate continuation', v => { v.moments[3].continuationNoteIds.push(v.moments[3].continuationNoteIds[0]); }],
  ['continuation owned as attack', v => { v.moments[3].attacks[0].noteIds.push(v.moments[3].continuationNoteIds[0]); }],
  ['attack as continuation', v => { v.moments[0].continuationNoteIds.push(v.moments[0].attacks[0].noteIds[0]); }],
  ['bad tie grammar', v => { Object.assign(v.notes[0], { tieTypes: ['other'] }); }],
  ['unsupported schema version', v => { Object.assign(v, { schemaVersion: 999 }); }],
  ['unknown top-level field', v => { Object.assign(v, { unexpectedField: [] }); }],
  ['invalid score extent', v => { v.scoreEndBeat += 1; }],
  ['empty revision', v => { v.notes = []; v.events = []; v.moments = []; }],
];
it.each(corruptions)('rejects %s without coercion, repair or mutation', (_label, corrupt) => {
  const value = unison(); corrupt(value);
  const before = structuredClone(value), json = JSON.stringify(value);
  expect(() => assertPracticeScoreArtifact(value)).toThrow();
  expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(json);
});
it.each([20,109,60.5,NaN,Infinity,true,'60','C4'])('rejects a later unselected invalid key %s revision-wide', key => {
  const value = structuredClone(fixture); Object.assign(value.notes.at(-1)!, { pianoKey: key });
  expect(() => assertPracticeScoreArtifact(value)).toThrow();
});

it.each([{meterSegments:[]},{meterSegments:[{...fixture.meterSegments[0],startBeat:1}]}])('strict parser rejects missing initial meter without repair',({meterSegments})=>{
  const value={...structuredClone(fixture),meterSegments},before=structuredClone(value);
  expect(()=>parsePracticeScoreArtifact(value)).toThrow(expect.objectContaining({code:'practice_score_invalid'}));
  expect(value).toEqual(before);
});
it('strict parser admits explicit initial meter and physical notation without tonal metadata',()=>{
  const value=structuredClone(fixture);expect(parsePracticeScoreArtifact(value)).toBe(value);
  expect(value.meterSegments[0]).toMatchObject({startBeat:0,source:'MUSICXML'});
  expect(Object.keys(value).sort()).toEqual(['schemaVersion','scoreId','revisionId','artifactId','notes','events','moments',
    'meterSegments','scoreTempoSegments','firstPlayableBeat','scoreEndBeat'].sort());
});
