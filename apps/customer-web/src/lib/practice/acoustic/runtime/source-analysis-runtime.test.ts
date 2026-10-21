import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { SourceAnalysisRuntime } from './source-analysis-runtime';
import type { SourceAcousticPublication } from './source-publication';

for (const rate of [44100, 48000]) it(`${rate}: source-only regions publish immutable absolute chronology without a product clock`, async () => {
  const publications: SourceAcousticPublication[] = [];
  const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'source', sourceSampleRateHz: rate,
    coefficientBytes: await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
    nowAvailabilityMs: () => 10000, onPublication: p => { publications.push(p); }, worker: {
      run: async input => ({ events: [{ pitch: 'C4', midiPitch: 60, confidence: .5, onsetScore: .5, frameScore: .5,
        targetSample: input.window.ownedStartTarget + 1600 }], inferenceMs: 1, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 }),
      dispose: async () => {} } });
  let next = 0;
  const feed = async (end: number) => {
    while (next < end) { const stop = Math.min(end, next + 128); runtime.append({ sourceSampleRateHz: rate,
      sourceStartSampleIndex: next, sourceEndSampleIndex: stop, samples: new Float32Array(stop - next) }); next = stop; await runtime.drain(); }
  };
  await feed(rate * 2); expect(runtime.prerollReady).toBe(true);
  runtime.beginAnalysisRegion(next); await feed(rate * 2.6); runtime.endAnalysisRegion(next);
  await feed(rate * 3); runtime.beginAnalysisRegion(next); await feed(rate * 3.6); runtime.finishRegions();
  await feed(rate * 3.8); await runtime.seal();
  expect(publications).toHaveLength(2);
  expect(publications.map(p => p.observations[0].sourceEventSample)).toEqual([rate * 2.1, rate * 3.1]);
  for (const p of publications) {
    expect(Object.isFrozen(p.observations[0])).toBe(true);
    expect(p.observations[0]).not.toHaveProperty('performanceTimeMs');
    expect(p.observations[0]).not.toHaveProperty('activationGeneration');
  }
  expect(runtime.snapshot().outstanding).toBe(0); expect(runtime.snapshot().pendingRegions).toBe(0);
  await runtime.dispose();
});
