import { expect, it } from 'vitest';
import { CONTINUOUS_ASSIGNMENT_WINDOW_MS as W, directStrikeCohort, directStrikeFrontier, withinContinuousWindow } from './finalization-policy';

it.each([1000, 10000, 1000000])('direct cohort frontier is derived from W, with no independent bound at anchor %s', time => {
  const target = (id: string, offset: number) => ({ strikeId: id, groupId: id, pitch: 'C4', expectedPerformanceTimeMs: time + offset, renderNoteIds: [] });
  const anchor = target('anchor', 0), edge = target('edge', 2 * W), transitive = target('transitive', 4 * W);
  expect(directStrikeCohort(anchor, [anchor, edge, transitive])).toEqual([anchor, edge]);
  expect(directStrikeFrontier(anchor, [anchor, edge, transitive])).toBe(time + 3 * W);
  expect(directStrikeFrontier(anchor, [anchor, target('outside', 2 * W + 1)])).toBe(time + W);
});
it('keeps inclusive same-pitch timing eligibility unchanged', () => {
  for (const sign of [-1, 1]) {
    expect(withinContinuousWindow(1000, 1000 + sign * W)).toBe(true);
    expect(withinContinuousWindow(1000, 1000 + sign * (W + 1))).toBe(false);
  }
});
