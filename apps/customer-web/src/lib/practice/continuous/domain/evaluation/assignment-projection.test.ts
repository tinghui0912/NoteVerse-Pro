import { describe, expect, it } from 'vitest';
import { ContinuousAssignmentFinalizer } from './assignment-finalizer';
import { assertCompletedAssignment } from './assignment-projection';
import type { CompletedContinuousAssignment } from './assignment-types';
import type { ContinuousObservation } from './evidence-types';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
function assignment(reason: CompletedContinuousAssignment['completion']['reason'] = 'SCOPE_COMPLETED',
  evidence: Pick<ContinuousObservation, 'source' | 'provenance'> = { source: 'MIDI' }): Mutable<CompletedContinuousAssignment> {
  const f = new ContinuousAssignmentFinalizer('validation', [
    ...['C4','D4'].map(pitch => ({ strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch] })),
    { strikeId: 'G4', groupId: 'h', pitch: 'G4', expectedPerformanceTimeMs: 1800, renderNoteIds: ['G4'] },
  ]);
  f.publish({ publicationId: 'p', sessionDomainId: 'validation', analyzedThroughPerformanceMs: 4000, availabilitySessionTimeMs: 4100,
    observations: ['C4','E4','F4','A4'].map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: pitch === 'A4' ? 1800 : 1000, confidence: 1, ...evidence })) });
  f.complete({ reason, performanceTimeMs: 4000, availabilitySessionTimeMs: 4100 });
  const result = f.completedAssignment();
  if (result.status !== 'COMPLETE') throw new Error('incomplete');
  return structuredClone(result.assignment) as Mutable<CompletedContinuousAssignment>;
}

function notReachedAssignment(): Mutable<CompletedContinuousAssignment> {
  const f = new ContinuousAssignmentFinalizer('not-reached', [{ strikeId: 'future', groupId: 'future', pitch: 'C4', expectedPerformanceTimeMs: 1000, renderNoteIds: [] }]);
  f.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 100, availabilitySessionTimeMs: 100 });
  f.publish({ publicationId: 'tail', sessionDomainId: 'not-reached', analyzedThroughPerformanceMs: 100, availabilitySessionTimeMs: 200, observations: [] });
  const result = f.completedAssignment(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
  return structuredClone(result.assignment) as Mutable<CompletedContinuousAssignment>;
}

function matchedStrike(value: Mutable<CompletedContinuousAssignment>) {
  const strike = value.groups[0].strikes[0];
  if (strike.state !== 'MATCHED') throw new Error('matched fixture required');
  return strike;
}

/** Update all retained copies of one evidence fact so semantic tests preserve ledger equality. */
function changeObservation(value: Mutable<CompletedContinuousAssignment>, id: string, patch: Partial<ContinuousObservation>): void {
  const copies = [...value.observations, ...value.groups.flatMap(group => [
    ...group.strikes.flatMap(strike => strike.state === 'MATCHED' ? [strike.match.observation] : []),
    ...group.residualAssignments.map(row => row.observation),
  ]), ...value.unattributedObservations.map(row => row.observation)];
  for (const observation of copies.filter(row => row.observationId === id)) Object.assign(observation, patch);
}

const provenance = { sourceDomainId: 'capture', sourceSampleRateHz: 48000, sourceEventSample: 0 };
const parsedAssignment = () => JSON.parse(JSON.stringify(assignment('SCOPE_COMPLETED', { source: 'MIDI', provenance }))) as Mutable<CompletedContinuousAssignment>;

describe('completed retained assignment current shapes and local semantics', () => {
  const baseStrikeFields = ['strikeId', 'groupId', 'pitch', 'expectedPerformanceTimeMs', 'renderNoteIds', 'state', 'finality'];
  const observationFields = ['observationId', 'pitch', 'performanceTimeMs', 'confidence', 'source'];
  const finalityFields = ['requiredAnalysisFrontierMs', 'unclampedRequiredFrontierMs', 'enablingPublicationId', 'enablingAnalysisFrontierMs', 'finalizationSessionTimeMs', 'terminalClamp'];
  const nodes: { label: string; fields: string[]; get: (value: Mutable<CompletedContinuousAssignment>) => object;
    create?: () => Mutable<CompletedContinuousAssignment> }[] = [
    { label: 'assignment', fields: ['sessionDomainId', 'observations', 'groups', 'unattributedObservations', 'observationAssignments', 'completion'], get: v => v },
    { label: 'completion', fields: ['reason', 'performanceTimeMs', 'availabilitySessionTimeMs'], get: v => v.completion },
    { label: 'group', fields: ['groupId', 'performanceTimeMs', 'state', 'strikes', 'residualAssignments', 'finality'], get: v => v.groups[0] },
    { label: 'MATCHED strike', fields: [...baseStrikeFields, 'match'], get: v => matchedStrike(v) },
    { label: 'UNMATCHED strike', fields: baseStrikeFields, get: v => v.groups[0].strikes[1] },
    { label: 'NOT_REACHED strike', fields: baseStrikeFields, get: v => v.groups[0].strikes[0], create: notReachedAssignment },
    { label: 'match', fields: ['observation', 'timingOffsetMs'], get: v => matchedStrike(v).match },
    { label: 'residual', fields: ['strikeId', 'observation', 'timingOffsetMs'], get: v => v.groups[0].residualAssignments[0] },
    { label: 'unattributed', fields: ['observation', 'finality'], get: v => v.unattributedObservations[0] },
    { label: 'ledger observation', fields: observationFields, get: v => v.observations[0] },
    { label: 'matched observation', fields: observationFields, get: v => matchedStrike(v).match.observation },
    { label: 'residual observation', fields: observationFields, get: v => v.groups[0].residualAssignments[0].observation },
    { label: 'unattributed observation', fields: observationFields, get: v => v.unattributedObservations[0].observation },
    { label: 'ledger provenance', fields: ['sourceDomainId', 'sourceSampleRateHz', 'sourceEventSample'], get: v => v.observations[0].provenance! },
    { label: 'matched provenance', fields: ['sourceDomainId', 'sourceSampleRateHz', 'sourceEventSample'], get: v => matchedStrike(v).match.observation.provenance! },
    { label: 'residual provenance', fields: ['sourceDomainId', 'sourceSampleRateHz', 'sourceEventSample'], get: v => v.groups[0].residualAssignments[0].observation.provenance! },
    { label: 'unattributed provenance', fields: ['sourceDomainId', 'sourceSampleRateHz', 'sourceEventSample'], get: v => v.unattributedObservations[0].observation.provenance! },
    { label: 'STRIKE_MATCH relation', fields: ['kind', 'observationId', 'strikeId'], get: v => v.observationAssignments.find(row => row.kind === 'STRIKE_MATCH')! },
    { label: 'GROUP_RESIDUAL relation', fields: ['kind', 'observationId', 'groupId', 'strikeId'], get: v => v.observationAssignments.find(row => row.kind === 'GROUP_RESIDUAL')! },
    { label: 'UNATTRIBUTED relation', fields: ['kind', 'observationId'], get: v => v.observationAssignments.find(row => row.kind === 'UNATTRIBUTED')! },
    { label: 'strike finality', fields: finalityFields, get: v => v.groups[0].strikes[0].finality },
    { label: 'group finality', fields: finalityFields, get: v => v.groups[0].finality },
    { label: 'unattributed finality', fields: finalityFields, get: v => v.unattributedObservations[0].finality },
  ];
  for (const node of nodes) {
    it.each(['unknown field', ...node.fields.map(field => `missing ${field}`)])(`${node.label} rejects %s without repair`, condition => {
      const value = (node.create ?? parsedAssignment)();
      expect(() => assertCompletedAssignment(value)).not.toThrow();
      const row = node.get(value);
      if (condition === 'unknown field') Object.assign(row, { unexpected: true });
      else Reflect.deleteProperty(row, condition.slice('missing '.length));
      const before = structuredClone(value), serializedBefore = JSON.stringify(value);
      expect(() => assertCompletedAssignment(value)).toThrow();
      expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serializedBefore);
    });
  }
  it.each<[string, (v: Mutable<CompletedContinuousAssignment>) => void]>([
    ['matched wrong pitch with canonical ledger equality', v => changeObservation(v, 'C4', { pitch: 'B4' })],
    ['matched inconsistent timing offset', v => { matchedStrike(v).match.timingOffsetMs = 1; }],
    ['matched outside window with consistent offset and ledger', v => {
      changeObservation(v, 'C4', { performanceTimeMs: 1251 }); matchedStrike(v).match.timingOffsetMs = 251;
    }],
    ['matched before window with consistent offset and ledger', v => {
      changeObservation(v, 'C4', { performanceTimeMs: 749 }); matchedStrike(v).match.timingOffsetMs = -251;
    }],
    ['matched non-finite timing offset', v => { matchedStrike(v).match.timingOffsetMs = NaN; }],
    ['null match', v => { Object.assign(matchedStrike(v), { match: null }); }],
    ['null matched observation', v => { Object.assign(matchedStrike(v).match, { observation: null }); }],
    ['residual expected group pitch with canonical ledger equality', v => changeObservation(v, 'E4', { pitch: 'D4' })],
    ['residual matched-member pitch', v => changeObservation(v, 'E4', { pitch: 'C4' })],
    ['residual outside group window with exact offset', v => {
      changeObservation(v, 'E4', { performanceTimeMs: 1251 }); v.groups[0].residualAssignments[0].timingOffsetMs = 251;
    }],
    ['residual before group window with exact offset', v => {
      changeObservation(v, 'E4', { performanceTimeMs: 749 }); v.groups[0].residualAssignments[0].timingOffsetMs = -251;
    }],
    ['group time disagrees with children', v => { v.groups[0].performanceTimeMs++; }],
    ['one child disagrees with group canonical onset', v => { v.groups[0].strikes[1].expectedPerformanceTimeMs++; }],
    ['empty group', v => { v.groups[0].strikes = []; }],
    ['pending group', v => { Object.assign(v.groups[0], { state: 'PENDING' }); }],
    ['pending strike', v => { Object.assign(v.groups[0].strikes[1], { state: 'PENDING' }); }],
    ['unknown strike state', v => { Object.assign(v.groups[0].strikes[1], { state: 'OTHER' }); }],
    ['unknown relation kind', v => { Object.assign(v.observationAssignments[0], { kind: 'OTHER' }); }],
    ['nested observation disagrees with ledger', v => { matchedStrike(v).match.observation.confidence = .5; }],
    ['nested provenance disagrees with ledger', v => { matchedStrike(v).match.observation.provenance!.sourceEventSample++; }],
    ['UNMATCHED with forbidden match', v => { Object.assign(v.groups[0].strikes[1], { match: matchedStrike(v).match }); }],
    ['array-like ledger', v => { Object.assign(v, { observations: { length: 0 } }); }],
    ['array-like groups', v => { Object.assign(v, { groups: { length: 0 } }); }],
    ['array-like residuals', v => { Object.assign(v.groups[0], { residualAssignments: { length: 0 } }); }],
    ['array-like strikes', v => { Object.assign(v.groups[0], { strikes: { length: 0 } }); }],
    ['array-like unattributed', v => { Object.assign(v, { unattributedObservations: { length: 0 } }); }],
    ['array-like flat relations', v => { Object.assign(v, { observationAssignments: { length: 0 } }); }],
    ['array-like render IDs', v => { Object.assign(v.groups[0].strikes[0], { renderNoteIds: { length: 0 } }); }],
    ['empty render ID', v => { v.groups[0].strikes[0].renderNoteIds = ['']; }],
    ['non-string render ID', v => { Object.assign(v.groups[0].strikes[0], { renderNoteIds: [1] }); }],
    ['null ledger row', v => { Object.assign(v.observations, { 0: null }); }],
    ['null group', v => { Object.assign(v.groups, { 0: null }); }],
    ['null strike', v => { Object.assign(v.groups[0].strikes, { 0: null }); }],
    ['null residual', v => { Object.assign(v.groups[0].residualAssignments, { 0: null }); }],
    ['null unattributed', v => { Object.assign(v.unattributedObservations, { 0: null }); }],
    ['null flat relation', v => { Object.assign(v.observationAssignments, { 0: null }); }],
  ])('rejects local corruption: %s without mutation', (_name, corrupt) => {
    const value = parsedAssignment(); corrupt(value);
    const before = structuredClone(value), serializedBefore = JSON.stringify(value);
    expect(() => assertCompletedAssignment(value)).toThrow();
    expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serializedBefore);
  });
  const identities = [
    ['sessionDomainId', (v: Mutable<CompletedContinuousAssignment>) => v],
    ['groupId', (v: Mutable<CompletedContinuousAssignment>) => v.groups[0]],
    ['strikeId', (v: Mutable<CompletedContinuousAssignment>) => matchedStrike(v)],
    ['groupId', (v: Mutable<CompletedContinuousAssignment>) => matchedStrike(v)],
    ['pitch', (v: Mutable<CompletedContinuousAssignment>) => matchedStrike(v)],
    ['observationId', (v: Mutable<CompletedContinuousAssignment>) => v.observations[0]],
    ['pitch', (v: Mutable<CompletedContinuousAssignment>) => v.observations[0]],
    ['sourceDomainId', (v: Mutable<CompletedContinuousAssignment>) => v.observations[0].provenance!],
    ...['STRIKE_MATCH', 'GROUP_RESIDUAL', 'UNATTRIBUTED'].flatMap(kind => (kind === 'UNATTRIBUTED' ? ['observationId']
      : kind === 'STRIKE_MATCH' ? ['observationId', 'strikeId'] : ['observationId', 'strikeId', 'groupId'])
      .map(field => [field, (v: Mutable<CompletedContinuousAssignment>) => v.observationAssignments.find(row => row.kind === kind)!] as const)),
  ] as const;
  for (const [field, get] of identities) {
    it.each(['', 7, null])(`requires non-empty string ${field}: %s`, invalid => {
      const value = parsedAssignment(); Object.assign(get(value), { [field]: invalid });
      const before = structuredClone(value), serializedBefore = JSON.stringify(value);
      expect(() => assertCompletedAssignment(value)).toThrow();
      expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serializedBefore);
    });
  }
  it.each<[string, string, unknown]>([
    ['observation', 'performanceTimeMs', -1], ['observation', 'performanceTimeMs', NaN], ['observation', 'performanceTimeMs', Infinity],
    ['observation', 'performanceTimeMs', 4001], ['observation', 'performanceTimeMs', '1000'],
    ['observation', 'confidence', -0.1], ['observation', 'confidence', 1.1], ['observation', 'confidence', NaN],
    ['observation', 'confidence', Infinity], ['observation', 'confidence', '1'], ['observation', 'source', 'MICROPHONE'],
    ['observation', 'provenance', null], ['observation', 'provenance', undefined], ['observation', 'provenance', []],
    ['provenance', 'sourceSampleRateHz', 0], ['provenance', 'sourceSampleRateHz', -1], ['provenance', 'sourceSampleRateHz', Infinity],
    ['provenance', 'sourceSampleRateHz', '48000'], ['provenance', 'sourceEventSample', -1], ['provenance', 'sourceEventSample', NaN],
    ['provenance', 'sourceEventSample', Infinity], ['provenance', 'sourceEventSample', '0'],
    ['group', 'performanceTimeMs', -1], ['group', 'performanceTimeMs', NaN], ['group', 'performanceTimeMs', Infinity],
    ['strike', 'expectedPerformanceTimeMs', -1], ['strike', 'expectedPerformanceTimeMs', NaN], ['strike', 'expectedPerformanceTimeMs', Infinity],
  ])('rejects invalid %s %s=%s', (owner, field, invalid) => {
    const value = parsedAssignment();
    const row = owner === 'observation' ? value.observations[0] : owner === 'provenance' ? value.observations[0].provenance!
      : owner === 'group' ? value.groups[0] : matchedStrike(value);
    Object.assign(row, { [field]: invalid });
    const before = structuredClone(value), serializedBefore = JSON.stringify(value);
    expect(() => assertCompletedAssignment(value)).toThrow();
    expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serializedBefore);
  });
  it.each(['SCOPE_COMPLETED', 'STOPPED_BY_USER'] as const)('%s live-generated JSON roundtrip retains all local assignment kinds', reason => {
    for (const source of ['MIDI', 'ACOUSTIC'] as const) {
      for (const withProvenance of [false, true]) {
        const value = JSON.parse(JSON.stringify(assignment(reason, { source, ...(withProvenance ? { provenance } : {}) }))) as CompletedContinuousAssignment;
        expect(new Set(value.observationAssignments.map(row => row.kind))).toEqual(new Set(['STRIKE_MATCH', 'GROUP_RESIDUAL', 'UNATTRIBUTED']));
        expect(new Set(value.groups.flatMap(group => group.strikes.map(strike => strike.state)))).toEqual(new Set(['MATCHED', 'UNMATCHED']));
        expect(() => assertCompletedAssignment(value)).not.toThrow();
      }
    }
  });
  it('preserves NOT_REACHED targets/groups beyond the stopped terminal and rejects a match field', () => {
    const value = JSON.parse(JSON.stringify(notReachedAssignment())) as Mutable<CompletedContinuousAssignment>;
    expect(value.groups[0].performanceTimeMs).toBeGreaterThan(value.completion.performanceTimeMs);
    expect(value.groups[0].strikes[0].state).toBe('NOT_REACHED');
    expect(value.groups[0].finality.terminalClamp).toBe(true);
    expect(() => assertCompletedAssignment(value)).not.toThrow();
    Object.assign(value.groups[0].strikes[0], { match: {} });
    const before = structuredClone(value), serializedBefore = JSON.stringify(value);
    expect(() => assertCompletedAssignment(value)).toThrow();
    expect(value).toEqual(before); expect(JSON.stringify(value)).toBe(serializedBefore);
  });
  it.each([-250, 250])('accepts live-generated inclusive matched/residual boundary %i', offset => {
    const f = new ContinuousAssignmentFinalizer('boundary', ['C4', 'D4'].map(pitch => ({ strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [] })));
    f.publish({ publicationId: 'p', sessionDomainId: 'boundary', analyzedThroughPerformanceMs: 3000, availabilitySessionTimeMs: 3000,
      observations: ['C4', 'E4'].map((pitch, index) => ({ observationId: pitch, pitch, performanceTimeMs: 1000 + offset, confidence: index, source: 'MIDI' })) });
    f.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 3000, availabilitySessionTimeMs: 3000 });
    const result = f.completedAssignment(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.assignment.observationAssignments.map(row => row.kind)).toEqual(['STRIKE_MATCH', 'GROUP_RESIDUAL']);
    expect(() => assertCompletedAssignment(JSON.parse(JSON.stringify(result.assignment)))).not.toThrow();
  });
  it('does not add pitch syntax, render multiplicity, completion-reason or optimizer policy', () => {
    const value = parsedAssignment();
    changeObservation(value, 'C4', { pitch: 'opaque pitch identity' }); matchedStrike(value).pitch = 'opaque pitch identity';
    matchedStrike(value).renderNoteIds = ['duplicate', 'duplicate'];
    expect(() => assertCompletedAssignment(value)).not.toThrow();
    const future = notReachedAssignment(); future.completion.reason = 'SCOPE_COMPLETED';
    expect(() => assertCompletedAssignment(future)).not.toThrow();
    // Local validation does not try to reassign an otherwise consistent unattributed observation.
    const unclaimed = value.unattributedObservations[0];
    changeObservation(value, unclaimed.observation.observationId, { pitch: 'D4' });
    expect(() => assertCompletedAssignment(value)).not.toThrow();
  });
});
describe('completed assignment relation integrity', () => {
  describe.each(['SCOPE_COMPLETED', 'STOPPED_BY_USER'] as const)('%s terminal clamp equivalence', reason => {
    for (const owner of ['strike', 'group', 'unattributed observation'] as const) {
      it.each([
        { label: 'unclamped below terminal', unclamped: 800, required: 800, terminalClamp: false, valid: true },
        { label: 'unclamped at terminal', unclamped: 1000, required: 1000, terminalClamp: false, valid: true },
        { label: 'clamped to terminal', unclamped: 1100, required: 1000, terminalClamp: true, valid: true },
        { label: 'false clamp above terminal', unclamped: 1100, required: 1100, terminalClamp: false, valid: false },
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
          unclampedRequiredFrontierMs: 1250, enablingAnalysisFrontierMs: 1000, finalizationSessionTimeMs: 3000 });
        finality.requiredAnalysisFrontierMs = required;
        finality.unclampedRequiredFrontierMs = unclamped;
        finality.terminalClamp = terminalClamp;
        // Keep live-generated coverage at the terminal; valid bounds must fit within it.
        if (valid) {
          const finalities = [...value.groups.flatMap(group => [group.finality, ...group.strikes.map(strike => strike.finality)]),
            ...value.unattributedObservations.map(row => row.finality)];
          for (const row of finalities) {
            expect(row.requiredAnalysisFrontierMs).toBeLessThanOrEqual(row.enablingAnalysisFrontierMs);
            expect(row.enablingAnalysisFrontierMs).toBeLessThanOrEqual(value.completion.performanceTimeMs);
          }
        }
        const before = structuredClone(value);
        const serializedBefore = JSON.stringify(value);
        if (valid) expect(() => assertCompletedAssignment(value)).not.toThrow();
        else expect(() => assertCompletedAssignment(value)).toThrow('finality coordinates are corrupt');
        expect(value).toEqual(before);
        expect(JSON.stringify(value)).toBe(serializedBefore);
      });
      it(`${owner} rejects enabling coverage beyond the completed performance terminal without repair`, () => {
        const value = assignment(reason);
        expect(() => assertCompletedAssignment(value)).not.toThrow();
        const finality = owner === 'strike' ? value.groups[0].strikes[0].finality : owner === 'group'
          ? value.groups[0].finality : value.unattributedObservations[0].finality;
        finality.enablingAnalysisFrontierMs = value.completion.performanceTimeMs + 250;
        const before = structuredClone(value);
        const serializedBefore = JSON.stringify(value);
        expect(() => assertCompletedAssignment(value)).toThrow('Continuous assignment finality coordinates are corrupt.');
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
    ['group frontier before strike', value => { value.groups[0].finality.enablingAnalysisFrontierMs = value.groups[0].strikes[0].finality.enablingAnalysisFrontierMs - 1; }],
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
  it.each(['SCOPE_COMPLETED', 'STOPPED_BY_USER'] as const)('%s accepts live-generated terminal clamps with enabling coverage at the terminal', reason => {
    const f = new ContinuousAssignmentFinalizer('clamped', [{ strikeId: 'c', groupId: 'g', pitch: 'C4', expectedPerformanceTimeMs: 1000, renderNoteIds: [] }]);
    f.complete({ reason, performanceTimeMs: 1000, availabilitySessionTimeMs: 3000 });
    f.publish({ publicationId: 'terminal', sessionDomainId: 'clamped', analyzedThroughPerformanceMs: 1000, availabilitySessionTimeMs: 3000, observations: [] });
    const result = f.completedAssignment(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
    for (const finality of [result.assignment.groups[0].finality, result.assignment.groups[0].strikes[0].finality]) {
      expect(finality).toMatchObject({ requiredAnalysisFrontierMs: 1000, enablingAnalysisFrontierMs: 1000, terminalClamp: true });
      expect(finality.unclampedRequiredFrontierMs).toBeGreaterThan(result.assignment.completion.performanceTimeMs);
    }
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
