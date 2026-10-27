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
  f.publish({ publicationId: 'p', sessionDomainId: 'validation', analyzedThroughPerformanceMs: 4000, availabilitySessionTimeMs: 4100,
    observations: ['C4','E4','F4','A4'].map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: pitch === 'A4' ? 1800 : 1000, confidence: 1, source: 'MIDI' })) });
  f.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 4000, availabilitySessionTimeMs: 4100 });
  const result = f.completedAssignment();
  if (result.status !== 'COMPLETE') throw new Error('incomplete');
  return structuredClone(result.assignment) as Mutable<CompletedContinuousAssignment>;
}
describe('completed assignment relation integrity', () => {
  describe.each(['SCOPE_COMPLETED', 'STOPPED_BY_USER'] as const)('%s terminal clamp equivalence', reason => {
    for (const owner of ['strike', 'group', 'unattributed observation'] as const) {
      it.each([
        { label: 'unclamped below terminal', unclamped: 800, required: 800, terminalClamp: false, valid: true },
        { label: 'unclamped at terminal', unclamped: 1000, required: 1000, terminalClamp: false, valid: true },
        { label: 'clamped to terminal', unclamped: 1100, required: 1000, terminalClamp: true, valid: true },
        { label: 'false clamp above terminal despite sufficient coverage', unclamped: 1100, required: 1100, terminalClamp: false, valid: false },
        { label: 'true clamp below terminal', unclamped: 800, required: 1000, terminalClamp: true, valid: false },
        { label: 'true clamp at terminal', unclamped: 1000, required: 1000, terminalClamp: true, valid: false },
        { label: 'clamped required below terminal', unclamped: 1100, required: 900, terminalClamp: true, valid: false },
        { label: 'clamped required 800 below terminal', unclamped: 1250, required: 800, terminalClamp: true, valid: false },
        { label: 'clamped required above terminal', unclamped: 1250, required: 1100, terminalClamp: true, valid: false },
      ])(`${owner}: $label`, ({ unclamped, required, terminalClamp, valid }) => {
        const f = new ContinuousAssignmentFinalizer('terminal-anchor', ['C4', 'D4'].map(pitch => ({
          strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch],
        })));
        f.complete({ reason, performanceTimeMs: 1000, availabilitySessionTimeMs: 2000 });
        f.publish({ publicationId: 'tail', sessionDomainId: 'terminal-anchor', analyzedThroughPerformanceMs: 1000,
          availabilitySessionTimeMs: 3000, observations: ['C4', 'D4', 'E4'].map(pitch => ({
            observationId: pitch, pitch, performanceTimeMs: 900, confidence: 1, source: 'MIDI',
          })) });
        const result = f.completedAssignment(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
        const value = structuredClone(result.assignment) as Mutable<CompletedContinuousAssignment>;
        expect(() => assertCompletedAssignment(value)).not.toThrow();
        expect(value.completion).toEqual({ reason, performanceTimeMs: 1000, availabilitySessionTimeMs: 3000 });
        const finality = owner === 'strike' ? value.groups[0].strikes[0].finality : owner === 'group'
          ? value.groups[0].finality : value.unattributedObservations[0].finality;
        expect(finality).toMatchObject({ terminalClamp: true, requiredAnalysisFrontierMs: 1000,
          unclampedRequiredFrontierMs: 1250, finalizationSessionTimeMs: 3000 });
        finality.requiredAnalysisFrontierMs = required;
        finality.unclampedRequiredFrontierMs = unclamped;
        finality.terminalClamp = terminalClamp;
        // Sufficient enabling coverage isolates impossible clamp semantics from coverage failures.
        for (const group of value.groups) {
          group.finality.enablingAnalysisFrontierMs = 1250;
          for (const strike of group.strikes) strike.finality.enablingAnalysisFrontierMs = 1250;
        }
        for (const row of value.unattributedObservations) row.finality.enablingAnalysisFrontierMs = 1250;
        const before = structuredClone(value);
        const serializedBefore = JSON.stringify(value);
        if (valid) expect(() => assertCompletedAssignment(value)).not.toThrow();
        else expect(() => assertCompletedAssignment(value)).toThrow('finality coordinates are corrupt');
        expect(value).toEqual(before);
        expect(JSON.stringify(value)).toBe(serializedBefore);
      });
    }
  });
  it.each(['SCOPE_COMPLETED', 'STOPPED_BY_USER'] as const)('%s requested before delayed terminal coverage retains causal completion availability', reason => {
    const f = new ContinuousAssignmentFinalizer('tail', [{ strikeId: 'c', groupId: 'g', pitch: 'C4', expectedPerformanceTimeMs: 1900, renderNoteIds: [] }]);
    f.publish({ publicationId: 'early', sessionDomainId: 'tail', analyzedThroughPerformanceMs: 500, availabilitySessionTimeMs: 1000, observations: [] });
    const request = Object.freeze({ reason, performanceTimeMs: 2000, availabilitySessionTimeMs: 2000 });
    f.complete(request);
    f.publish({ publicationId: 'tail', sessionDomainId: 'tail', analyzedThroughPerformanceMs: 2000, availabilitySessionTimeMs: 3000, observations: [] });
    const result = f.completedAssignment(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.assignment.groups[0].finality).toMatchObject({ finalizationSessionTimeMs: 3000,
      terminalClamp: true, requiredAnalysisFrontierMs: 2000, unclampedRequiredFrontierMs: 2150 });
    expect(result.assignment.groups[0].strikes[0].finality).toMatchObject({ terminalClamp: true,
      requiredAnalysisFrontierMs: 2000, unclampedRequiredFrontierMs: 2150 });
    expect(result.assignment.completion).toEqual({ reason, performanceTimeMs: 2000, availabilitySessionTimeMs: 3000 });
    expect(request.availabilitySessionTimeMs).toBe(2000);
    expect(f.complete(request).completion).toEqual(result.assignment.completion);
    expect(() => assertCompletedAssignment(result.assignment)).not.toThrow();
  });
  it.each<[string, (value: Mutable<CompletedContinuousAssignment>) => void]>([
    ['coverage not reached', value => { value.groups[0].finality.requiredAnalysisFrontierMs = value.groups[0].finality.enablingAnalysisFrontierMs + 1; }],
    ['required exceeds unclamped', value => { value.groups[0].finality.unclampedRequiredFrontierMs = value.groups[0].finality.requiredAnalysisFrontierMs - 1; }],
    ['unclamped false with unequal bounds', value => { value.groups[0].finality.unclampedRequiredFrontierMs++; }],
    ['clamped true with equal bounds', value => { value.groups[0].finality.terminalClamp = true; }],
    ['clamped true with inverted bounds', value => { const f = value.groups[0].finality; f.terminalClamp = true; f.unclampedRequiredFrontierMs = f.requiredAnalysisFrontierMs - 1; }],
    ['group session time before strike', value => { value.groups[0].strikes[0].finality.finalizationSessionTimeMs = 4000; value.groups[0].finality.finalizationSessionTimeMs = 3000; }],
    ['group frontier before strike', value => { value.groups[0].strikes[0].finality.enablingAnalysisFrontierMs = value.groups[0].finality.enablingAnalysisFrontierMs + 1; }],
    ['completion before strike', value => { value.completion.availabilitySessionTimeMs = 3000; value.groups[0].strikes[0].finality.finalizationSessionTimeMs = 4000; }],
    ['completion before group', value => { value.completion.availabilitySessionTimeMs = 3000; value.groups[0].finality.finalizationSessionTimeMs = 4000; }],
    ['completion before unattributed observation', value => { value.completion.availabilitySessionTimeMs = 3000; value.unattributedObservations[0].finality.finalizationSessionTimeMs = 4000; }],
  ])('rejects causal corruption: %s without repair', (_name, corrupt) => {
    const value = assignment();
    if (_name.startsWith('completion before')) {
      for (const group of value.groups) {
        group.finality.finalizationSessionTimeMs = 2500;
        for (const strike of group.strikes) strike.finality.finalizationSessionTimeMs = 2500;
      }
      for (const row of value.unattributedObservations) row.finality.finalizationSessionTimeMs = 2500;
    }
    corrupt(value); const before = structuredClone(value);
    expect(() => assertCompletedAssignment(value)).toThrow(); expect(value).toEqual(before);
  });
  it.each(['group', 'strike', 'unattributed observation'] as const)('every retained %s validates its own enabling coverage and clamp', owner => {
    for (const condition of ['coverage', 'false-clamp', 'true-clamp'] as const) {
      const value = assignment();
      const finality = owner === 'group' ? value.groups[0].finality : owner === 'strike'
        ? value.groups[0].strikes[0].finality : value.unattributedObservations[0].finality;
      if (condition === 'coverage') finality.enablingAnalysisFrontierMs = finality.requiredAnalysisFrontierMs - 1;
      if (condition === 'false-clamp') finality.unclampedRequiredFrontierMs++;
      if (condition === 'true-clamp') finality.terminalClamp = true;
      expect(() => assertCompletedAssignment(value), `${owner}: ${condition}`).toThrow();
    }
  });
  it('accepts independently valid session availability smaller than the performance frontier, including generic stopped evaluation', () => {
    const f = new ContinuousAssignmentFinalizer('independent', [{ strikeId: 'c', groupId: 'g', pitch: 'C4', expectedPerformanceTimeMs: 1000, renderNoteIds: [] }]);
    f.publish({ publicationId: 'coverage', sessionDomainId: 'independent', analyzedThroughPerformanceMs: 5000, availabilitySessionTimeMs: 3000, observations: [] });
    f.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 5000, availabilitySessionTimeMs: 3000 });
    const result = f.completedAssignment(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.assignment.completion.reason).toBe('STOPPED_BY_USER');
    expect(() => assertCompletedAssignment(JSON.parse(JSON.stringify(result.assignment)))).not.toThrow();
  });
  it('accepts consistent terminal clamps generated by generic evaluation', () => {
    const f = new ContinuousAssignmentFinalizer('clamped', [{ strikeId: 'c', groupId: 'g', pitch: 'C4', expectedPerformanceTimeMs: 1000, renderNoteIds: [] }]);
    f.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 1000, availabilitySessionTimeMs: 3000 });
    f.publish({ publicationId: 'terminal', sessionDomainId: 'clamped', analyzedThroughPerformanceMs: 1000, availabilitySessionTimeMs: 3000, observations: [] });
    const result = f.completedAssignment(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.assignment.groups[0].finality.terminalClamp).toBe(true);
    expect(() => assertCompletedAssignment(result.assignment)).not.toThrow();
  });
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
