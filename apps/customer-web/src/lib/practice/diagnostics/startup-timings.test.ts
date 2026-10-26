import { expect, it } from 'vitest';
import { PracticeStartupTimings } from './startup-timings';
it('retains immutable bounded phase measurements with success and failure, independently for each attempt', async () => {
  let now = 1; const first = new PracticeStartupTimings(() => now);
  expect(await first.measure('waitPreviousRelease', async () => { now = 4; return 'released'; })).toBe('released');
  await expect(first.measure('recorderAdmission', async () => { now = 9; throw new Error('denied'); })).rejects.toThrow('denied');
  expect(first.snapshot()).toEqual([{ phase: 'waitPreviousRelease', durationMs: 3, outcome: 'SUCCEEDED' }, { phase: 'recorderAdmission', durationMs: 5, outcome: 'FAILED' }]);
  expect(Object.isFrozen(first.snapshot())).toBe(true); expect(Object.isFrozen(first.snapshot()[0])).toBe(true);
  expect(new PracticeStartupTimings().snapshot()).toEqual([]);
});
