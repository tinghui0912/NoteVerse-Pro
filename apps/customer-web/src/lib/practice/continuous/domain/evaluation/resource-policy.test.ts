import { expect, it } from 'vitest';
import { CONTINUOUS_EVALUATION_RESOURCES as limits, assertContinuousResourceCount, assertContinuousIdentityBudget } from './resource-policy';
it('freezes engineering ceilings independently of learner policy identities', () => {
  expect(limits).toEqual({ maxObservationsPerPublication: 16384, maxRetainedObservations: 65536, maxRetainedPublications: 65536,
    maxPendingMidiObservations: 4096, maxMatchingEdges: 262144, maxIdentityChars: 512, maxPitchChars: 16 });
  expect(Object.isFrozen(limits)).toBe(true);
});
it.each(Object.entries(limits))('%s accepts the exact ceiling and rejects one more', (_key, max) => {
  expect(() => assertContinuousResourceCount(max, max)).not.toThrow();
  expect(() => assertContinuousResourceCount(max + 1, max)).toThrow('CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED');
});
it.each([false, true])('identity/pitch length is bounded before retention: pitch=%s', pitch => {
  const max = pitch ? limits.maxPitchChars : limits.maxIdentityChars;
  expect(() => assertContinuousIdentityBudget('x'.repeat(max), pitch)).not.toThrow();
  expect(() => assertContinuousIdentityBudget('x'.repeat(max + 1), pitch)).toThrow('CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED');
});
