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
