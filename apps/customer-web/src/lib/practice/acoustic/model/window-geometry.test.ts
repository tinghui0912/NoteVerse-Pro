import { expect, it } from 'vitest';
import { assertWindowGeometry } from './model-validation';
import { planWindow } from '../runtime/window-planner';

for (const [up, down] of [[1, 3], [160, 441]]) it(`${up}/${down}: fractional source anchors preserve the exact fixed-width construction`, () => {
  for (let sourceStart = 79000; sourceStart < 81000; sourceStart++) {
    const originTarget = sourceStart * up / down;
    const window = planWindow({ index: 0, sourceStart, originTarget, nextWindow: 0, queuedEndTarget: originTarget }, 0)!;
    expect(() => assertWindowGeometry(window)).not.toThrow();
    expect(window.ownedEndTarget).toBe(window.ownedStartTarget + 9600);
    expect(() => assertWindowGeometry({ ...window, ownedEndTarget: window.ownedEndTarget + 1 })).toThrow('ACOUSTIC_WORKER_WINDOW_MISMATCH');
  }
});
it('records the rejected v3 source anchor without rounding it', () => {
  const start = 79232 / 3;
  expect((start + 9600) - start).toBeGreaterThan(9600);
  const window = planWindow({ index: 0, sourceStart: 79232, originTarget: start, nextWindow: 0, queuedEndTarget: start }, 0)!;
  expect(() => assertWindowGeometry(window)).not.toThrow();
});
