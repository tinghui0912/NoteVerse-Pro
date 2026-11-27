import { expect, it } from 'vitest';
import { isPracticePianoKey } from './piano-key';
it('owns exactly the 88 physical piano keys independent of input source', () => {
  const accepted = Array.from({ length: 128 }, (_, key) => key).filter(isPracticePianoKey);
  expect(accepted).toHaveLength(88); expect(accepted[0]).toBe(21); expect(accepted.at(-1)).toBe(108);
  for (const key of [20, 109, 60.5, NaN, Infinity, '60', 'C4', undefined, null]) expect(isPracticePianoKey(key)).toBe(false);
});
