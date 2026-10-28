import { describe, expect, it, vi } from 'vitest';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation, ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import { CONTINUOUS_ASSIGNMENT_WINDOW_MS as W, directStrikeFrontier } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';

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
  it('reads useful frontiers without publishing and reserves evidence for its pending same-pitch claimant', () => {
    const expected = [strike('g', 1000, 'C4'), strike('a', 1250, 'D4'), strike('b', 1750, 'D4')];
    const firstFrontier = directStrikeFrontier(expected[0], expected);
    const claimantFrontier = directStrikeFrontier(expected[1], expected);
    const l = ledger(expected);
    const before = l.snapshot();
    expect(l.nextRequiredAnalysisFrontier()).toBe(firstFrontier);
    expect(l.nextRequiredAnalysisFrontier()).toBe(firstFrontier);
    expect(l.snapshot()).toEqual(before);
    l.publish(pub('observation', 1000, [observation('d', 1000, 'D4')]));
    expect(l.nextRequiredAnalysisFrontier()).toBe(firstFrontier);
    l.publish(pub('first-need', firstFrontier));
    expect(group(l, 'g').state).toBe('FINALIZED');
    expect(group(l, 'a').strikes[0].state).toBe('PENDING');
    expect(l.snapshot().reservedObservationIds).toEqual(['d']);
    expect(l.nextRequiredAnalysisFrontier()).toBe(claimantFrontier);
    l.publish(pub('claimant-coverage', claimantFrontier));
    expect(l.snapshot().observationAssignments).toEqual([{ kind: 'STRIKE_MATCH', observationId: 'd', strikeId: 'a' }]);
    expect(l.snapshot().groups.every(group => group.state === 'FINALIZED')).toBe(true);
    expect(l.nextRequiredAnalysisFrontier()).toBeNull();
  });
  it('finality records session knowledge availability separately from required performance coverage', () => {
    const expected = strike('a'), frontier = directStrikeFrontier(expected, [expected]);
    const l = ledger([expected]); l.publish(pub('delayed', frontier, [observation('o')], 4000));
    expect(group(l).strikes[0]).toMatchObject({ state: 'MATCHED', match: { timingOffsetMs: 0 },
      finality: { requiredAnalysisFrontierMs: frontier, finalizationSessionTimeMs: 4000 } });
  });
  it('completion has an independent nonnegative session coordinate and rejects availability regression', () => {
    const l = ledger(); l.publish(pub('coverage', 5000, [], 3000));
    expect(() => l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 5000, availabilitySessionTimeMs: 2999 })).toThrow('INVALID_PUBLICATION');
    l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 5000, availabilitySessionTimeMs: 3000 }); expect(l.snapshot().completion)
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
    ['non-target', [strike('a')], [observation('o', 1000, 'D4')], ['UNMATCHED'], 1],
    ['partial match', [strike('a', 1000, 'C4', 'a'), strike('b', 1000, 'E4', 'a')], [observation('o')], ['MATCHED', 'UNMATCHED'], 0],
    ['full match', [strike('a', 1000, 'C4', 'a'), strike('b', 1000, 'E4', 'a')], [observation('o'), observation('p', 1000, 'E4')], ['MATCHED', 'MATCHED'], 0],
  ] as const)('%s has explicit assignment and unowned facts', (_name, expected, observations, states, unattributedCount) => {
    const l = ledger(expected); l.publish(pub('p', Math.max(...expected.map(s => directStrikeFrontier(s, expected))), observations));
    expect(group(l).state).toBe('FINALIZED');
    expect(group(l).strikes.map(strike => strike.state)).toEqual(states);
    expect(l.snapshot().unattributedObservations).toHaveLength(unattributedCount);
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
    const l = ledger(reservation()); l.publish(pub('p', 1700, [observation('r', 1200, 'D4')])); expect(group(l, 'g').state).toBe('FINALIZED');
    expect(l.snapshot().observationAssignments).toHaveLength(0); l.publish(pub('q', 2050));
    expect(group(l, 'g').strikes.every(strike => strike.state === 'UNMATCHED')).toBe(true); expect(l.snapshot().observationAssignments[0]).toEqual({ kind: 'STRIKE_MATCH', observationId: 'r', strikeId: 'claim' });
  });
  it('keeps a non-target observation unattributed when its direct claimant uses better evidence', () => {
    const l = ledger(reservation()); l.publish(pub('p', 1700, [observation('r', 1200, 'D4'), observation('b', 1410, 'D4')]));
    expect(group(l, 'g').state).toBe('FINALIZED'); l.publish(pub('q', 2050));
    expect(l.snapshot().unattributedObservations.map(row => row.observation.observationId)).toEqual(['r']);
    expect(group(l, 'g').finality?.requiredAnalysisFrontierMs).toBe(directStrikeFrontier(strike('g'), reservation()));
    expect(group(l, 'next').strikes[0].state).toBe('PENDING');
  });
  it.each([10, 100, 150])('a %i-strike chain never extends the first group beyond its direct bound', count => {
    const expected = [strike('g'), ...Array.from({ length: count }, (_, i) => strike(`s${i.toString().padStart(3, '0')}`, 1400 + i * 200, 'D4'))];
    const l = ledger(expected);
    l.publish(pub('p', 1700, [observation('r', 1200, 'D4'), observation('b', 1410, 'D4')])); l.publish(pub('q', 2050));
    expect(group(l, 'g').strikes.every(strike => strike.state === 'UNMATCHED')).toBe(true); expect(group(l, 'g').finality?.unclampedRequiredFrontierMs).toBe(directStrikeFrontier(expected[0], expected));
  });
  it.each([1000 - W, 1000 + W])('inclusive endpoint %i matches', time => { const l = ledger(); l.publish(pub('p', 1000 + W, [observation('o', time)])); expect(group(l).strikes.every(strike => strike.state === 'MATCHED')).toBe(true); });
  it.each([[1000 + 2 * W, 1000 + 3 * W], [1000 + 2 * W + 0.001, 1000 + W]])('direct cohort boundary %f gives derived frontier %f', (time, frontier) => {
    const l = ledger([strike('a'), strike('b', time)]); l.publish(pub('p', frontier)); expect(group(l).finality?.unclampedRequiredFrontierMs).toBe(frontier);
  });
  it('derives chord group finality from the maximum child same-pitch frontier', () => {
    const expected = [strike('c', 1000, 'C4', 'chord'), strike('d', 1000, 'D4', 'chord'), strike('next-d', 1400, 'D4')];
    const childFrontiers = expected.slice(0, 2).map(child => directStrikeFrontier(child, expected));
    expect(childFrontiers[0]).not.toBe(childFrontiers[1]);
    const l = ledger(expected);
    l.publish(pub('coverage', Math.max(...childFrontiers)));
    const chord = group(l, 'chord');
    expect(chord.state).toBe('FINALIZED');
    if (chord.state !== 'FINALIZED') throw new Error('chord is not finalized');
    expect(chord.strikes.map(child => child.finality?.unclampedRequiredFrontierMs)).toEqual(childFrontiers);
    expect(chord.finality?.unclampedRequiredFrontierMs).toBe(Math.max(...childFrontiers));
  });
  it('one non-target observation has exactly one unattributed owner', () => {
    const l = ledger([strike('a'), strike('b', 1100)]); l.publish(pub('p', 1900, [observation('o', 1050, 'D4')])); finish(l);
    expect(l.snapshot().observationAssignments).toHaveLength(1); expect(l.snapshot().unattributedObservations).toHaveLength(1);
    expect(l.snapshot().observationAssignments[0]).toEqual({ kind: 'UNATTRIBUTED', observationId: 'o' });
  });
  it('MATCHED cannot also be unattributed', () => {
    const l = ledger([strike('a', 1000, 'D4'), strike('b')]); l.publish(pub('p', 1500, [observation('o', 1000, 'D4')])); finish(l);
    expect(l.snapshot().observationAssignments).toEqual([{ kind: 'STRIKE_MATCH', observationId: 'o', strikeId: 'a' }]);
  });
  it('finalized snapshots are immutable and not rewritten by later coverage', () => {
    const l = ledger(); l.publish(pub('p', 1250)); const saved = group(l); expect(Object.isFrozen(saved.strikes)).toBe(true);
    l.publish(pub('q', 1500)); expect(group(l)).toBe(saved);
  });
  it('duplicate publication is idempotent even under observation permutation', () => {
    const l = ledger(); const p = pub('p', 1250, [observation('o'), observation('x', 1000, 'E4')]);
    l.publish(p); const before = l.snapshot(); l.publish({ ...p, observations: [...p.observations].reverse() }); expect(l.snapshot()).toEqual(before);
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
    expect(l.completedAssignment().status).toBe('COMPLETE'); const before = l.snapshot(); l.complete(completion); expect(l.snapshot()).toEqual(before);
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
    const expected = strike('a'), frontier = directStrikeFrontier(expected, [expected]);
    const l = ledger([expected]); l.publish(pub('p', frontier, [observation('o')], 1800));
    expect(group(l).finality).toMatchObject({ requiredAnalysisFrontierMs: frontier, finalizationSessionTimeMs: 1800, enablingPublicationId: 'p' });
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
  it('deterministic generated sets preserve ownership, derived finality frontiers, and permutation invariance', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const expected = Array.from({ length: 12 }, (_, i) => strike(`s${i}`, 500 + i * 170, ['C4', 'D4', 'E4'][(i + seed) % 3]));
      const observations = expected.filter((_, i) => (i + seed) % 4 !== 0).map((s, i) => observation(`o${i}`, s.expectedPerformanceTimeMs + ((i * 73 + seed) % 201) - 100, s.pitch));
      const run = (rows: readonly ContinuousObservation[]) => { const l = ledger(expected); l.publish(pub('p', 3000, rows)); finish(l); return l.snapshot(); };
      const result = run(observations); expect(run([...observations].reverse())).toEqual(result);
      expect(new Set(result.observationAssignments.map(o => o.observationId)).size).toBe(result.observationAssignments.length);
      for (const g of result.groups) {
        expect(g.state).toBe('FINALIZED');
        const childFrontiers = g.strikes.map(child => {
          if (child.state === 'PENDING') throw new Error('child strike is not finalized');
          const expectedStrike = expected.find(s => s.strikeId === child.strikeId)!;
          expect(child.finality.unclampedRequiredFrontierMs).toBe(directStrikeFrontier(expectedStrike, expected));
          return child.finality.unclampedRequiredFrontierMs;
        });
        expect(g.finality!.unclampedRequiredFrontierMs).toBe(Math.max(...childFrontiers));
      }
      expect(result.reservedObservationIds).toEqual([]);
    }
  });
});


describe('deterministic exact-pitch observation ownership', () => {
  it.each([[], ['C4'], ['E4'], ['E4','F4'], ['C4','D4'], ['C4','D4','E4'], ['C4','E4','F4']])('retains target and non-target facts for %j', (...pitches: string[]) => {
    const run = (rows: readonly string[], targets: readonly string[]) => {
      const f = ledger(targets.map(pitch => strike(pitch, 1000, pitch, 'g')));
      f.publish(pub('p', 4000, rows.map(pitch => observation(pitch, 1000, pitch)), 4100));
      f.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 4000, availabilitySessionTimeMs: 4100 }); return f.snapshot();
    };
    const snapshot = run(pitches, ['C4','D4']);
    expect(run([...pitches].reverse(), ['D4','C4'])).toEqual(snapshot);
    expect(snapshot.groups[0].strikes.filter(strike => strike.state === 'MATCHED').map(strike => strike.pitch)).toEqual(['C4','D4'].filter(pitch => pitches.includes(pitch)));
    expect(snapshot.unattributedObservations.map(row => row.observation.pitch)).toEqual(pitches.filter(pitch => !['C4','D4'].includes(pitch)));
    expect(snapshot.observationAssignments).toHaveLength(pitches.length); expect(new Set(snapshot.observationAssignments.map(row => row.observationId)).size).toBe(pitches.length);
    expect(snapshot.reservedObservationIds).toEqual([]);
    expect(snapshot.groups[0].finality?.unclampedRequiredFrontierMs).toBe(1000 + W);
    expect(snapshot.unattributedObservations.every(row => row.finality.unclampedRequiredFrontierMs === 1000)).toBe(true);
  });
  it('keeps a non-target event position without inventing a target timing offset', () => {
    const f = ledger(); f.publish(pub('p', 2000, [observation('non-target', 877, 'E4')]));
    expect(f.snapshot().unattributedObservations[0].observation.performanceTimeMs).toBe(877);
    expect(f.snapshot().unattributedObservations[0]).not.toHaveProperty('timingOffsetMs');
  });
});

it.each(['publication', 'completion'] as const)('invalid same-pitch input discards the whole %s assignment plan', operation => {
  const l = ledger([strike('early', 1000, 'D4'), strike('late', 1000, 'C4')]);
  const observations = [observation('early-o', 1000, 'D4'), observation('late-o', 1000, 'C4')];
  if (operation === 'publication') l.publish(pub('initial', 0));
  else l.publish(pub('evidence', 1000, observations));
  const before = l.snapshot(), retained = l.retentionSnapshot();
  type EvidenceQuery = { observationRange(start:number,end:number,pitch?:string): ContinuousObservation[] };
  const query = l as unknown as EvidenceQuery, read = query.observationRange.bind(l);
  let queries = 0;
  // Corrupt the second cohort's owned query result after an earlier claim was staged.
  const spy = vi.spyOn(query, 'observationRange').mockImplementation((start,end,pitch) => {
    const rows=read(start,end,pitch);queries++;
    return pitch==='C4' ? rows.map(o=>({...o,pitch:'foreign-pitch'})) : rows;
  });
  let failure: unknown;
  try {
    if (operation === 'publication') l.publish(pub('incoming', 1250, observations));
    else l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 1000, availabilitySessionTimeMs: 1100 });
  } catch (error) { failure = error; }
  finally { spy.mockRestore(); }
  expect(queries).toBe(2);
  expect(failure).toMatchObject({ code: 'INVALID_PUBLICATION' });
  expect(l.snapshot()).toEqual(before); expect(l.retentionSnapshot()).toEqual(retained);
  let laterFailure: unknown;
  try { l.publish(pub('later', 2000)); } catch (error) { laterFailure = error; }
  expect(laterFailure).toBe(failure);
  expect(() => l.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 2000, availabilitySessionTimeMs: 2100 })).toThrow(failure as Error);
  expect(l.snapshot()).toEqual(before); expect(l.retentionSnapshot()).toEqual(retained);
});
it('invalid publication preserves already-retained ownership, both axes and completion state', () => {
  const l = ledger(); l.publish(pub('initial', 1250, [observation('owned')]));
  const before = l.snapshot(), retained = l.retentionSnapshot();
  const incoming = pub('invalid', 3000, [observation('new', 2000), { ...observation('bad', 2200), confidence: NaN }]);
  const inputBefore = structuredClone(incoming);
  expect(() => l.publish(incoming)).toThrow('INVALID_PUBLICATION');
  expect(l.snapshot()).toEqual(before); expect(l.retentionSnapshot()).toEqual(retained);
  expect(incoming).toEqual(inputBefore);
});

it('indexes narrow candidates but the policy predicate still owns floating-point window eligibility', () => {
  const t = 2 ** 60; // ULP 256: t + 250 rounds to t + 256, which is outside the actual +/-250 predicate.
  const l = ledger([strike('a', t)]);
  l.publish(pub('p', t + 2048, [observation('outside', t + 256, 'C4')]));
  expect(group(l).strikes[0].state).toBe('UNMATCHED');
  expect(l.snapshot().unattributedObservations.map(o => o.observation.observationId)).toEqual(['outside']);
});

it.each([['a','z'],['z','a']])('production midpoint colors follow onset chronology for strike IDs %s/%s',(a,b)=>{
  const expected=[strike(a,1000),strike(b,1300)];
  const run=(reverse:boolean,observationId:string)=>{
    const l=ledger(reverse?[...expected].reverse():expected);l.publish(pub('p',2000,[observation(observationId,1150)]));finish(l);
    const result=l.completedAssignment();if(result.status!=='COMPLETE')throw Error('incomplete');
    return result.assignment.groups.map(g=>g.strikes.map(s=>({time:s.expectedPerformanceTimeMs,state:s.state})));
  };
  for(const reverse of [true,false])for(const id of ['a-event','z-event'])expect(run(reverse,id)).toEqual([
    [{time:1000,state:'MATCHED'}],[{time:1300,state:'UNMATCHED'}],
  ]);
});
it.each([[1100,1110],[800,1100]].map(times=>({times})))('production retains two target matches for event geometry $times',({times})=>{
  const l=ledger([strike('z',1000),strike('a',1250)]);
  const observations=times.map((time,i)=>observation(`event-${i}`,time));
  l.publish(pub('p',2000,[...observations].reverse()));finish(l);
  expect(l.snapshot().groups.every(g=>g.strikes.every(s=>s.state==='MATCHED'))).toBe(true);
  expect(l.snapshot().observationAssignments.every(r=>r.kind==='STRIKE_MATCH')).toBe(true);
  expect(l.snapshot().unattributedObservations).toEqual([]);
});

it('production equal-time evidence identity fallback never changes matched targets or timing cost',()=>{
  const run=(ids:readonly string[])=>{
    const l=ledger([strike('z',1000),strike('a',1300)]);
    l.publish(pub('p',2000,ids.map(id=>observation(id,1150))));finish(l);
    const result=l.completedAssignment();if(result.status!=='COMPLETE')throw Error('incomplete');
    return {states:result.assignment.groups.map(g=>g.strikes[0].state),
      cost:result.assignment.groups.reduce((sum,g)=>sum+g.strikes.reduce((n,s)=>n+(s.state==='MATCHED'?Math.abs(s.match.timingOffsetMs):0),0),0)};
  };
  expect(run(['a-observation','z-observation'])).toEqual({states:['MATCHED','MATCHED'],cost:300});
  expect(run(['z-observation','a-observation'])).toEqual(run(['earlier-id','later-id']));
});
