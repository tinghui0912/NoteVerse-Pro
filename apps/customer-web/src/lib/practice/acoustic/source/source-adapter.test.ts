import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { QualifiedSourceAdapter } from './source-adapter';
import golden from '../../../../../tests/fixtures/practice-acoustic/fir-golden.json';

for (const rate of [44100, 48000] as const) it(`${rate}: shipped FIR matches the numerical golden across arbitrary input partitions`, async () => {
  const coefficients = await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`);
  let state = golden.input.seed;
  const input = Float32Array.from({ length: golden.input.samples }, () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return ((state >>> 8) - 8388608) / 16777216;
  });
  for (const sizes of [[input.length], [1, 127, 3, 511, 128, 17]]) {
    const adapter = await QualifiedSourceAdapter.create(rate, coefficients);
    const output: number[] = [];
    const initialStorage = adapter.storageBytes();
    let offset = 0, partition = 0;
    while (offset < input.length) {
      const end = Math.min(input.length, offset + sizes[partition++ % sizes.length]);
      output.push(...adapter.push(input.subarray(offset, end))); offset = end;
    }
    expect(adapter.push(new Float32Array())).toHaveLength(0);
    expect(adapter.storageBytes()).toBe(initialStorage);
    expect(output).toHaveLength(golden.outputs[rate].samples);
    const bytes = new Uint8Array(output.length * 4), view = new DataView(bytes.buffer);
    output.forEach((value, index) => view.setFloat32(index * 4, value, true));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(golden.outputs[rate].sha256);
  }
});

for (const rate of [44100, 48000] as const) it(`${rate}: first fully-real output derives from the shipped FIR support`, async () => {
  const coefficients = await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`);
  const adapter = await QualifiedSourceAdapter.create(rate, coefficients);
  const taps = coefficients.byteLength / Float32Array.BYTES_PER_ELEMENT;
  expect(taps).toBe(rate === 44100 ? 8821 : 61);
  expect(adapter.center).toBe((taps - 1) / 2);
  expect([adapter.center, adapter.down]).toEqual(rate === 44100 ? [4410, 441] : [30, 3]);
  expect(adapter.firstFullyRealOutputIndex).toBe(Math.ceil(adapter.center / adapter.down));
  expect(adapter.firstFullyRealOutputIndex).toBe(10); // Established current support boundary, not another owner.
  expect((adapter.firstFullyRealOutputIndex - 1) * adapter.down).toBeLessThan(adapter.center);
  expect(adapter.firstFullyRealOutputIndex * adapter.down).toBeGreaterThanOrEqual(adapter.center);
});

for (const rate of [44100, 48000] as const) it(`${rate}: all rational phases attain the FIR-derived private source storage bound`, async () => {
  const coefficients = await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`);
  const adapter = await QualifiedSourceAdapter.create(rate, coefficients);
  const taps = coefficients.byteLength / Float32Array.BYTES_PER_ELEMENT;
  const capacity = Math.ceil(taps / adapter.up), phases = new Set<number>();
  let maximumSpan = 0;
  // down and up are coprime: these successive full-support outputs visit every rational phase.
  for (let offset = 0; offset < adapter.up; offset++) {
    const m = adapter.firstFullyRealOutputIndex + offset, coordinate = m * adapter.down + adapter.center;
    const begin = Math.max(0, Math.ceil((coordinate - taps + 1) / adapter.up));
    const end = Math.floor(coordinate / adapter.up), span = end - begin + 1;
    phases.add(coordinate % adapter.up);
    expect(span).toBeLessThanOrEqual(capacity);
    maximumSpan = Math.max(maximumSpan, span);
  }
  expect(phases.size).toBe(adapter.up);
  expect(maximumSpan).toBe(capacity);
  expect(maximumSpan).toBe(rate === 44100 ? 56 : 61); // Current assets, not a capacity policy.
  expect(adapter.storageBytes()).toBe(coefficients.byteLength + capacity * Float32Array.BYTES_PER_ELEMENT);
  expect(adapter.storageBytes()).toBe(rate === 44100 ? 35508 : 488);
});
