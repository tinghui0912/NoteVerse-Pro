import { expect, it } from 'vitest';
import { assertWindowGeometry } from './model-validation';
import { planWindow } from '../runtime/window-planner';
import { ACOUSTIC_RUNTIME_CONTRACT as M, ACOUSTIC_TARGET_SAMPLES_PER_MS } from '../generated/runtime-contract';

it('derives target samples/ms once from model rate without a new geometry policy', () => {
  expect(ACOUSTIC_TARGET_SAMPLES_PER_MS).toBe(M.input.sampleRateHz / 1000);
  expect(M.input.sampleRateHz).toBe(16000); expect(ACOUSTIC_TARGET_SAMPLES_PER_MS).toBe(16);
  expect([(M.window.ownedSamples / (M.input.sampleRateHz / 1000)), (M.window.futureContextSamples / (M.input.sampleRateHz / 1000)), (M.input.shape[1] / (M.input.sampleRateHz / 1000)), (M.input.shape[1] / (M.input.sampleRateHz / 1000)) - (M.window.ownedSamples / (M.input.sampleRateHz / 1000)) - (M.window.futureContextSamples / (M.input.sampleRateHz / 1000))].map(ms => ms * ACOUSTIC_TARGET_SAMPLES_PER_MS))
    .toEqual([9600, 2720, 29120, 16800]);
  expect(((M.input.shape[1] / (M.input.sampleRateHz / 1000)) - (M.window.futureContextSamples / (M.input.sampleRateHz / 1000))) * ACOUSTIC_TARGET_SAMPLES_PER_MS).toBe(26400);
});

for (const [up, down] of [[1, 3], [160, 441]]) it(`${up}/${down}: fractional source anchors preserve the exact fixed-width construction`, () => {
  for (let sourceStart = 79000; sourceStart < 81000; sourceStart++) {
    const originTarget = sourceStart * up / down;
    const window = planWindow({ index: 0, sourceStart, originTarget, nextWindow: 0, queuedEndTarget: originTarget }, 0)!;
    expect(() => assertWindowGeometry(window)).not.toThrow();
    expect(window.ownedEndTarget).toBe(window.ownedStartTarget + M.window.ownedSamples);
    expect(() => assertWindowGeometry({ ...window, ownedEndTarget: window.ownedEndTarget + 1 })).toThrow('ACOUSTIC_WORKER_WINDOW_MISMATCH');
  }
});
it.each([44100, 48000])('%i: full and partial fractional geometry retains multiplication order and endpoint rounding', rate => {
  const sourceStart = rate * 2 + 7, originTarget = sourceStart * M.input.sampleRateHz / rate;
  for (const nextWindow of [0, 1, 2]) {
    const ownedStart = originTarget + nextWindow * M.window.ownedSamples;
    for(const width of [M.window.ownedSamples, 531.5]) {
      const endTarget = ownedStart + width;
      const window = planWindow({ index: 0, sourceStart, originTarget, nextWindow, queuedEndTarget: ownedStart, endTarget }, nextWindow)!;
      expect(window.ownedStartTarget).toBe(ownedStart);
      expect(window.ownedEndTarget).toBe(Math.min(ownedStart + M.window.ownedSamples, endTarget));
      expect(window.endSample).toBe(Math.round(window.ownedEndTarget + M.window.futureContextSamples));
      expect(window.startSample).toBe(window.endSample - M.input.shape[1]);
      expect(() => assertWindowGeometry(window)).not.toThrow();
    }
  }
});
it.each([[19200.499999, 31520], [19200.5, 31521], [19200.500001, 31521]])('origin %s retains Math.round after future-context addition', (originTarget, expectedEnd) => {
  const window = planWindow({ index: 0, sourceStart: 57600, originTarget, nextWindow: 0, queuedEndTarget: originTarget }, 0)!;
  expect(window.endSample).toBe(expectedEnd); expect(window.startSample).toBe(expectedEnd - M.input.shape[1]);
  expect(() => assertWindowGeometry(window)).not.toThrow();
  for (const shift of [-1, 1]) {
    const adjacent = { ...window, startSample: window.startSample + shift, endSample: window.endSample + shift };
    expect(adjacent.endSample - adjacent.startSample).toBe(M.input.shape[1]);
    expect(() => assertWindowGeometry(adjacent)).toThrow('ACOUSTIC_WORKER_WINDOW_MISMATCH');
  }
});
it('records the rejected v3 source anchor without rounding it', () => {
  const start = 79232 / 3;
  expect((start + 9600) - start).toBeGreaterThan(9600);
  const window = planWindow({ index: 0, sourceStart: 79232, originTarget: start, nextWindow: 0, queuedEndTarget: start }, 0)!;
  expect(() => assertWindowGeometry(window)).not.toThrow();
});

it.each([44100, 48000])('%i: coupled one-sample endpoint shifts preserve width but violate the integral producer construction', rate => {
  const sourceStart = rate * 2, originTarget = sourceStart * M.input.sampleRateHz / rate;
  const window = planWindow({ index: 0, sourceStart, originTarget, nextWindow: 0, queuedEndTarget: originTarget }, 0)!;
  const constructedEnd = window.ownedEndTarget + M.window.futureContextSamples;
  expect(Number.isInteger(constructedEnd)).toBe(true);
  expect(window.endSample).toBe(Math.round(constructedEnd));
  expect(() => assertWindowGeometry(window)).not.toThrow();
  for (const shift of [-1, 1]) {
    const malformed = { ...window, startSample: window.startSample + shift, endSample: window.endSample + shift };
    expect(malformed.endSample - malformed.startSample).toBe(M.input.shape[1]);
    expect(Math.abs(malformed.endSample - constructedEnd)).toBe(1); // Historical slack admitted these direct inputs.
    expect(() => assertWindowGeometry(malformed)).toThrow('ACOUSTIC_WORKER_WINDOW_MISMATCH');
  }
});

it.each([44100, 48000])('%i: near-safe-integer source anchors validate exact full/partial construction without PCM allocation', rate => {
  for (const offset of [0, 1, rate - 1]) {
    // Leave real future/source support inside the safe source-coordinate range.
    const sourceStart = Number.MAX_SAFE_INTEGER - rate * 2 - offset;
    expect(Number.isSafeInteger(sourceStart)).toBe(true);
    const originTarget = sourceStart * M.input.sampleRateHz / rate;
    for(const width of [M.window.ownedSamples, 531.5]) {
      const window = planWindow({ index: 0, sourceStart, originTarget, nextWindow: 0,
        queuedEndTarget: originTarget, endTarget: originTarget + width }, 0)!;
      const expectedEnd = Math.round(window.ownedEndTarget + M.window.futureContextSamples);
      expect(Number.isSafeInteger(window.endSample)).toBe(true);
      expect(window.endSample).toBe(expectedEnd);
      expect(window.endSample - window.startSample).toBe(M.input.shape[1]);
      expect(() => assertWindowGeometry(window)).not.toThrow();
      for (const shift of [-1, 1]) {
        const malformed = { ...window, startSample: window.startSample + shift, endSample: window.endSample + shift };
        expect(malformed.endSample - malformed.startSample).toBe(M.input.shape[1]);
        expect(malformed.endSample).not.toBe(expectedEnd);
        expect(() => assertWindowGeometry(malformed)).toThrow('ACOUSTIC_WORKER_WINDOW_MISMATCH');
      }
    }
  }
});
