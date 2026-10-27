import { describe, expect, it } from 'vitest';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation, ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';

const strike = (strikeId: string, time = 1000, pitch = 'C4', groupId = strikeId): ContinuousExpectedStrike =>
  ({ strikeId, groupId, pitch, expectedPerformanceTimeMs: time, renderNoteIds: [] });
const observation = (observationId: string, time = 1000, pitch = 'C4'): ContinuousObservation =>
  ({ observationId, pitch, performanceTimeMs: time, confidence: 0.8, source: 'ACOUSTIC' });
const pub = (publicationId: string, frontier: number, observations: readonly ContinuousObservation[] = [], availability = frontier + 100): ContinuousEvidencePublication =>
  ({ publicationId, sessionDomainId: 'session', analyzedThroughPerformanceMs: frontier, availabilitySessionTimeMs: availability, observations });
const ledger = (strikes: readonly ContinuousExpectedStrike[] = [strike('a')]) => new ContinuousAssignmentFinalizer('session', strikes);
const group = (l: ContinuousAssignmentFinalizer, id = 'a') => l.snapshot().groups.find(g => g.groupId === id)!;
const finish = (l: ContinuousAssignmentFinalizer, time = 4000, reason: 'SCOPE_COMPLETED' | 'STOPPED_BY_USER' = 'SCOPE_COMPLETED') => {
  l.publish(pub('end-coverage', time));
  return l.complete({ reason, performanceTimeMs: time, availabilitySessionTimeMs: time + 100 });
};
const reservation = () => [strike('g'), strike('claim', 1400, 'D4'), strike('next', 1800, 'D4'), strike('other', 2200, 'D4')];

describe('bounded source-blind Continuous assignment', () => {
  it('reads the next useful frontier without publishing and reuses indirect residual dependencies', () => {
    const l = ledger([strike('g', 1000, 'C4'), strike('a', 1250, 'D4'), strike('b', 1750, 'D4')]);
    const before = l.snapshot();
    expect(l.nextRequiredAnalysisFrontier()).toBe(1250);
    expect(l.nextRequiredAnalysisFrontier()).toBe(1250);
    expect(l.snapshot()).toEqual(before);
    l.publish(pub('observation', 1000, [observation('d', 1000, 'D4')]));
    expect(l.nextRequiredAnalysisFrontier()).toBe(1250);
    l.publish(pub('first-need', 1250));
    expect(group(l, 'g').state).toBe('PENDING');
    expect(l.nextRequiredAnalysisFrontier()).toBe(2000);
    l.publish(pub('dependency', 2000));
    expect(l.snapshot().groups.every(group => group.state === 'FINALIZED')).toBe(true);
    expect(l.nextRequiredAnalysisFrontier()).toBeNull();
  });
  it('finality records session knowledge availability separately from required performance coverage', () => {
    const l = ledger(); l.publish(pub('delayed', 1250, [observation('o')], 4000));
    expect(group(l).strikes[0]).toMatchObject({ state: 'MATCHED', match: { timingOffsetMs: 0 },
      finality: { requiredAnalysisFrontierMs: 1250, finalizationSessionTimeMs: 4000 } });
  });
  it('completion has an independent nonnegative session coordinate and rejects availability regression', () => {
    const l = ledger(); l.publish(pub('coverage', 5000, [], 3000));
    expect(() => l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 5000, availabilitySessionTimeMs: 2999 })).toThrow('INVALID_PUBLICATION');
    expect(l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 5000, availabilitySessionTimeMs: 3000 }).completion)
      .toEqual({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 5000, availabilitySessionTimeMs: 3000 });
  });
  it('terminal coverage arriving after a completion request cannot regress session availability', () => {
    const l = ledger();
    l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 5000, availabilitySessionTimeMs: 3000 });
    expect(() => l.publish(pub('late-coverage', 5000, [], 2999))).toThrow('INVALID_PUBLICATION');
  });
  it.each([
    ['matched', [strike('a')], [observation('o')], ['MATCHED'], 0],
    ['unmatched', [strike('a')], [], ['UNMATCHED'], 0],
    ['residual', [strike('a')], [observation('o', 1000, 'D4')], ['UNMATCHED'], 1],
    ['partial match', [strike('a', 1000, 'C4', 'a'), strike('b', 1000, 'E4', 'a')], [observation('o')], ['MATCHED', 'UNMATCHED'], 0],
    ['full match', [strike('a', 1000, 'C4', 'a'), strike('b', 1000, 'E4', 'a')], [observation('o'), observation('p', 1000, 'E4')], ['MATCHED', 'MATCHED'], 0],
  ] as const)('%s has explicit assignment and residual facts', (_name, expected, observations, states, residualCount) => {
    const l = ledger(expected); l.publish(pub('p', 1250, observations));
    expect(group(l).state).toBe('FINALIZED');
    expect(group(l).strikes.map(strike => strike.state)).toEqual(states);
    expect(group(l).residualAssignments).toHaveLength(residualCount);
  });
  it('unattributed without legal claims', () => { const l = ledger([]); l.publish(pub('p', 1000, [observation('o', 900)])); expect(l.snapshot().unattributedObservations[0].observation.observationId).toBe('o'); });
  it('repeated same pitch has distinct owners', () => {
    const l = ledger([strike('a'), strike('b', 1200)]); l.publish(pub('p', 1450, [observation('x'), observation('y', 1200)]));
    expect(l.snapshot().observationAssignments.map(o => o.kind === 'STRIKE_MATCH' ? o.strikeId : null)).toEqual(['a', 'b']);
  });
  it('cohort participation does not prematurely commit a future anchor', () => {
    const l = ledger([strike('a'), strike('b', 1400), strike('c', 1800)]); l.publish(pub('p', 1650, [observation('x'), observation('y', 1400)]));
    expect(group(l).strikes.every(strike => strike.state === 'MATCHED')).toBe(true); expect(group(l, 'b').strikes[0].state).toBe('PENDING');
  });
  it('protects a reservation later consumed by its direct correct claimant', () => {
    const l = ledger(reservation()); l.publish(pub('p', 1700, [observation('r', 1200, 'D4')])); expect(group(l, 'g').state).toBe('PENDING');
    expect(l.snapshot().observationAssignments).toHaveLength(0); l.publish(pub('q', 2050));
    expect(group(l, 'g').strikes.every(strike => strike.state === 'UNMATCHED')).toBe(true); expect(l.snapshot().observationAssignments[0]).toEqual({ kind: 'STRIKE_MATCH', observationId: 'r', strikeId: 'claim' });
  });
  it('releases evidence to group residual when the direct claimant uses a better observation', () => {
    const l = ledger(reservation()); l.publish(pub('p', 1700, [observation('r', 1200, 'D4'), observation('b', 1410, 'D4')]));
    expect(group(l, 'g').state).toBe('PENDING'); l.publish(pub('q', 2050));
    expect(group(l, 'g').residualAssignments).toHaveLength(1); expect(group(l, 'g').residualAssignments[0].observation.observationId).toBe('r');
    expect(group(l, 'g').finality?.requiredAnalysisFrontierMs).toBe(2050);
    expect(group(l, 'next').strikes[0].state).toBe('PENDING');
  });
  it.each([10, 100, 150])('a %i-strike chain never extends the first group beyond its direct bound', count => {
    const l = ledger([strike('g'), ...Array.from({ length: count }, (_, i) => strike(`s${i.toString().padStart(3, '0')}`, 1400 + i * 200, 'D4'))]);
    l.publish(pub('p', 1700, [observation('r', 1200, 'D4'), observation('b', 1410, 'D4')])); l.publish(pub('q', 2050));
    expect(group(l, 'g').strikes.every(strike => strike.state === 'UNMATCHED')).toBe(true); expect(group(l, 'g').finality?.unclampedRequiredFrontierMs).toBe(2050);
  });
  it.each([750, 1250])('inclusive endpoint %i matches', time => { const l = ledger(); l.publish(pub('p', 1250, [observation('o', time)])); expect(group(l).strikes.every(strike => strike.state === 'MATCHED')).toBe(true); });
  it.each([[1500, 1750], [1500.001, 1250]])('direct boundary %f gives fixed frontier %f', (time, frontier) => {
    const l = ledger([strike('a'), strike('b', time)]); l.publish(pub('p', frontier)); expect(group(l).finality?.unclampedRequiredFrontierMs).toBe(frontier);
  });
  it('one group residual observation cannot also be unattributed or claimed by two groups', () => {
    const l = ledger([strike('a'), strike('b', 1100)]); l.publish(pub('p', 1900, [observation('o', 1050, 'D4')])); finish(l);
    expect(l.snapshot().observationAssignments).toHaveLength(1); expect(l.snapshot().unattributedObservations).toHaveLength(0);
    expect(l.snapshot().groups.filter(g => g.residualAssignments.length > 0)).toHaveLength(1);
  });
  it('MATCHED cannot also be group residual or unattributed', () => {
    const l = ledger([strike('a', 1000, 'D4'), strike('b')]); l.publish(pub('p', 1500, [observation('o', 1000, 'D4')])); finish(l);
    expect(l.snapshot().observationAssignments).toEqual([{ kind: 'STRIKE_MATCH', observationId: 'o', strikeId: 'a' }]);
  });
  it('finalized snapshots are immutable and not rewritten by later coverage', () => {
    const l = ledger(); l.publish(pub('p', 1250)); const saved = group(l); expect(Object.isFrozen(saved.strikes)).toBe(true);
    l.publish(pub('q', 1500)); expect(group(l)).toBe(saved);
  });
  it('duplicate publication is idempotent even under observation permutation', () => {
    const l = ledger(); const p = pub('p', 1250, [observation('o'), observation('x', 1000, 'E4')]);
    const before = l.publish(p); expect(l.publish({ ...p, observations: [...p.observations].reverse() })).toEqual(before);
  });
  it('mutated publication fails closed', () => { const l = ledger(); l.publish(pub('p', 1250)); expect(() => l.publish(pub('p', 1260))).toThrow('PUBLICATION_MUTATED'); });
  it('duplicate observation in another publication fails closed', () => {
    const l = ledger(); l.publish(pub('p', 1000, [observation('o')])); expect(() => l.publish(pub('q', 1250, [observation('o')]))).toThrow('DUPLICATE_OBSERVATION');
  });
  it('duplicate observation within a publication fails closed', () => { const l = ledger(); expect(() => l.publish(pub('p', 1250, [observation('o'), observation('o')]))).toThrow('DUPLICATE_OBSERVATION'); });
  it('late evidence fails closed', () => { const l = ledger(); l.publish(pub('p', 1250)); expect(() => l.publish(pub('q', 1500, [observation('o')]))).toThrow('LATE_EVIDENCE'); });
  it('evidence beyond frontier fails closed', () => { expect(() => ledger().publish(pub('p', 900, [observation('o')]))).toThrow('INVALID_PUBLICATION'); });
  it('wrong session fails closed', () => { expect(() => ledger().publish({ ...pub('p', 1250), sessionDomainId: 'other' })).toThrow('SESSION_DOMAIN_MISMATCH'); });
  it('terminal closes reservations and disallows new publications', () => {
    const l = ledger(reservation()); l.publish(pub('p', 1500, [observation('r', 1200, 'D4'), observation('b', 1410, 'D4')]));
    const completion = { reason: 'SCOPE_COMPLETED', performanceTimeMs: 1500, availabilitySessionTimeMs: 1600 } as const;
    l.complete(completion); expect(l.snapshot().reservedObservationIds).toEqual([]);
    expect(l.completedAssignment().status).toBe('COMPLETE'); expect(l.complete(completion)).toEqual(l.snapshot());
    expect(() => l.publish(pub('new', 1600))).toThrow('PUBLICATION_AFTER_COMPLETION');
  });
  it('manual stop preserves NOT_REACHED vs locally closed UNMATCHED', () => {
    const l = ledger([strike('closed', 500), strike('future', 1400)]); finish(l, 1000, 'STOPPED_BY_USER');
    expect(group(l, 'closed').strikes.every(strike => strike.state === 'UNMATCHED')).toBe(true); expect(group(l, 'future').strikes.some(strike => strike.state === 'NOT_REACHED')).toBe(true);
  });
  it('all expected strikes share canonical group time or construction fails', () => {
    expect(() => ledger([strike('a', 1000, 'C4', 'g'), strike('b', 1001, 'E4', 'g')])).toThrow('canonical onset');
  });
  it('completion cannot extend coverage beyond the stopped performance boundary', () => {
    const l = ledger(); l.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 1000, availabilitySessionTimeMs: 1000 });
    expect(() => l.publish(pub('beyond', 1001))).toThrow('PUBLICATION_AFTER_COMPLETION');
  });
  it('manual partial chord retains committed match metadata without calling the chord complete', () => {
    const l = ledger([strike('a', 1000, 'C4', 'chord'), strike('b', 1000, 'E4', 'chord')]);
    l.publish(pub('p', 1100, [observation('o')]));
    l.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 1100, availabilitySessionTimeMs: 1200 });
    expect(group(l, 'chord').strikes.some(strike => strike.state === 'NOT_REACHED')).toBe(true);
    expect(group(l, 'chord').strikes.map(strike => strike.state)).toEqual(['MATCHED', 'NOT_REACHED']);
  });
  it('exact finality timestamps use availability, never attack time', () => {
    const l = ledger(); l.publish(pub('p', 1250, [observation('o')], 1800));
    expect(group(l).finality).toMatchObject({ requiredAnalysisFrontierMs: 1250, finalizationSessionTimeMs: 1800, enablingPublicationId: 'p' });
  });
  it('stable ties and permutation-invariant completed truth', () => {
    const run = (reverse: boolean) => {
      const l = ledger([strike('a'), strike('b', 1100)]), observations = [observation('y', 1050), observation('x', 1050)];
      l.publish(pub('p', 1400, reverse ? observations.reverse() : observations)); finish(l); return l.completedAssignment();
    };
    expect(run(true)).toEqual(run(false));
    const result = run(false); if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.assignment.groups[0].strikes[0]).toMatchObject({ state: 'MATCHED', match: { observation: { observationId: 'x' } } });
  });
  it('deterministic generated sets preserve ownership, finite bounds, and permutation invariance', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const expected = Array.from({ length: 12 }, (_, i) => strike(`s${i}`, 500 + i * 170, ['C4', 'D4', 'E4'][(i + seed) % 3]));
      const observations = expected.filter((_, i) => (i + seed) % 4 !== 0).map((s, i) => observation(`o${i}`, s.expectedPerformanceTimeMs + ((i * 73 + seed) % 201) - 100, s.pitch));
      const run = (rows: readonly ContinuousObservation[]) => { const l = ledger(expected); l.publish(pub('p', 3000, rows)); finish(l); return l.snapshot(); };
      const result = run(observations); expect(run([...observations].reverse())).toEqual(result);
      expect(new Set(result.observationAssignments.map(o => o.observationId)).size).toBe(result.observationAssignments.length);
      for (const g of result.groups) expect(g.finality!.unclampedRequiredFrontierMs - g.performanceTimeMs).toBeLessThanOrEqual(1250);
      expect(result.reservedObservationIds).toEqual([]);
    }
  });
});


describe('deterministic residual slot relations', () => {
  it.each([
    { pitches: ['C4','E4'], matched: ['C4'], residual: ['E4'], unattributed: [], slots: ['D4'] },
    { pitches: ['C4'], matched: ['C4'], residual: [], unattributed: [], slots: [] },
    { pitches: ['E4'], matched: [], residual: ['E4'], unattributed: [], slots: ['C4'] },
    { pitches: ['E4','F4'], matched: [], residual: ['E4','F4'], unattributed: [], slots: ['C4','D4'] },
    { pitches: ['C4','D4','E4'], matched: ['C4','D4'], residual: [], unattributed: ['E4'], slots: [] },
    { pitches: ['C4','E4','F4'], matched: ['C4'], residual: ['E4'], unattributed: ['F4'], slots: ['D4'] },
    { pitches: [], matched: [], residual: [], unattributed: [], slots: [] },
  ])('$pitches preserves matching geometry, ownership and fixed finality', ({ pitches, matched, residual, unattributed, slots }) => {
    const run = (rows: readonly string[], targets: readonly string[]) => {
      const l = ledger(targets.map(pitch => strike(pitch, 1000, pitch, 'g')));
      l.publish(pub('p', 4000, rows.map(pitch => observation(pitch, 1000, pitch)), 4100));
      l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 4000, availabilitySessionTimeMs: 4100 });
      return l.snapshot();
    };
    const snapshot = run(pitches, ['C4','D4']), group = snapshot.groups[0];
    expect(run([...pitches].reverse(), ['D4','C4'])).toEqual(snapshot);
    expect(group.strikes.filter(s => s.state === 'MATCHED').map(s => s.strikeId)).toEqual(matched);
    expect(group.residualAssignments.map(row => row.observation.observationId)).toEqual(residual);
    expect(snapshot.unattributedObservations.map(row => row.observation.observationId)).toEqual(unattributed);
    expect(group.residualAssignments.map(row => row.strikeId)).toEqual(slots);
    expect(group.residualAssignments.every(row => row.timingOffsetMs === 0)).toBe(true);
    const finality = { requiredAnalysisFrontierMs: 1250, unclampedRequiredFrontierMs: 1250,
      enablingPublicationId: 'p', enablingAnalysisFrontierMs: 4000, finalizationSessionTimeMs: 4100, terminalClamp: false };
    expect(group.finality).toEqual(finality);
    expect(group.strikes.every(s => s.state !== 'PENDING' && JSON.stringify(s.finality) === JSON.stringify(finality))).toBe(true);
    expect(snapshot.unattributedObservations.every(row => JSON.stringify(row.finality) === JSON.stringify(finality))).toBe(true);
    expect(snapshot.observationAssignments.filter(row => row.kind === 'GROUP_RESIDUAL')).toEqual(residual.map((observationId, index) => ({
      kind: 'GROUP_RESIDUAL', groupId: 'g', strikeId: slots[index], observationId,
    })));
    expect(snapshot.reservedObservationIds).toEqual([]);
    expect(new Set(snapshot.observationAssignments.map(row => row.observationId)).size).toBe(pitches.length);
  });
  it('records signed timing once at the selected residual strike', () => {
    const l = ledger([strike('target')]);
    l.publish(pub('p', 2000, [observation('early', 877, 'E4')]));
    expect(group(l, 'target').residualAssignments[0]).toMatchObject({ strikeId: 'target', observation: { observationId: 'early' }, timingOffsetMs: -123 });
  });
});


it('resource overflow discards the whole assignment transaction, including earlier would-be claims and terminal metadata', () => {
  // The early D4 strike would claim first; the later dense C4 cohort exceeds the fixed finite-edge budget.
  const expected = [strike('early', 100, 'D4'), ...Array.from({ length: 513 }, (_, i) => strike(`dense${i}`, 1000, 'C4'))];
  const l = ledger(expected); l.publish(pub('initial', 0));
  const before = l.snapshot(), resources = l.resourceSnapshot();
  const observations = [observation('early-o', 100, 'D4'), ...Array.from({ length: 512 }, (_, i) => observation(`dense-o${i}`, 1000, 'C4'))];
  let failure: unknown;
  try { l.publish(pub('overflow', 1250, observations)); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: 'CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED' });
  expect(l.snapshot()).toEqual(before); expect(l.resourceSnapshot()).toEqual(resources);
  expect(l.completedAssignment()).toMatchObject({ status: 'UNAVAILABLE', reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' });
  expect(() => l.publish(pub('later', 2000))).toThrow(failure as Error);
  expect(() => l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 2000, availabilitySessionTimeMs: 2100 })).toThrow(failure as Error);
  expect(l.snapshot()).toEqual(before); expect(l.resourceSnapshot()).toEqual(resources);
});
it('publication capacity failure preserves already-retained ownership, availability and completion state', () => {
  const l = ledger(); l.publish(pub('initial', 1250, [observation('owned')]));
  const before = l.snapshot(), resources = l.resourceSnapshot();
  expect(() => l.publish(pub('overflow', 3000, Array.from({ length: 16385 }, (_, i) => observation(`new${i}`, 2000)))))
    .toThrow('CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED');
  expect(l.snapshot()).toEqual(before); expect(l.resourceSnapshot()).toEqual(resources);
});

it('indexes narrow candidates but the policy predicate still owns floating-point window eligibility', () => {
  const t = 2 ** 60; // ULP 256: t + 250 rounds to t + 256, which is outside the actual +/-250 predicate.
  const l = ledger([strike('a', t)]);
  l.publish(pub('p', t + 2048, [observation('outside', t + 256, 'D4')]));
  expect(group(l).residualAssignments).toEqual([]);
  expect(l.snapshot().unattributedObservations.map(o => o.observation.observationId)).toEqual(['outside']);
});
