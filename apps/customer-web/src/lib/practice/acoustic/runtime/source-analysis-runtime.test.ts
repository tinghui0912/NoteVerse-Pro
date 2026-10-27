import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { SourceAnalysisRuntime } from './source-analysis-runtime';
import { sourceObservationId, type SourceAcousticPublication } from './source-publication';
import type { AcousticInferenceInput } from './inference-types';

for (const rate of [44100, 48000]) it(`${rate}: real producer delivers one contiguous immutable stream across windows, partial regions and source gaps`, async () => {
  const publications: SourceAcousticPublication[] = [], runs: number[] = [];
  const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'source', sourceSampleRateHz: rate,
    coefficientBytes: await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
    nowAvailabilityRuntimeMs: () => 10000, onPublication: p => { publications.push(p); }, worker: {
      run: async input => { runs.push(input.window.jobIndex); return { events: [Math.ceil(input.window.ownedStartTarget), Math.ceil(input.window.ownedEndTarget) - 1].map(targetSample =>
        ({ pitch: 'C4', midiPitch: 60, confidence: .5, onsetScore: .5, frameScore: .5, targetSample })),
      inferenceMs: 1, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 }; }, dispose: async () => {} } });
  let next = 0;
  const feed = async (end: number) => {
    end = Math.round(end);
    while (next < end) { const stop = Math.min(end, next + 128); runtime.append({ sourceSampleRateHz: rate,
      sourceStartSampleIndex: next, sourceEndSampleIndex: stop, samples: new Float32Array(stop - next) }); next = stop; await runtime.drain(); }
  };
  try {
    await feed(rate * 2); expect(runtime.prerollReady).toBe(true);
    runtime.beginAnalysisRegion(next); await feed(rate * 3.4); runtime.endAnalysisRegion(next);
    await feed(rate * 4.2); runtime.beginAnalysisRegion(next); await feed(rate * 5.6); runtime.finishRegions();
    await feed(rate * 5.9); await runtime.seal();
    expect(publications).toHaveLength(6);
    expect(publications.map(p => p.window.jobIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(runs).toEqual([0, 1, 2, 3, 4, 5]);
    expect(publications.map(p => [p.window.regionIndex, p.window.windowIndex])).toEqual([[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]);
    const ids = new Set<string>();
    let previous = -1;
    for (const p of publications) {
      expect(p.ownedThroughSourceSample).toBeGreaterThan(previous);
      expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(p.window)).toBe(true); expect(Object.isFrozen(p.observations)).toBe(true);
      for (const o of p.observations) {
        expect(Object.isFrozen(o)).toBe(true);
        expect(o.sourceEventSample).toBeGreaterThanOrEqual(previous);
        expect(o.sourceEventSample).toBeLessThan(p.ownedThroughSourceSample);
        expect(o.targetSample).toBeGreaterThanOrEqual(p.window.ownedStartTarget);
        expect(o.targetSample).toBeLessThan(p.window.ownedEndTarget);
        expect(o.observationId).toBe(sourceObservationId('source', p.window, o.midiPitch, o.targetSample));
        expect(ids.has(o.observationId)).toBe(false); ids.add(o.observationId);
        expect(o).not.toHaveProperty('performanceTimeMs'); expect(o).not.toHaveProperty('attemptId');
      }
      previous = p.ownedThroughSourceSample;
    }
    // Inclusive lower boundary belongs to the next window, never the preceding one.
    expect(publications[1].observations[0].sourceEventSample).toBe(publications[0].ownedThroughSourceSample);
    expect(publications[3].observations[0].sourceEventSample).toBeGreaterThan(publications[2].ownedThroughSourceSample);
    expect(runtime.snapshot()).toMatchObject({ outstanding: 0, pendingRegions: 0, counts: { windowsPublished: 6 } });
  } finally { await runtime.dispose(); }
});

it.each([false, true])('queued inference is delivered once in order, or terminates without restarting (failure=%s)', async failure => {
  const delivered: number[] = [], started: number[] = [], failures: Error[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const worker = { run: vi.fn(async ({ window }: AcousticInferenceInput) => {
    started.push(window.jobIndex);
    if (window.jobIndex === 0) { await gate; if (failure) throw new Error('FAKE_INFERENCE_FAILURE'); }
    return { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 };
  }), dispose: vi.fn(async () => {}) };
  const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'ordered', sourceSampleRateHz: 48000,
    coefficientBytes: await readFile('public/model-assets/practice-acoustic/fir-1-3.f32'), worker,
    nowAvailabilityRuntimeMs: () => 0, onPublication: p => { delivered.push(p.window.jobIndex); }, onFailure: e => { failures.push(e); } });
  let next = 0;
  const feed = (end: number) => { while (next < end) { const stop = Math.min(end, next + 128);
    runtime.append({ sourceSampleRateHz: 48000, sourceStartSampleIndex: next, sourceEndSampleIndex: stop, samples: new Float32Array(stop - next) }); next = stop; } };
  try {
    feed(96000); runtime.beginAnalysisRegion(next); feed(48000 * 3.4);
    await Promise.resolve(); expect(started).toEqual([0]); expect(delivered).toEqual([]);
    expect(runtime.snapshot().counts.windowsQueued).toBe(2);
    release();
    if (failure) {
      await expect(runtime.drain()).rejects.toThrow('FAKE_INFERENCE_FAILURE');
      expect(started).toEqual([0]); expect(delivered).toEqual([]); expect(failures).toHaveLength(1);
      expect(() => runtime.beginAnalysisRegion(next)).toThrow('FAKE_INFERENCE_FAILURE');
      await expect(runtime.drain()).rejects.toThrow('FAKE_INFERENCE_FAILURE');
    } else {
      await runtime.drain(); await runtime.drain();
      expect(started).toEqual([0,1]); expect(delivered).toEqual([0,1]); expect(failures).toEqual([]);
    }
  } finally { release(); await runtime.dispose(); }
});
