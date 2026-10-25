import { describe, expect, it } from 'vitest';
import { ContinuousAssignmentFinalizer } from './assignment-finalizer';
import { assertCompletedAssignment } from './assignment-projection';
import type { CompletedContinuousAssignment } from './assignment-types';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
function assignment(): Mutable<CompletedContinuousAssignment> {
  const f = new ContinuousAssignmentFinalizer('validation', [
    ...['C4','D4'].map(pitch => ({ strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch] })),
    { strikeId: 'G4', groupId: 'h', pitch: 'G4', expectedPerformanceTimeMs: 1800, renderNoteIds: ['G4'] },
  ]);
  f.publish({ publicationId: 'p', sessionDomainId: 'validation', analyzedThroughPerformanceMs: 4000, availabilityTimeMs: 4100,
    observations: ['C4','E4','F4','A4'].map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: pitch === 'A4' ? 1800 : 1000, confidence: 1, source: 'MIDI' })) });
  f.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 4000, availabilityTimeMs: 4100 });
  const result = f.completedAssignment();
  if (result.status !== 'COMPLETE') throw new Error('incomplete');
  return structuredClone(result.assignment) as Mutable<CompletedContinuousAssignment>;
}
describe('completed assignment relation integrity', () => {
  it('accepts the complete relation without modifying it', () => {
    const value = assignment(), before = structuredClone(value);
    expect(() => assertCompletedAssignment(value)).not.toThrow();
    expect(value).toEqual(before);
  });
  it.each<[string, (value: Mutable<CompletedContinuousAssignment>) => void]>([
    ['unknown residual strike', value => { value.groups[0].residualAssignments[0].strikeId = 'absent'; }],
    ['foreign group strike', value => { value.groups[0].residualAssignments[0].strikeId = 'G4'; }],
    ['matched residual strike', value => { value.groups[0].residualAssignments[0].strikeId = 'C4'; }],
    ['not-reached residual strike', value => { value.groups[0].strikes[1].state = 'NOT_REACHED'; }],
    ['duplicate residual slot', value => {
      const extra = value.unattributedObservations[0];
      value.groups[0].residualAssignments.push({ strikeId: 'D4', observation: extra.observation, timingOffsetMs: 0 });
      value.unattributedObservations = [];
      value.observationAssignments = value.observationAssignments.map(row => row.observationId === extra.observation.observationId
        ? { kind: 'GROUP_RESIDUAL', groupId: 'g', strikeId: 'D4', observationId: row.observationId } : row);
    }],
    ['wrong flat group', value => { const row = value.observationAssignments.find(row => row.kind === 'GROUP_RESIDUAL')!; if (row.kind === 'GROUP_RESIDUAL') row.groupId = 'absent'; }],
    ['wrong flat strike', value => { const row = value.observationAssignments.find(row => row.kind === 'GROUP_RESIDUAL')!; if (row.kind === 'GROUP_RESIDUAL') row.strikeId = 'C4'; }],
    ['unknown flat observation', value => { value.observationAssignments[0].observationId = 'absent'; }],
    ['duplicate observation relation', value => { value.observationAssignments[1] = value.observationAssignments[0]; }],
    ['missing observation relation', value => { value.observationAssignments.pop(); }],
    ['missing ledger observation', value => { value.observations.pop(); }],
    ['unassigned ledger observation', value => { value.observations.push({ ...value.observations[0], observationId: 'unassigned' }); }],
    ['duplicate ledger identity', value => { value.observations.push(value.observations[0]); }],
    ['changed residual payload', value => { value.groups[0].residualAssignments[0].observation = { ...value.groups[0].residualAssignments[0].observation, pitch: 'B4' }; }],
    ['inconsistent residual timing', value => { value.groups[0].residualAssignments[0].timingOffsetMs = 10; }],
    ['non-finite residual timing', value => { value.groups[0].residualAssignments[0].timingOffsetMs = NaN; }],
    ['strike group disagreement', value => { value.groups[0].strikes[1].groupId = 'h'; }],
    ['duplicated strike identity', value => { value.groups[1].strikes[0].strikeId = 'D4'; }],
    ['duplicated group identity', value => { value.groups[1].groupId = 'g'; }],
  ])('rejects %s rather than repairing retained truth', (_name, corrupt) => {
    const value = assignment();
    corrupt(value);
    expect(() => assertCompletedAssignment(value)).toThrow();
  });
});
