import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { ContinuousSourceAdapter } from './source-adapter';

const root = path.resolve('../..');
function floats(bytes: Uint8Array): Float32Array { return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
it('44100 frozen research FIR and new product adapter are sample-identical, without fitted shift', async () => {
  // Qualification-only reference import; no product runtime imports research source.
  const { StreamingRationalResampler } = await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'backend/research/browser_runtime/xc2_r1_streaming_resampler.mjs')).href);
  const bytes = await readFile('public/model-assets/continuous/fir-160-441.f32');
  const reference = new StreamingRationalResampler(floats(bytes)), product = await ContinuousSourceAdapter.create(44100, bytes);
  const input = Float32Array.from({ length: 44101 }, (_, i) => Math.fround(Math.sin(i * .173) * .3));
  expect(product.push(input)).toEqual(reference.push(input));
});
it('48000 matches every existing frozen Docker SciPy fixture within its pre-frozen tolerance', async () => {
  const work = path.join(root, 'backend/data/work/xc6_capture');
  const receipt = JSON.parse(await readFile(path.join(work, 'dsp48_reference.json'), 'utf8')) as {
    fixtures: { input: string; reference: string }[]; frozenNumericTolerance: { maxAbs: number; rms: number };
  };
  const bytes = await readFile('public/model-assets/continuous/fir-1-3.f32');
  for (const fixture of receipt.fixtures) {
    const product = await ContinuousSourceAdapter.create(48000, bytes);
    const input = floats(await readFile(path.join(work, fixture.input))), reference = floats(await readFile(path.join(work, fixture.reference)));
    const actual = product.push(input); expect(actual.length).toBe(reference.length);
    let max = 0, squares = 0;
    actual.forEach((value, i) => { const d = value - reference[i]; max = Math.max(max, Math.abs(d)); squares += d * d; });
    expect(max).toBeLessThanOrEqual(receipt.frozenNumericTolerance.maxAbs);
    expect(actual.length ? Math.sqrt(squares / actual.length) : 0).toBeLessThanOrEqual(receipt.frozenNumericTolerance.rms);
  }
});
