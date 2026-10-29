import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { SourceAnalysisRuntime } from './source-analysis-runtime';
import { AcousticPcmRing, planWindow } from './window-planner';
import { ACOUSTIC_MODEL as M, sourceIdentity } from '../model/model-contract';
import { ACOUSTIC_RESOURCES as R } from './resource-policy';
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

it.each([44100, 48000] as const)('%i: empty first analysis region produces no publication; next region starts job zero', async rate => {
  const publications: SourceAcousticPublication[] = [];
  const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'empty-first', sourceSampleRateHz: rate,
    coefficientBytes: await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
    nowAvailabilityRuntimeMs: () => 10000, onPublication: p => { publications.push(p); }, worker: {
      run: async ({ window }) => ({ events: [{ pitch: 'C4', midiPitch: 60, confidence: .8, onsetScore: .8, frameScore: .8,
        targetSample: Math.ceil(window.ownedStartTarget) }], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 }), dispose: async () => {} } });
  let next = 0;
  const feed = async (end: number) => { end = Math.round(end); while (next < end) { const stop = Math.min(end, next + 128);
    runtime.append({ sourceSampleRateHz: rate, sourceStartSampleIndex: next, sourceEndSampleIndex: stop, samples: new Float32Array(stop - next) }); next = stop; await runtime.drain(); } };
  try {
    await feed(rate * 2); expect(runtime.prerollReady).toBe(true);
    expect(runtime.beginAnalysisRegion(next)).toBe(0); runtime.endAnalysisRegion(next); await runtime.drain();
    expect(runtime.snapshot()).toMatchObject({ state: 'IDLE', pendingRegions: 0,
      counts: { regionsStarted: 1, regionsDrained: 1, windowsQueued: 0, windowsPublished: 0 } });
    expect(publications).toEqual([]);
    expect(runtime.beginAnalysisRegion(next)).toBe(1);
    await feed(rate * 2.6); runtime.finishRegions(); await feed(rate * 2.8); await runtime.seal();
    expect(publications).toHaveLength(1);
    expect(publications[0].window).toMatchObject({ jobIndex: 0, regionIndex: 1, windowIndex: 0 });
    expect(publications[0].observations[0].sourceEventSample).toBeGreaterThanOrEqual(rate * 2);
    expect(runtime.snapshot()).toMatchObject({ state: 'SEALED', failureCode: null, counts: { windowsPublished: 1, regionsDrained: 2 } });
  } finally { await runtime.dispose(); }
});

it('productive, empty, productive regions publish continuous jobs with visible region 0 to 2', async () => {
  const publications: SourceAcousticPublication[] = [];
  const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'empty-middle', sourceSampleRateHz: 48000,
    coefficientBytes: await readFile('public/model-assets/practice-acoustic/fir-1-3.f32'),
    nowAvailabilityRuntimeMs: () => 10000, onPublication: p => { publications.push(p); }, worker: {
      run: async ({ window }) => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 }), dispose: async () => {} } });
  let next = 0;
  const feed = async (end: number) => { while (next < end) { const stop = Math.min(end, next + 128);
    runtime.append({ sourceSampleRateHz: 48000, sourceStartSampleIndex: next, sourceEndSampleIndex: stop, samples: new Float32Array(stop - next) }); next = stop; await runtime.drain(); } };
  try {
    await feed(96000); expect(runtime.beginAnalysisRegion(next)).toBe(0);
    await feed(124800); runtime.endAnalysisRegion(next); await feed(144000);
    expect(publications).toHaveLength(1);
    expect(runtime.beginAnalysisRegion(next)).toBe(1); runtime.endAnalysisRegion(next); await runtime.drain();
    expect(publications).toHaveLength(1);
    expect(runtime.snapshot().counts.regionsDrained).toBe(2);
    expect(runtime.beginAnalysisRegion(next)).toBe(2); await feed(172800); runtime.finishRegions(); await feed(182400); await runtime.seal();
    expect(publications.map(p => [p.window.jobIndex, p.window.regionIndex, p.window.windowIndex])).toEqual([[0,0,0],[1,2,0]]);
    expect(publications[1].window.ownedStartTarget).toBeGreaterThan(publications[0].window.ownedEndTarget);
    expect(runtime.snapshot()).toMatchObject({ state: 'SEALED', failureCode: null, counts: { windowsPublished: 2, regionsDrained: 3 } });
  } finally { await runtime.dispose(); }
});


// Real source runtime/adapter/PCM chronology; the only deferred component is inference.
async function resourceRig() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const publications: SourceAcousticPublication[] = [], failures: Error[] = [];
  const worker = { run: vi.fn(async ({ window }: AcousticInferenceInput) => {
    await gate; return { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 };
  }), dispose: vi.fn(async () => {}) };
  const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'resource-source', sourceSampleRateHz: 48000,
    coefficientBytes: await readFile('public/model-assets/practice-acoustic/fir-1-3.f32'), worker,
    nowAvailabilityRuntimeMs: () => 0, onPublication: p => { publications.push(p); }, onFailure: e => { failures.push(e); } });
  let next = 0;
  const feed = (end: number) => { while (next < end) {
    const start = next; next = Math.min(end, start + 2048);
    runtime.append({ sourceSampleRateHz: 48000, sourceStartSampleIndex: start,
      sourceEndSampleIndex: next, samples: new Float32Array(next - start) });
  } };
  feed(96000);
  return { runtime, worker, publications, failures, release, feed, next: () => next };
}

it('R01 valid source reaches four copied queued/active inputs; fifth fails before ring extraction/copy', async () => {
  const r = await resourceRig(), extract = vi.spyOn(AcousticPcmRing.prototype, 'extract');
  try {
    expect(R.maxOutstandingWindows).toBe(4);
    r.runtime.beginAnalysisRegion(r.next()); r.feed(219392); await Promise.resolve();
    const snapshot = r.runtime.snapshot();
    expect(snapshot).toMatchObject({ state: 'RUNNING', outstanding: 4,
      counts: { windowsQueued: 4, windowsStarted: 1, windowsPublished: 0 },
      resources: { outstandingInputBytes: snapshot.outstanding * R.inputBytes,
        maximumOutstandingInputBytes: R.maxOutstandingWindows * R.inputBytes } });
    expect(snapshot.outstanding).toBe(R.maxOutstandingWindows);
    expect(snapshot.resources.outstandingInputBytes).toBe(snapshot.resources.maximumOutstandingInputBytes);
    expect(snapshot.resources.maximumOutstandingInputBytes).toBe(465920); // Secondary characterization, not another policy owner.
    expect(r.worker.run).toHaveBeenCalledOnce(); expect(extract).toHaveBeenCalledTimes(4);
    const firstInput = r.worker.run.mock.calls[0][0]; expect(firstInput.pcm).toHaveLength(29120);
    expect(() => r.feed(248320)).toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
    expect(extract).toHaveBeenCalledTimes(4); // Not even a fifth Float32Array extraction.
    expect(r.runtime.snapshot()).toMatchObject({ state: 'FAILED', outstanding: 4, pendingRegions: 0,
      nextSourceSampleIndex: r.next(), counts: { windowsQueued: 4, backpressureFailures: 1 } });
    expect(r.next()).toBeGreaterThan(219392); // Chronological source PCM was accepted before planning failed.
    expect(r.failures).toHaveLength(1); expect(r.publications).toEqual([]);
    let disposed = false; const disposal = r.runtime.dispose().then(() => { disposed = true; });
    await Promise.resolve(); expect(disposed).toBe(false); expect(r.worker.dispose).toHaveBeenCalledOnce();
    r.release(); await disposal;
    expect(r.runtime.snapshot()).toMatchObject({ state: 'DISPOSED', outstanding: 0 });
    expect(r.worker.run).toHaveBeenCalledOnce(); expect(r.publications).toEqual([]); // Late result and queued jobs fenced.
  } finally { r.release(); await r.runtime.dispose(); extract.mockRestore(); }
});

for (const rate of [44100, 48000] as const) {
  it(`${rate}: R02 blocked positive head cannot retain arbitrarily many zero-duration followers`, async () => {
    const publications: SourceAcousticPublication[] = [], failure = vi.fn(), worker = { run: vi.fn(async ({ window }: AcousticInferenceInput) => ({
      events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 })), dispose: vi.fn(async () => {}) };
    const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'zero-followers', sourceSampleRateHz: rate,
      coefficientBytes: await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`), worker,
      nowAvailabilityRuntimeMs: () => 0, onPublication: p => { publications.push(p); }, onFailure: failure });
    let next = 0;
    const feed = (end: number) => { while (next < end) { const start = next; next = Math.min(end, next + R.maxSourceBlockSamples);
      runtime.append({ sourceSampleRateHz: rate, sourceStartSampleIndex: start, sourceEndSampleIndex: next, samples: new Float32Array(next - start) }); } };
    try {
      feed(rate * 2); expect(runtime.prerollReady).toBe(true);
      const first = runtime.beginAnalysisRegion(next); feed(next + 128); runtime.endAnalysisRegion(next);
      expect(runtime.snapshot()).toMatchObject({ pendingRegions: 1, outstanding: 0, counts: { windowsQueued: 0 } });
      const source = next, indices = [first];
      for (let i = 0; i < 128; i++) { // Test witness, not a retained-state policy.
        const region = runtime.beginAnalysisRegion(next); indices.push(region); runtime.endAnalysisRegion(next);
        expect(runtime.hasRegionWork(region)).toBe(false); expect(runtime.hasRegionWork(first)).toBe(true);
        expect(runtime.snapshot()).toMatchObject({ state: 'IDLE', pendingRegions: 1, outstanding: 0, nextSourceSampleIndex: source,
          counts: { regionsStarted: i + 2, regionsDrained: i + 1, windowsQueued: 0 } });
      }
      expect(indices).toEqual(Array.from({ length: 129 }, (_, index) => index));
      expect(worker.run).not.toHaveBeenCalled(); expect(publications).toEqual([]); expect(failure).not.toHaveBeenCalled();
      runtime.finishRegions(); feed(source + Math.ceil(M.futureMs * rate / 1000) + sourceIdentity(rate).identity.realSourceLookaheadSamples + 3);
      await runtime.seal();
      expect(publications.map(p => [p.window.jobIndex, p.window.regionIndex, p.window.windowIndex])).toEqual([[0, first, 0]]);
      expect(worker.run).toHaveBeenCalledOnce(); expect(runtime.snapshot()).toMatchObject({ pendingRegions: 0, outstanding: 0,
        counts: { regionsStarted: 129, regionsDrained: 129, windowsQueued: 1, windowsPublished: 1 } });
    } finally { await runtime.dispose(); }
  });

  it(`${rate}: R02 retains64 distinct positive regions beyond old cap and plans every real window without loss`, async () => {
    const publications: SourceAcousticPublication[] = [], failure = vi.fn(), inputs: AcousticInferenceInput[] = [];
    const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'positive-regions', sourceSampleRateHz: rate,
      coefficientBytes: await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
      nowAvailabilityRuntimeMs: () => 10000, onPublication: p => { publications.push(p); }, onFailure: failure, worker: {
        run: async input => { inputs.push(input); return { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: input.window.jobIndex + 1 }; }, dispose: async () => {} } });
    let next = 0, extractedWithRetention = false;
    const extract = AcousticPcmRing.prototype.extract;
    const checked = vi.spyOn(AcousticPcmRing.prototype, 'extract').mockImplementation(function (this: AcousticPcmRing, start, end) {
      expect(start).toBeGreaterThanOrEqual(this.firstRetained); expect(end - start).toBe(M.inputSamples);
      extractedWithRetention ||= this.firstRetained > 0; return extract.call(this, start, end);
    });
    const feed = (end: number) => { while (next < end) { const start = next; next = Math.min(end, next + R.maxSourceBlockSamples);
      runtime.append({ sourceSampleRateHz: rate, sourceStartSampleIndex: start, sourceEndSampleIndex: next, samples: new Float32Array(next - start) }); } };
    const regions: number[] = [];
    try {
      feed(rate * 8); expect(runtime.prerollReady).toBe(true); // Ring has already wrapped; not only an origin fixture.
      for (let i = 0; i < 64; i++) {
        const start = next; regions.push(runtime.beginAnalysisRegion(start)); feed(start + 3); runtime.endAnalysisRegion(next);
        expect(next).toBeGreaterThan(start); feed(next + 3); // Positive gaps preserve the existing exact publication-order contract at fractional phases.
        expect(runtime.snapshot().pendingRegions).toBe(i + 1);
      }
      expect(regions).toEqual(Array.from({ length: 64 }, (_, index) => index));
      expect(inputs).toEqual([]); expect(publications).toEqual([]); expect(failure).not.toHaveBeenCalled();
      runtime.finishRegions(); const horizon = rate === 44100 ? 7531 : 8196; // Derived Float64-safe proof bound, test only.
      const lastEnd = next;
      while (next < lastEnd + horizon) { feed(next + 1); await runtime.drain(); } // Prompt service avoids conflating R02 with R01.
      await runtime.seal();
      expect(publications.map(p => p.window.regionIndex)).toEqual(regions);
      expect(new Set(publications.map(p => `${p.window.regionIndex}:${p.window.windowIndex}`)).size).toBe(64);
      expect(publications.map(p => p.window.jobIndex)).toEqual(regions); expect(inputs).toHaveLength(64); expect(extractedWithRetention).toBe(true);
      expect(runtime.snapshot()).toMatchObject({ state: 'SEALED', failureCode: null, pendingRegions: 0, outstanding: 0,
        counts: { regionsStarted: 64, regionsDrained: 64, windowsQueued: 64, windowsPublished: 64 } });
      expect(failure).not.toHaveBeenCalled();
    } finally { checked.mockRestore(); await runtime.dispose(); }
  });
}

it('R02 source-discrete future horizon and retained-input bounds follow shipped adapter equations, not a replacement cap', () => {
  for (const rate of [44100, 48000] as const) {
    const identity = sourceIdentity(rate).identity, { up, down, tapCount } = identity, center = (tapCount - 1) / 2;
    expect(Math.ceil(center / up)).toBe(identity.realSourceLookaheadSamples);
    const future = M.futureMs * M.sampleRateHz / 1000, lengths: number[] = [];
    // All rational source phases; translating by down adds exactly up target samples in exact arithmetic.
    for (let phase = 0; phase < down; phase++) {
      const end = Math.round(phase * up / down + future);
      const received = Math.floor(((end - 1) * down + center) / up) + 1;
      lengths.push(received - phase);
    }
    expect(Math.max(...lengths)).toBe(rate === 44100 ? 7524 : 8189);
    // Float64 error bound derived in the R02 proof: two source→target terms, sum, future-add and round.
    const geometryError = 16384 / rate + 1.5;
    const emissionError = rate === 44100 ? 256 / up + 1 : 2;
    const horizon = Math.ceil((future + geometryError - 1) * down / up + center / up + emissionError + 1);
    expect(horizon).toBe(rate === 44100 ? 7531 : 8196);
    const blockOutputs = Math.ceil((R.maxSourceBlockSamples + 2 * emissionError) * up / down) + 1;
    const fifoSkew = Math.ceil(2 * geometryError);
    expect([blockOutputs, fifoSkew]).toEqual([rate === 44100 ? 746 : 685, 4]);
    expect(M.inputSamples + blockOutputs + fifoSkew).toBeLessThan(R.targetRingSamples);
    // Numeric boundary probes supplement (not replace) the uniform Float64 inequalities.
    for (const endpoint of [rate * 8, 2 ** 32, 2 ** 48, Number.MAX_SAFE_INTEGER - horizon]) {
      for (const width of [1, 3, 128]) {
        const start = endpoint - width, originTarget = start * M.sampleRateHz / rate;
        const region = { index: 0, sourceStart: start, originTarget, nextWindow: 0, queuedEndTarget: originTarget,
          sourceEnd: endpoint, endTarget: originTarget + width * M.sampleRateHz / rate };
        const window = planWindow(region, 0)!;
        const received = Math.floor(((window.endSample - 1) * down + center) / up) + 1;
        expect(received - endpoint).toBeLessThanOrEqual(horizon);
      }
    }
  }
});

it('R02/R14 planned regions retire before inference; tailReady and pending drain/seal can coexist indefinitely without failure', async () => {
  const r = await resourceRig(); vi.useFakeTimers();
  try {
    const region = r.runtime.beginAnalysisRegion(r.next()); r.feed(r.next() + 128);
    r.runtime.endAnalysisRegion(r.next()); r.runtime.finishRegions();
    expect(r.runtime.tailReady).toBe(false); expect(r.runtime.snapshot().pendingRegions).toBe(1);
    r.feed(106240); await Promise.resolve();
    expect(r.runtime.tailReady).toBe(true);
    expect(r.runtime.snapshot()).toMatchObject({ state: 'DRAINING', pendingRegions: 0, outstanding: 1,
      counts: { regionsStarted: 1, regionsDrained: 1, windowsQueued: 1, windowsPublished: 0 } });
    expect(r.runtime.hasRegionWork(region)).toBe(true); // queuedRegions still owns the copied input.
    let drained = false, sealed = false;
    const drain = r.runtime.drain().then(() => { drained = true; });
    const seal = r.runtime.seal().then(() => { sealed = true; });
    await vi.advanceTimersByTimeAsync(120000);
    expect(drained).toBe(false); expect(sealed).toBe(false); expect(r.failures).toEqual([]);
    expect(r.runtime.snapshot().outstanding).toBe(1); expect(r.publications).toEqual([]);
    r.release(); await drain; await seal;
    expect(r.runtime.snapshot()).toMatchObject({ state: 'SEALED', outstanding: 0 });
    expect(r.runtime.hasRegionWork(region)).toBe(false); expect(r.publications).toHaveLength(1);
  } finally { r.release(); await r.runtime.dispose(); vi.useRealTimers(); }
});
