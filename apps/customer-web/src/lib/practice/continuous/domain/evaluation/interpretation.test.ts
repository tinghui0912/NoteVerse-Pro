import { describe, expect, it } from 'vitest';
import { ContinuousAssignmentFinalizer } from './assignment-finalizer';
import { interpretContinuousAssignment } from './interpretation';

const cases = [
  { name: 'silence', pitches: [], midi: ['MISSING','MISSING'], acoustic: ['NOT_DETECTED','NOT_DETECTED'], midiGroup: 'MISSING', acousticGroup: 'NOT_DETECTED' },
  { name: 'C4 + E4', pitches: ['C4','E4'], midi: ['CORRECT','MISSING'], acoustic: ['SUPPORTED','NOT_DETECTED'], midiGroup: 'INCOMPLETE_CHORD', acousticGroup: 'PARTIALLY_SUPPORTED' },
  { name: 'C4 only', pitches: ['C4'], midi: ['CORRECT','MISSING'], acoustic: ['SUPPORTED','NOT_DETECTED'], midiGroup: 'INCOMPLETE_CHORD', acousticGroup: 'PARTIALLY_SUPPORTED' },
  { name: 'C4 + D4', pitches: ['C4','D4'], midi: ['CORRECT','CORRECT'], acoustic: ['SUPPORTED','SUPPORTED'], midiGroup: 'CORRECT', acousticGroup: 'SUPPORTED' },
];
function chord(pitches: readonly string[], source: 'MIDI' | 'ACOUSTIC', confidence = 1) {
  const f = new ContinuousAssignmentFinalizer('chord', ['C4','D4'].map(pitch => ({ strikeId: pitch, groupId: 'g', pitch,
    expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch] })));
  const observations = pitches.map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: 1000, confidence, source,
    provenance: { sourceDomainId: 'source', sourceEventSample: 48000, sourceSampleRateHz: 48000 } }));
  const before = structuredClone(observations);
  f.publish({ publicationId: 'p', sessionDomainId: 'chord', analyzedThroughPerformanceMs: 3000, availabilitySessionTimeMs: 3100, observations });
  expect(observations).toEqual(before); expect(observations.every(o => !Object.isFrozen(o))).toBe(true);
  f.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 3000, availabilitySessionTimeMs: 3100 });
  return f;
}
describe('physical target support, independent of non-target pitches', () => {
  for (const inputSource of ['MIDI','MICROPHONE'] as const) it.each(cases)(inputSource + ' $name', row => {
    const f = chord(row.pitches, inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC'), result = f.completedAssignment();
    if (result.status !== 'COMPLETE') throw Error('incomplete');
    const before = JSON.stringify(result.assignment), interpretation = interpretContinuousAssignment(result.assignment, inputSource);
    expect(interpretation.groups[0].strikes.map(strike => strike.state)).toEqual(inputSource === 'MIDI' ? row.midi : row.acoustic);
    expect(interpretation.groups[0].verdict).toBe(inputSource === 'MIDI' ? row.midiGroup : row.acousticGroup);
    expect(Object.keys(interpretation).sort()).toEqual(['groups','inputSource','interpretationPolicyId']);
    expect(result.assignment.observations.map(o => o.pitch)).toEqual(row.pitches);
    expect(result.assignment.unattributedObservations.map(row => row.observation.pitch)).toEqual(row.pitches.filter(pitch => !['C4','D4'].includes(pitch)));
    expect(result.assignment.observationAssignments.every(row => row.kind === 'STRIKE_MATCH' || row.kind === 'UNATTRIBUTED')).toBe(true);
    expect(f.snapshot().reservedObservationIds).toEqual([]); expect(JSON.stringify(result.assignment)).toBe(before);
  });
  it.each([0, .01, .49, .99, 1])('does not re-threshold decoder-qualified acoustic support at confidence %s', confidence => {
    const result = chord(['C4','D4'], 'ACOUSTIC', confidence).completedAssignment(); if (result.status !== 'COMPLETE') throw Error('incomplete');
    expect(interpretContinuousAssignment(result.assignment, 'MICROPHONE').groups[0].verdict).toBe('SUPPORTED');
  });
  it('unavailable analysis is distinct from healthy NOT_DETECTED targets', () => {
    const f = new ContinuousAssignmentFinalizer('waiting', [{ strikeId: 'c', groupId: 'g', pitch: 'C4', expectedPerformanceTimeMs: 1000, renderNoteIds: ['c'] }]);
    expect(interpretContinuousAssignment(f.snapshot(), 'MICROPHONE').groups[0].strikes[0].state).toBe('PENDING');
    expect(f.completedAssignment()).toEqual({ status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' });
    f.publish({ publicationId: 'stop', sessionDomainId: 'waiting', analyzedThroughPerformanceMs: 500, availabilitySessionTimeMs: 500, observations: [] });
    f.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 500, availabilitySessionTimeMs: 500 });
    expect(interpretContinuousAssignment(f.snapshot(), 'MICROPHONE').groups[0].strikes[0].state).toBe('NOT_REACHED');
  });
});
