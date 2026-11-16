import { it, expect } from 'vitest';
import { toDomainRhythm } from './event-inspector-domain-adapter';
it('converts explicit Inspector input duration to exact domain rhythm', () => {
  expect(toDomainRhythm('durationEighth', true)).toEqual({
    timelineDuration: { numerator: 3, denominator: 4 },
    notation: { base: 'eighth', dots: 1 },
  });
  expect(toDomainRhythm('durationWhole', false).timelineDuration).toEqual({
    numerator: 4,
    denominator: 1,
  });
});
