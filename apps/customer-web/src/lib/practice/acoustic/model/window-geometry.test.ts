import { expect, it } from 'vitest';
import { assertWindowGeometry } from './model-validation';
import { planWindow } from '../runtime/window-planner';
import { ACOUSTIC_MODEL as M, ACOUSTIC_TARGET_SAMPLES_PER_MS } from './model-contract';

it('derives target samples/ms once from model rate without a new geometry policy', () => {
  expect(ACOUSTIC_TARGET_SAMPLES_PER_MS).toBe(M.sampleRateHz / 1000);
  expect(M.sampleRateHz).toBe(16000); expect(ACOUSTIC_TARGET_SAMPLES_PER_MS).toBe(16);
  expect([M.ownedMs, M.futureMs, M.inputMs, M.inputMs - M.ownedMs - M.futureMs].map(ms => ms * ACOUSTIC_TARGET_SAMPLES_PER_MS))
    .toEqual([9600, 2720, 29120, 16800]);
  expect((M.inputMs - M.futureMs) * ACOUSTIC_TARGET_SAMPLES_PER_MS).toBe(26400);
});

for (const [up, down] of [[1, 3], [160, 441]]) it(`${up}/${down}: fractional source anchors preserve the exact fixed-width construction`, () => {
  for (let sourceStart = 79000; sourceStart < 81000; sourceStart++) {
    const originTarget = sourceStart * up / down;
    const window = planWindow({ index: 0, sourceStart, originTarget, nextWindow: 0, queuedEndTarget: originTarget }, 0)!;
    expect(() => assertWindowGeometry(window)).not.toThrow();
    expect(window.ownedEndTarget).toBe(window.ownedStartTarget + M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS);
    expect(() => assertWindowGeometry({ ...window, ownedEndTarget: window.ownedEndTarget + 1 })).toThrow('ACOUSTIC_WORKER_WINDOW_MISMATCH');
  }
});
it.each([44100, 48000])('%i: full and partial fractional geometry retains multiplication order and endpoint rounding', rate => {
  const sourceStart = rate * 2 + 7, originTarget = sourceStart * M.sampleRateHz / rate;
  for (const nextWindow of [0, 1, 2]) {
    const ownedStart = originTarget + nextWindow * M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS;
    for (const width of [M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS, 531.5]) {
      const endTarget = ownedStart + width;
      const window = planWindow({ index: 0, sourceStart, originTarget, nextWindow, queuedEndTarget: ownedStart, endTarget }, nextWindow)!;
      expect(window.ownedStartTarget).toBe(ownedStart);
      expect(window.ownedEndTarget).toBe(Math.min(ownedStart + M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS, endTarget));
      expect(window.endSample).toBe(Math.round(window.ownedEndTarget + M.futureMs * ACOUSTIC_TARGET_SAMPLES_PER_MS));
      expect(window.startSample).toBe(window.endSample - M.inputSamples);
      expect(() => assertWindowGeometry(window)).not.toThrow();
    }
  }
});
it.each([[19200.499999, 31520], [19200.5, 31521], [19200.500001, 31521]])('origin %s retains Math.round after future-context addition', (originTarget, expectedEnd) => {
  const window = planWindow({ index: 0, sourceStart: 57600, originTarget, nextWindow: 0, queuedEndTarget: originTarget }, 0)!;
  expect(window.endSample).toBe(expectedEnd); expect(window.startSample).toBe(expectedEnd - M.inputSamples);
  expect(() => assertWindowGeometry(window)).not.toThrow();
});
it('records the rejected v3 source anchor without rounding it', () => {
  const start = 79232 / 3;
  expect((start + 9600) - start).toBeGreaterThan(9600);
  const window = planWindow({ index: 0, sourceStart: 79232, originTarget: start, nextWindow: 0, queuedEndTarget: start }, 0)!;
  expect(() => assertWindowGeometry(window)).not.toThrow();
});
