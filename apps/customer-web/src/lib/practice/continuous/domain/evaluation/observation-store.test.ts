import { expect, it } from 'vitest';
import { ContinuousEvidenceStore } from './observation-store';

const publication = (id: string, frontier: number, available: number) => ({ publicationId: id, sessionDomainId: 'axes',
  analyzedThroughPerformanceMs: frontier, availabilitySessionTimeMs: available, observations: [] });

it('advances two independent monotonic axes without comparing their numeric origins', () => {
  const store = new ContinuousEvidenceStore('axes');
  store.accept(publication('a', 100, 1000), false);
  store.accept(publication('b', 200, 5000), false);
  expect(store.analyzedThrough).toBe(200); expect(store.availableSessionTimeMs).toBe(5000);
  const other = new ContinuousEvidenceStore('axes');
  expect(() => other.accept(publication('independent-origin', 5000, 3000), false)).not.toThrow();
  expect(other.analyzedThrough).toBe(5000); expect(other.availableSessionTimeMs).toBe(3000);
});
it.each([[99, 1001], [101, 999], [-1, 1001], [101, -1], [Infinity, 1001], [101, NaN]])('rejects invalid/regressing axes %s / %s independently', (frontier, available) => {
  const store = new ContinuousEvidenceStore('axes'); store.accept(publication('first', 100, 1000), false);
  expect(() => store.accept(publication('invalid', frontier, available), false)).toThrow('INVALID_PUBLICATION');
});

const obs = (observationId: string, time: number, pitch = 'C4') => ({ observationId, pitch, performanceTimeMs: time, confidence: 1, source: 'MIDI' as const });
const retainedState = (store: ContinuousEvidenceStore) => ({ frontier: store.analyzedThrough, availability: store.availableSessionTimeMs,
  observations: store.values(), observationCount: store.observationCount, publicationCount: store.publicationCount });

it('time/pitch indexes preserve inclusive endpoints and the full canonical retained order across publications', () => {
  const store = new ContinuousEvidenceStore('axes');
  store.accept({ ...publication('first', 20, 25), observations: [obs('b', 10), obs('a', 20, 'D4')] }, false);
  const earlier = store.values();
  store.accept({ ...publication('next', 40, 45), observations: [obs('d', 40), obs('c', 30, 'E4')] }, false);
  expect(store.values().map(o => o.observationId)).toEqual(['a', 'b', 'c', 'd']);
  expect(earlier.map(o => o.observationId)).toEqual(['a', 'b']);
  expect(store.inRange(10, 30).map(o => o.observationId)).toEqual(['b', 'a', 'c']);
  expect(store.inRange(10, 40, 'C4').map(o => o.observationId)).toEqual(['b', 'd']);
  expect(store.inRange(20, 20, 'D4').map(o => o.observationId)).toEqual(['a']);
  expect(store.inRange(10, 40, 'F4')).toEqual([]);
  expect(store.observation('c')).toEqual(obs('c', 30, 'E4'));
  expect(Object.isFrozen(store.values())).toBe(true); expect(store.values().every(Object.isFrozen)).toBe(true);
  const query = store.inRange(10, 40) as ReturnType<typeof obs>[];
  query.pop(); expect(store.observationCount).toBe(4); expect(store.values()).toHaveLength(4);
});
it('historical permutation replay is idempotent without advancing either axis or allocating another receipt', () => {
  const store = new ContinuousEvidenceStore('axes');
  const first = { ...publication('first', 20, 25), observations: [obs('b', 10), obs('a', 20)] };
  store.accept(first, false); store.accept(publication('later', 30, 35), false);
  const before = retainedState(store);
  expect(store.accept({ ...first, observations: [...first.observations].reverse() }, false)).toBeNull();
  expect(retainedState(store)).toEqual(before);
});
it('compact receipts compare exact header, membership and retained provenance without duplicating payload strings', () => {
  const store = new ContinuousEvidenceStore('axes');
  const value = { ...publication('p', 20, 25), observations: [{ ...obs('a', 10), provenance: { sourceDomainId: 'source', sourceSampleRateHz: 48000, sourceEventSample: 3 } },
    { ...obs('b', 20), provenance: { sourceDomainId: 'source', sourceSampleRateHz: 48000, sourceEventSample: 4 } }] };
  store.accept(value, false); const before = retainedState(store);
  const mutations: ((v: typeof value) => void)[] = [
    v => { v.observations[0].provenance.sourceEventSample++; }, v => { v.observations[0].pitch = 'D4'; },
    v => { v.observations[0].confidence = .5; }, v => { v.observations[0].performanceTimeMs++; },
    v => { v.availabilitySessionTimeMs++; }, v => { v.analyzedThroughPerformanceMs++; },
    v => { v.sessionDomainId = 'foreign'; }, v => { v.observations.pop(); },
    v => { v.observations[1] = structuredClone(v.observations[0]); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(value); mutate(changed);
    const inputBefore = structuredClone(changed);
    expect(() => store.accept(changed, false)).toThrow('PUBLICATION_MUTATED');
    expect(retainedState(store)).toEqual(before); expect(changed).toEqual(inputBefore);
  }
});
it.each(['invalid', 'duplicate', 'late', 'provenance'] as const)('rejects %s evidence without partial facts, receipts or frontier mutation', kind => {
  const store = new ContinuousEvidenceStore('axes');
  store.accept({ ...publication('first', 20, 25), observations: [obs('owned', 10)] }, false);
  const bad = kind === 'invalid' ? { ...obs('bad', 30), confidence: NaN }
    : kind === 'duplicate' ? obs('owned', 30)
    : kind === 'late' ? obs('bad', 20)
    : { ...obs('bad', 30), provenance: { sourceDomainId: 'source', sourceSampleRateHz: 0, sourceEventSample: 1 } };
  const input = { ...publication('next', 40, 45), observations: [obs('new', 30), bad] };
  const before = retainedState(store), inputBefore = structuredClone(input);
  expect(() => store.accept(input, false)).toThrow(kind === 'duplicate' ? 'DUPLICATE_OBSERVATION' : kind === 'late' ? 'LATE_EVIDENCE' : 'INVALID_PUBLICATION');
  expect(retainedState(store)).toEqual(before); expect(input).toEqual(inputBefore);
});
it('receipt preparation rejects malformed non-JSON headers before any retained mutation', () => {
  const store = new ContinuousEvidenceStore('axes'); store.accept(publication('first', 0, 1), false);
  const before = retainedState(store);
  const malformed = { ...publication('bad', 10, 15), observations: [obs('new', 10)], malformedHeader: BigInt(1) };
  expect(() => store.accept(malformed, false)).toThrow(TypeError);
  expect(retainedState(store)).toEqual(before);
});
