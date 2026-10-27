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

// These tests exercise the actual fixed budgets, not smaller injectable test limits.
const resourceCode = 'CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED';
const obs = (i: number, time = i + 1) => ({ observationId: `o${i}`, pitch: 'C4', performanceTimeMs: time, confidence: 1, source: 'MIDI' as const });
const retainedState = (store: ContinuousEvidenceStore) => ({ frontier: store.analyzedThrough, availability: store.availableSessionTimeMs,
  observations: store.values(), observationCount: store.observationCount, publicationCount: store.publicationCount });

it('accepts exactly 16,384 observations per publication, rejects 16,385 atomically and latches the first resource failure', () => {
  const max = 16384, store = new ContinuousEvidenceStore('axes');
  const batch = Array.from({ length: max }, (_, i) => obs(i));
  store.accept({ ...publication('max', max, max), observations: batch }, false);
  expect(store.observationCount).toBe(max);
  const other = new ContinuousEvidenceStore('axes'), before = retainedState(other);
  const oversized = { ...publication('overflow', max + 1, max + 1), observations: [...batch, obs(max)] };
  let failure: unknown;
  try { other.accept(oversized, false); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: resourceCode }); expect(retainedState(other)).toEqual(before);
  expect(() => other.accept(publication('later', 1, 1), false)).toThrow(failure as Error);
  expect(retainedState(other)).toEqual(before);
});
it('retains exactly 65,536 observations with complete range/pitch/ID indexes and no partial next publication', () => {
  const store = new ContinuousEvidenceStore('axes');
  for (let batch = 0; batch < 4; batch++) {
    const start = batch * 16384, end = start + 16384;
    store.accept({ ...publication(`p${batch}`, end, end), observations: Array.from({ length: 16384 }, (_, i) => obs(start + i)) }, false);
  }
  expect(store.observationCount).toBe(65536); expect(store.values()).toHaveLength(65536);
  expect(store.observation('o123')?.performanceTimeMs).toBe(124);
  expect(store.inRange(124, 125, 'C4').map(o => o.observationId)).toEqual(['o123', 'o124']);
  expect(store.inRange(124, 125, 'D4')).toEqual([]);
  expect(Object.isFrozen(store.values())).toBe(true); expect(Object.isFrozen(store.observation('o123'))).toBe(true);
  const before = retainedState(store);
  expect(() => store.accept({ ...publication('next', 65537, 65537), observations: [obs(65536)] }, false)).toThrow(resourceCode);
  expect(retainedState(store)).toEqual(before);
  expect(() => store.accept(publication('empty-later', 65538, 65538), false)).toThrow(resourceCode);
});
it('65,536 receipts preserve permutation replay and mutation detection at capacity, then reject a new publication atomically', () => {
  const store = new ContinuousEvidenceStore('axes');
  const first = { ...publication('p0', 1, 1), observations: [obs(0, 0), obs(1, 1)] };
  store.accept(first, false);
  for (let i = 1; i < 65536; i++) store.accept(publication(`p${i}`, i + 1, i + 1), false);
  expect(store.publicationCount).toBe(65536);
  const before = retainedState(store);
  expect(store.accept({ ...first, observations: [...first.observations].reverse() }, false)).toBeNull();
  expect(() => store.accept({ ...first, observations: [obs(0, 0), { ...obs(1, 1), confidence: .5 }] }, false)).toThrow('PUBLICATION_MUTATED');
  expect(retainedState(store)).toEqual(before);
  expect(() => store.accept(publication('overflow', 65537, 65537), false)).toThrow(resourceCode);
  expect(retainedState(store)).toEqual(before);
});
it('compact receipts compare every observation field and publication header without retaining duplicate payload strings', () => {
  const store = new ContinuousEvidenceStore('axes');
  const value = { ...publication('p', 1, 2), observations: [{ ...obs(0, 1), provenance: { sourceDomainId: 'source', sourceSampleRateHz: 48000, sourceEventSample: 3 } }] };
  store.accept(value, false);
  for (const mutate of [
    (v: typeof value) => { v.observations[0].provenance.sourceEventSample++; },
    (v: typeof value) => { v.observations[0].pitch = 'D4'; },
    (v: typeof value) => { v.availabilitySessionTimeMs++; },
  ]) { const changed = structuredClone(value); mutate(changed); expect(() => store.accept(changed, false)).toThrow('PUBLICATION_MUTATED'); }
  expect(() => store.accept({ ...publication('other', 2, 3), observations: [obs(0, 2)] }, false)).toThrow('DUPLICATE_OBSERVATION');
});
it('invalid/oversized later observations cannot partially insert valid earlier members or advance either axis', () => {
  const store = new ContinuousEvidenceStore('axes'); store.accept(publication('first', 0, 1), false);
  const before = retainedState(store);
  expect(() => store.accept({ ...publication('bad', 3, 4), observations: [obs(1, 1), { ...obs(2, 2), observationId: 'x'.repeat(513) }] }, false)).toThrow(resourceCode);
  expect(retainedState(store)).toEqual(before);
});
it('accepts identity/pitch exact lengths and rejects overlong publication/domain/pitch/provenance identities', () => {
  const store = new ContinuousEvidenceStore('d'.repeat(512));
  store.accept({ publicationId: 'p'.repeat(512), sessionDomainId: 'd'.repeat(512), analyzedThroughPerformanceMs: 1, availabilitySessionTimeMs: 1,
    observations: [{ ...obs(0, 1), observationId: 'o'.repeat(512), pitch: 'P'.repeat(16) }] }, false);
  expect(store.observationCount).toBe(1);
  const longDomain = new ContinuousEvidenceStore('d'.repeat(513));
  const domainBefore = retainedState(longDomain);
  expect(() => longDomain.accept({ ...publication('p', 1, 1), sessionDomainId: 'd'.repeat(513) }, false)).toThrow(resourceCode);
  expect(retainedState(longDomain)).toEqual(domainBefore);
  const changes = [
    { ...publication('p'.repeat(513), 1, 1), observations: [] },
    { ...publication('p', 1, 1), observations: [{ ...obs(0, 1), pitch: 'P'.repeat(17) }] },
    { ...publication('p', 1, 1), observations: [{ ...obs(0, 1), provenance: { sourceDomainId: 's'.repeat(513), sourceSampleRateHz: 48000, sourceEventSample: 1 } }] },
  ];
  for (const value of changes) {
    const other = new ContinuousEvidenceStore('axes'), before = retainedState(other);
    expect(() => other.accept(value, false)).toThrow(resourceCode); expect(retainedState(other)).toEqual(before);
  }
});
