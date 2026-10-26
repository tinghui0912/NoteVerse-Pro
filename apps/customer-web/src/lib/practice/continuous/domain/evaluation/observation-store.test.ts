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
