import { describe, expect, it } from 'vitest';
import { ContinuousFinalizer } from './continuous-finalizer';
import type { ContinuousExpectedStrike, ContinuousObservation, ContinuousEvidencePublication } from './continuous-evaluation-types';

const strike = (strikeId: string, time = 1000, pitch = 'C4', groupId = strikeId): ContinuousExpectedStrike =>
  ({ strikeId, groupId, pitch, expectedPerformanceTimeMs: time, renderNoteIds: [] });
const observation = (observationId: string, time = 1000, pitch = 'C4'): ContinuousObservation =>
  ({ observationId, pitch, performanceTimeMs: time, confidence: 0.8, source: 'ACOUSTIC' });
const pub = (publicationId: string, frontier: number, observations: readonly ContinuousObservation[] = [], availability = frontier + 100): ContinuousEvidencePublication =>
  ({ publicationId, sessionDomainId: 'session', analyzedThroughPerformanceMs: frontier, availabilityTimeMs: availability, observations });
const ledger = (strikes: readonly ContinuousExpectedStrike[] = [strike('a')]) => new ContinuousFinalizer('session', strikes);
const group = (l: ContinuousFinalizer, id = 'a') => l.snapshot().groups.find(g => g.groupId === id)!;
const finish = (l: ContinuousFinalizer, time = 4000, reason: 'SCOPE_COMPLETED' | 'STOPPED_BY_USER' = 'SCOPE_COMPLETED') => {
  l.publish(pub('end-coverage', time));
  return l.complete({ reason, performanceTimeMs: time, availabilityTimeMs: time + 100 });
};
const reservation = () => [strike('g'), strike('claim', 1400, 'D4'), strike('next', 1800, 'D4'), strike('other', 2200, 'D4')];

describe('bounded Continuous product truth', () => {
  it.each([
    ['CORRECT', [strike('a')], [observation('o')]],
    ['MISSING', [strike('a')], []],
    ['WRONG', [strike('a')], [observation('o', 1000, 'D4')]],
    ['INCOMPLETE_CHORD', [strike('a', 1000, 'C4', 'a'), strike('b', 1000, 'E4', 'a')], [observation('o')]],
    ['CORRECT', [strike('a', 1000, 'C4', 'a'), strike('b', 1000, 'E4', 'a')], [observation('o'), observation('p', 1000, 'E4')]],
  ] as const)('%s has explicit group and strike truth', (verdict, expected, observations) => {
    const l = ledger(expected); l.publish(pub('p', 1250, observations)); expect(group(l).verdict).toBe(verdict);
  });
  it('EXTRA without legal claims', () => { const l = ledger([]); l.publish(pub('p', 1000, [observation('o', 900)])); expect(l.snapshot().extras[0].observation.observationId).toBe('o'); });
  it('repeated same pitch has distinct owners', () => {
    const l = ledger([strike('a'), strike('b', 1200)]); l.publish(pub('p', 1450, [observation('x'), observation('y', 1200)]));
    expect(l.snapshot().observationOwnership.map(o => o.ownerId)).toEqual(['a', 'b']);
  });
  it('cohort participation does not prematurely commit a future anchor', () => {
    const l = ledger([strike('a'), strike('b', 1400), strike('c', 1800)]); l.publish(pub('p', 1650, [observation('x'), observation('y', 1400)]));
    expect(group(l).verdict).toBe('CORRECT'); expect(group(l, 'b').strikes[0].state).toBe('PENDING');
  });
  it('protects a reservation later consumed by its direct correct claimant', () => {
    const l = ledger(reservation()); l.publish(pub('p', 1700, [observation('r', 1200, 'D4')])); expect(group(l, 'g').verdict).toBe('PENDING');
    expect(l.snapshot().observationOwnership).toHaveLength(0); l.publish(pub('q', 2050));
    expect(group(l, 'g').verdict).toBe('MISSING'); expect(l.snapshot().observationOwnership[0].ownerId).toBe('claim');
  });
  it('releases evidence to WRONG when the direct claimant uses a better observation', () => {
    const l = ledger(reservation()); l.publish(pub('p', 1700, [observation('r', 1200, 'D4'), observation('b', 1410, 'D4')]));
    expect(group(l, 'g').verdict).toBe('PENDING'); l.publish(pub('q', 2050));
    expect(group(l, 'g').verdict).toBe('WRONG'); expect(group(l, 'g').wrongObservations[0].observationId).toBe('r');
    expect(group(l, 'g').finality?.requiredAnalysisFrontierMs).toBe(2050);
    expect(group(l, 'next').strikes[0].state).toBe('PENDING');
  });
  it.each([10, 100, 150])('a %i-strike chain never extends the first group beyond its direct bound', count => {
    const l = ledger([strike('g'), ...Array.from({ length: count }, (_, i) => strike(`s${i.toString().padStart(3, '0')}`, 1400 + i * 200, 'D4'))]);
    l.publish(pub('p', 1700, [observation('r', 1200, 'D4'), observation('b', 1410, 'D4')])); l.publish(pub('q', 2050));
    expect(group(l, 'g').verdict).toBe('MISSING'); expect(group(l, 'g').finality?.unclampedRequiredFrontierMs).toBe(2050);
  });
  it.each([750, 1250])('inclusive endpoint %i matches', time => { const l = ledger(); l.publish(pub('p', 1250, [observation('o', time)])); expect(group(l).verdict).toBe('CORRECT'); });
  it.each([[1500, 1750], [1500.001, 1250]])('direct boundary %f gives fixed frontier %f', (time, frontier) => {
    const l = ledger([strike('a'), strike('b', time)]); l.publish(pub('p', frontier)); expect(group(l).finality?.unclampedRequiredFrontierMs).toBe(frontier);
  });
  it('one WRONG observation cannot also be EXTRA or claimed by two groups', () => {
    const l = ledger([strike('a'), strike('b', 1100)]); l.publish(pub('p', 1900, [observation('o', 1050, 'D4')])); finish(l);
    expect(l.snapshot().observationOwnership).toHaveLength(1); expect(l.snapshot().extras).toHaveLength(0);
    expect(l.snapshot().groups.filter(g => g.verdict === 'WRONG')).toHaveLength(1);
  });
  it('MATCHED cannot also be WRONG or EXTRA', () => {
    const l = ledger([strike('a', 1000, 'D4'), strike('b')]); l.publish(pub('p', 1500, [observation('o', 1000, 'D4')])); finish(l);
    expect(l.snapshot().observationOwnership).toEqual([{ observationId: 'o', disposition: 'MATCHED', ownerId: 'a' }]);
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
    const completion = { reason: 'SCOPE_COMPLETED', performanceTimeMs: 1500, availabilityTimeMs: 1600 } as const;
    l.complete(completion); expect(l.snapshot().reservedObservationIds).toEqual([]);
    expect(l.completedEvaluation().status).toBe('COMPLETE'); expect(l.complete(completion)).toEqual(l.snapshot());
    expect(() => l.publish(pub('new', 1600))).toThrow('PUBLICATION_AFTER_COMPLETION');
  });
  it('manual stop preserves NOT_REACHED vs locally closed MISSING', () => {
    const l = ledger([strike('closed', 500), strike('future', 1400)]); finish(l, 1000, 'STOPPED_BY_USER');
    expect(group(l, 'closed').verdict).toBe('MISSING'); expect(group(l, 'future').verdict).toBe('NOT_REACHED');
  });
  it('all expected strikes share canonical group time or construction fails', () => {
    expect(() => ledger([strike('a', 1000, 'C4', 'g'), strike('b', 1001, 'E4', 'g')])).toThrow('canonical onset');
  });
  it('completion cannot extend coverage beyond the stopped performance boundary', () => {
    const l = ledger(); l.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 1000, availabilityTimeMs: 1000 });
    expect(() => l.publish(pub('beyond', 1001))).toThrow('PUBLICATION_AFTER_COMPLETION');
  });
  it('manual partial chord retains committed match metadata without calling the chord complete', () => {
    const l = ledger([strike('a', 1000, 'C4', 'chord'), strike('b', 1000, 'E4', 'chord')]);
    l.publish(pub('p', 1100, [observation('o')]));
    l.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 1100, availabilityTimeMs: 1200 });
    expect(group(l, 'chord').verdict).toBe('NOT_REACHED');
    expect(group(l, 'chord').strikes.map(strike => strike.state)).toEqual(['MATCHED', 'NOT_REACHED']);
  });
  it('exact finality timestamps use availability, never attack time', () => {
    const l = ledger(); l.publish(pub('p', 1250, [observation('o')], 1800));
    expect(group(l).finality).toMatchObject({ requiredAnalysisFrontierMs: 1250, finalizationTimeMs: 1800, enablingPublicationId: 'p' });
  });
  it('stable ties and permutation-invariant completed truth', () => {
    const run = (reverse: boolean) => {
      const l = ledger([strike('a'), strike('b', 1100)]), observations = [observation('y', 1050), observation('x', 1050)];
      l.publish(pub('p', 1400, reverse ? observations.reverse() : observations)); finish(l); return l.completedEvaluation();
    };
    expect(run(true)).toEqual(run(false));
    const result = run(false); if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.groups[0].strikes[0]).toMatchObject({ state: 'MATCHED', match: { observation: { observationId: 'x' } } });
  });
  it('deterministic generated sets preserve ownership, finite bounds, and permutation invariance', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const expected = Array.from({ length: 12 }, (_, i) => strike(`s${i}`, 500 + i * 170, ['C4', 'D4', 'E4'][(i + seed) % 3]));
      const observations = expected.filter((_, i) => (i + seed) % 4 !== 0).map((s, i) => observation(`o${i}`, s.expectedPerformanceTimeMs + ((i * 73 + seed) % 201) - 100, s.pitch));
      const run = (rows: readonly ContinuousObservation[]) => { const l = ledger(expected); l.publish(pub('p', 3000, rows)); finish(l); return l.snapshot(); };
      const result = run(observations); expect(run([...observations].reverse())).toEqual(result);
      expect(new Set(result.observationOwnership.map(o => o.observationId)).size).toBe(result.observationOwnership.length);
      for (const g of result.groups) expect(g.finality!.unclampedRequiredFrontierMs - g.performanceTimeMs).toBeLessThanOrEqual(1250);
      expect(result.reservedObservationIds).toEqual([]);
    }
  });
});
