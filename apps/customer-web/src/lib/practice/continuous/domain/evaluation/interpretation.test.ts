import { describe, expect, it } from 'vitest';
import { ContinuousAssignmentFinalizer } from './assignment-finalizer';
import { interpretContinuousAssignment } from './interpretation';
import type { ContinuousObservation } from './evidence-types';

function chord(pitches: readonly string[], source: ContinuousObservation['source'] = 'ACOUSTIC', confidence = 1, terminal = 3000) {
  const finalizer = new ContinuousAssignmentFinalizer('chord', ['C4', 'D4'].map(pitch => ({
    strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch],
  })));
  finalizer.complete({ reason: terminal < 1000 ? 'STOPPED_BY_USER' : 'SCOPE_COMPLETED', performanceTimeMs: terminal, availabilitySessionTimeMs: 3100 });
  finalizer.publish({ publicationId: 'p', sessionDomainId: 'chord', analyzedThroughPerformanceMs: terminal, availabilitySessionTimeMs: 3100,
    observations: pitches.map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: 1000, source, confidence,
      provenance: { sourceDomainId: 'source', sourceEventSample: 44100, sourceSampleRateHz: 44100 } })) });
  return finalizer;
}
describe('source-specific interpretation of immutable assignment', () => {
  it.each([
    { pitches: ['C4','E4'], states: ['MATCHED','UNMATCHED'], kinds: ['STRIKE_MATCH','GROUP_RESIDUAL'], midi: 'WRONG', acoustic: 'PARTIALLY_SUPPORTED' },
    { pitches: ['C4','D4','E4'], states: ['MATCHED','MATCHED'], kinds: ['STRIKE_MATCH','STRIKE_MATCH','UNATTRIBUTED'], midi: 'CORRECT', acoustic: 'SUPPORTED' },
    { pitches: ['C4'], states: ['MATCHED','UNMATCHED'], kinds: ['STRIKE_MATCH'], midi: 'INCOMPLETE_CHORD', acoustic: 'PARTIALLY_SUPPORTED' },
    { pitches: ['E4'], states: ['UNMATCHED','UNMATCHED'], kinds: ['GROUP_RESIDUAL'], midi: 'WRONG', acoustic: 'UNCONFIRMED' },
    { pitches: ['C4','D4'], states: ['MATCHED','MATCHED'], kinds: ['STRIKE_MATCH','STRIKE_MATCH'], midi: 'CORRECT', acoustic: 'SUPPORTED' },
  ])('$pitches: raw ownership stays separate from MIDI and acoustic feedback', ({ pitches, states, kinds, midi, acoustic }) => {
    const finalizer = chord(pitches), raw = finalizer.snapshot(), before = JSON.stringify(raw);
    expect(raw.groups[0].strikes.map(strike => strike.state)).toEqual(states);
    expect(raw.observationAssignments.map(row => row.kind)).toEqual(kinds);
    const midiFeedback = interpretContinuousAssignment(raw, 'MIDI');
    const acousticFeedback = interpretContinuousAssignment(raw, 'MICROPHONE');
    expect(midiFeedback.groups[0].verdict).toBe(midi);
    expect(acousticFeedback.groups[0].verdict).toBe(acoustic);
    expect(acousticFeedback).not.toHaveProperty('extraObservations');
    expect(Object.keys(acousticFeedback.groups[0]).sort()).toEqual(['groupId','strikes','verdict']);
    expect(JSON.stringify(raw)).toBe(before);
    expect(Object.isFrozen(raw)).toBe(true);
    expect(Object.isFrozen(acousticFeedback.groups[0].strikes)).toBe(true);
    const completed = finalizer.completedAssignment();
    expect(completed.status).toBe('COMPLETE');
    if (completed.status !== 'COMPLETE') throw new Error('incomplete');
    expect(completed.assignment.groups[0]).toBe(raw.groups[0]);
    expect(raw.reservedObservationIds).toEqual([]);
    expect(new Set(raw.observationAssignments.map(row => row.observationId)).size).toBe(pitches.length);
    expect(completed.assignment.observations).toHaveLength(pitches.length);
    expect(completed.assignment.groups.every(group => group.state === 'FINALIZED' && group.strikes.every(strike => strike.state !== ('PENDING' as string)))).toBe(true);
  });
  it('manual stop before target coverage is NOT_REACHED for both sources', () => {
    const raw = chord([], 'MIDI', 1, 500).snapshot();
    for (const source of ['MIDI', 'MICROPHONE'] as const) {
      const feedback = interpretContinuousAssignment(raw, source);
      expect(feedback.groups[0].verdict).toBe('NOT_REACHED');
      expect(feedback.groups[0].strikes.map(strike => strike.state)).toEqual(['NOT_REACHED','NOT_REACHED']);
    }
  });
  it.each([
    { pitches: ['C4','E4'], states: ['CORRECT','WRONG'], wrong: [['D4','E4']], group: 'WRONG' },
    { pitches: ['C4'], states: ['CORRECT','MISSING'], wrong: [], group: 'INCOMPLETE_CHORD' },
    { pitches: ['E4'], states: ['WRONG','MISSING'], wrong: [['C4','E4']], group: 'WRONG' },
    { pitches: ['E4','F4'], states: ['WRONG','WRONG'], wrong: [['C4','E4'],['D4','F4']], group: 'WRONG' },
    { pitches: ['C4','D4','E4'], states: ['CORRECT','CORRECT'], wrong: [], group: 'CORRECT' },
    { pitches: ['C4','E4','F4'], states: ['CORRECT','WRONG'], wrong: [['D4','E4']], group: 'WRONG' },
    { pitches: [], states: ['MISSING','MISSING'], wrong: [], group: 'MISSING' },
  ])('$pitches produces one MIDI outcome per target with played-pitch detail', ({ pitches, states, wrong, group }) => {
    const feedback = interpretContinuousAssignment(chord(pitches, 'MIDI').snapshot(), 'MIDI');
    if (feedback.inputSource !== 'MIDI') throw new Error('source');
    expect(feedback.groups[0].strikes.map(strike => strike.state)).toEqual(states);
    expect(feedback.groups[0].verdict).toBe(group);
    expect(feedback.groups[0].strikes.flatMap(strike => strike.state === 'WRONG' ? [[strike.strikeId, strike.observation.pitch]] : [])).toEqual(wrong);
    expect(feedback.groups[0].strikes.filter(strike => strike.state === 'WRONG').every(strike => strike.timingOffsetMs === 0)).toBe(true);
    expect(Object.keys(feedback.groups[0]).sort()).toEqual(['groupId','strikes','verdict']);
  });
  it('raw assignment ignores provenance source while retaining the complete evidence ledger', () => {
    const normalize = (source: ContinuousObservation['source']) => JSON.parse(JSON.stringify(chord(['C4','E4'], source).snapshot()), (key, value) => key === 'source' ? undefined : value);
    expect(normalize('MIDI')).toEqual(normalize('ACOUSTIC'));
    const raw = chord(['C4'], 'ACOUSTIC', 0.01).snapshot();
    expect(raw.observations[0]).toMatchObject({ confidence: 0.01, source: 'ACOUSTIC', provenance: { sourceEventSample: 44100 } });
  });
  it.each([0, 0.01, 0.49, 0.99, 1])('does not apply a second acoustic confidence threshold: %s', confidence => {
    const feedback = interpretContinuousAssignment(chord(['C4','D4'], 'ACOUSTIC', confidence).snapshot(), 'MICROPHONE');
    expect(feedback.groups[0].verdict).toBe('SUPPORTED');
  });
});
