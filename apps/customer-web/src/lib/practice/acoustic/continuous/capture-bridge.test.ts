import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { ContinuousCaptureBridge, type AcousticBoundary } from './capture-bridge';
import { ContinuousAcousticProjection } from './continuous-projection';
import type { AcousticInferenceInput } from '../runtime/inference-types';
import { CAPTURE_TRANSPORT_BLOCK_SAMPLES } from '../source/capture-transport-contract';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';

for (const rate of [44100, 48000]) it(`${rate}: capture partitioning preserves PCM inputs, source mapping and pause/resume boundaries`, async () => {
  const pcm = Float32Array.from({ length: rate * 4 }, (_, i) => ((i * 17) % 1024 - 512) / 2048);
  const begin = Math.round(rate * 1.8) + 37, pause = begin + Math.round(rate * .6) + 5;
  const resume = pause + 37, end = resume + Math.round(rate * .6) + 7;
  const pauseTime = (pause - begin) * 1000 / rate, endTime = pauseTime + (end - resume) * 1000 / rate;
  const boundaries = [
    { type: 'BEGIN', sourceSampleIndex: begin, performanceTimeMs: 0 },
    { type: 'PAUSE', sourceSampleIndex: pause, performanceTimeMs: pauseTime },
    { type: 'BEGIN', sourceSampleIndex: resume, performanceTimeMs: pauseTime },
    { type: 'TERMINAL', sourceSampleIndex: end, performanceTimeMs: endTime },
  ] as const;
  expect(boundaries.every(b => b.sourceSampleIndex % CAPTURE_TRANSPORT_BLOCK_SAMPLES !== 0)).toBe(true);
  async function run(blockSize: number) {
    const inputs: { window: AcousticInferenceInput['window']; sha256: string }[] = [];
    const publications: ContinuousEvidencePublication[] = [];
    const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: 'session', sourceDomainId: 'capture',
      sourceSampleRateHz: rate, nowAvailabilityRuntimeMs: () => 100000,
      coefficientBytes: await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
      onPublication: publication => { publications.push(publication); },
      worker: { run: async input => {
        inputs.push({ window: input.window, sha256: createHash('sha256').update(new Uint8Array(input.pcm.buffer)).digest('hex') });
        return { events: [{ midiPitch: 60, pitch: 'C4', targetSample: Math.ceil(input.window.ownedStartTarget),
          confidence: .4, onsetScore: .6, frameScore: .4 }], actualSessionRunCount: inputs.length, inferenceMs: 0, decodeMs: 0 };
      }, dispose: async () => {} } });
    const bridge = new ContinuousCaptureBridge(runtime, rate), append = vi.spyOn(runtime, 'append');
    let splitTransportBlock = false;
    try {
      for (const boundary of boundaries) bridge.schedule(boundary);
      let sequence = 0;
      for (let next = 0; next < pcm.length; next += blockSize) {
        const sourceEnd = Math.min(pcm.length, next + blockSize);
        const before = append.mock.calls.length, samples = pcm.subarray(next, sourceEnd);
        bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: rate,
          sourceStartSampleIndex: next, sourceEndSampleIndex: sourceEnd, audioContextStartFrame: next,
          captureTimeSeconds: next / rate, inputChannelCount: 1, samples });
        const parts = append.mock.calls.slice(before).map(([block]) => block);
        if (blockSize === CAPTURE_TRANSPORT_BLOCK_SAMPLES && parts.length > 1) splitTransportBlock = true;
        let cursor = next;
        for (const part of parts) {
          expect(part.samples.length).toBeGreaterThan(0); expect(part.samples.length).toBeLessThanOrEqual(CAPTURE_TRANSPORT_BLOCK_SAMPLES);
          expect(part.sourceStartSampleIndex).toBe(cursor); expect(part.sourceEndSampleIndex).toBe(cursor + part.samples.length);
          expect(part.samples.buffer).toBe(samples.buffer); expect(part.samples.byteOffset).toBe(cursor * Float32Array.BYTES_PER_ELEMENT);
          cursor = part.sourceEndSampleIndex;
        }
        expect(cursor).toBe(sourceEnd);
        await runtime.drain();
      }
      await runtime.seal();
      if (blockSize === CAPTURE_TRANSPORT_BLOCK_SAMPLES) expect(splitTransportBlock).toBe(true);
      const snapshot = bridge.snapshot();
      expect(snapshot.nextSourceSampleIndex).toBe(pcm.length);
      expect(snapshot.boundaryDiagnostics.filter(b => b.action === 'APPLIED').map(b => b.sourceSampleIndex)).toEqual(boundaries.map(b => b.sourceSampleIndex));
      expect(inputs.length).toBeGreaterThanOrEqual(2);
      expect(inputs.every(input => input.window.endSample - input.window.startSample === 29120)).toBe(true);
      expect(publications.at(-1)).toMatchObject({ analyzedThroughPerformanceMs: endTime, observations: [] });
      const events = publications.flatMap(p => p.observations);
      expect(events[0].provenance?.sourceEventSample).toBeGreaterThanOrEqual(begin);
      expect(events[0].provenance!.sourceEventSample - begin).toBeLessThan(rate / 16000);
      expect(events.every(e => e.provenance?.sourceSampleRateHz === rate)).toBe(true);
      return { inputs, publications };
    } finally { await runtime.dispose(); }
  }
  expect(await run(CAPTURE_TRANSPORT_BLOCK_SAMPLES)).toEqual(await run(128));
});


it('R03 two positive short BEGIN/PAUSE intervals retain distinct source→performance mapping, not redundant control noise', async () => {
  const publications: ContinuousEvidencePublication[] = [];
  const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: 'short', sourceDomainId: 'short-source',
    sourceSampleRateHz: 48000, coefficientBytes: await readFile('public/model-assets/practice-acoustic/fir-1-3.f32'),
    nowAvailabilityRuntimeMs: () => 10000, onPublication: p => { publications.push(p); },
    worker: { run: async ({ window }) => ({ events: [{ targetSample: window.ownedStartTarget,
      midiPitch: 60, pitch: 'C4', confidence: .8, onsetScore: .8, frameScore: .8 }],
      inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 }), dispose: async () => {} } });
  const bridge = new ContinuousCaptureBridge(runtime, 48000);
  try {
    bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96000, performanceTimeMs: 0 });
    bridge.schedule({ type: 'PAUSE', sourceSampleIndex: 96480, performanceTimeMs: 10 });
    bridge.schedule({ type: 'BEGIN', sourceSampleIndex: 96960, performanceTimeMs: 10 });
    bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: 97440, performanceTimeMs: 20 });
    let next = 0, sequence = 0;
    while (next < 110592) { const start = next; next += 2048;
      bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: 48000,
        sourceStartSampleIndex: start, sourceEndSampleIndex: next, audioContextStartFrame: start,
        captureTimeSeconds: start / 48000, inputChannelCount: 1, samples: new Float32Array(2048) });
      await runtime.drain();
    }
    await runtime.seal();
    const observations = publications.flatMap(p => p.observations);
    expect(observations.map(o => [o.performanceTimeMs, o.provenance!.sourceEventSample])).toEqual([[0, 96000], [10, 96960]]);
    expect(new Set(observations.map(o => o.observationId)).size).toBe(2);
    expect(publications.at(-1)).toMatchObject({ analyzedThroughPerformanceMs: 20, observations: [] });
    expect(bridge.snapshot()).toMatchObject({ failed: false, pendingBoundaryCount: 0 });
    expect(runtime.snapshot()).toMatchObject({ outstanding: 0, pendingRegions: 0, counts: { regionsStarted: 2 } });
  } finally { await runtime.dispose(); }
});

it('local readiness observers see committed receive/schedule/abort state and cannot corrupt it by throwing', async () => {
  const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: 'observer', sourceDomainId: 'observer-source',
    sourceSampleRateHz: 48000, coefficientBytes: await readFile('public/model-assets/practice-acoustic/fir-1-3.f32'),
    nowAvailabilityRuntimeMs: () => 10000, onPublication: () => {},
    worker: { run: async () => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 }), dispose: async () => {} } });
  const bridge = new ContinuousCaptureBridge(runtime, 48000), observed: ReturnType<typeof bridge.snapshot>[] = [];
  const throwing = bridge.subscribeReadiness(() => { throw new Error('OBSERVER_FAILURE'); });
  const listener = vi.fn(() => observed.push(bridge.snapshot())), detach = bridge.subscribeReadiness(listener);
  try {
    const chunk = (start: number, end: number, sequence: number) => ({ type: 'pcm-chunk' as const, sequence, sourceSampleRateHz: 48000,
      sourceStartSampleIndex: start, sourceEndSampleIndex: end, audioContextStartFrame: start,
      captureTimeSeconds: start / 48000, inputChannelCount: 1, samples: new Float32Array(end - start) });
    for (let start = 0, sequence = 0; start < 88064; start += 2048, sequence++) bridge.receive(chunk(start, Math.min(start + 2048, 88064), sequence));
    expect(observed.at(-1)).toMatchObject({ nextSourceSampleIndex: 88064, failed: false }); expect(runtime.prerollReady).toBe(true);
    const before = listener.mock.calls.length;
    bridge.schedule({ type: 'TERMINAL', sourceSampleIndex: 88064, performanceTimeMs: 0 });
    expect(listener).toHaveBeenCalledTimes(before + 1); expect(observed.at(-1)?.pendingBoundaryCount).toBe(0);
    expect(observed.at(-1)?.boundaryDiagnostics.at(-1)).toMatchObject({ action: 'APPLIED', type: 'TERMINAL' });
    expect(runtime.tailReady).toBe(true);
    bridge.abort(new Error('CAPTURE_TEST_FAILURE')); expect(observed.at(-1)).toMatchObject({ failed: true, pendingBoundaryCount: 0 });
    expect(runtime.snapshot().failureCode).toBe('CAPTURE_TEST_FAILURE');
    throwing(); detach(); const count = listener.mock.calls.length; bridge.abort(new Error('LATE_FAILURE'));
    expect(listener).toHaveBeenCalledTimes(count); expect(runtime.snapshot().failureCode).toBe('CAPTURE_TEST_FAILURE');
  } finally { throwing(); detach(); await runtime.dispose(); }
});

it('R03 positive breakpoints carry observable information: deletion and envelope coalescing are not lossless', async () => {
  const rate = 48000, startA = 96000, endA = 96480, startB = 96960, endB = 97440;
  expect(endA - startA).toBeGreaterThan(0); expect(endB - startB).toBeGreaterThan(0); expect(startB - endA).toBeGreaterThan(0);
  const physicalEvents = [
    { targetSample: startA / 3, midiPitch: 60, pitch: 'C4' },
    { targetSample: 96720 / 3, midiPitch: 64, pitch: 'E4' }, // Event physically inside the paused gap.
    { targetSample: startB / 3, midiPitch: 62, pitch: 'D4' },
  ];
  async function replay(kind: 'original' | 'omitA' | 'omitB' | 'envelope20' | 'envelope30') {
    const publications: ContinuousEvidencePublication[] = [], windows: AcousticInferenceInput['window'][] = [];
    const worker = { run: vi.fn(async ({ window }: AcousticInferenceInput) => {
      windows.push(window); return { events: physicalEvents.map(event => ({ ...event, confidence: .8, onsetScore: .8, frameScore: .8 })),
        inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 };
    }), dispose: vi.fn(async () => {}) };
    const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: 'breakpoints', sourceDomainId: 'breakpoint-source',
      sourceSampleRateHz: rate, coefficientBytes: await readFile('public/model-assets/practice-acoustic/fir-1-3.f32'), worker,
      nowAvailabilityRuntimeMs: () => 10000, onPublication: publication => { publications.push(publication); } });
    const bridge = new ContinuousCaptureBridge(runtime, rate);
    const boundaries: AcousticBoundary[] = kind === 'original' ? [
      { type: 'BEGIN', sourceSampleIndex: startA, performanceTimeMs: 0 },
      { type: 'PAUSE', sourceSampleIndex: endA, performanceTimeMs: 10 },
      { type: 'BEGIN', sourceSampleIndex: startB, performanceTimeMs: 10 },
      { type: 'TERMINAL', sourceSampleIndex: endB, performanceTimeMs: 20 },
    ] : kind === 'omitB' ? [
      { type: 'BEGIN', sourceSampleIndex: startA, performanceTimeMs: 0 },
      { type: 'TERMINAL', sourceSampleIndex: endA, performanceTimeMs: 10 },
    ] : [
      { type: 'BEGIN', sourceSampleIndex: kind === 'omitA' ? startB : startA, performanceTimeMs: 0 },
      { type: 'TERMINAL', sourceSampleIndex: endB, performanceTimeMs: kind === 'omitA' ? 10 : kind === 'envelope20' ? 20 : 30 },
    ];
    try {
      boundaries.forEach(boundary => bridge.schedule(boundary));
      const feed = async () => {
        for (let next = 0, sequence = 0; next < 110592; next += 2048, sequence++) {
          bridge.receive({ type: 'pcm-chunk', sequence, sourceSampleRateHz: rate, sourceStartSampleIndex: next,
            sourceEndSampleIndex: next + 2048, audioContextStartFrame: next, captureTimeSeconds: next / rate,
            inputChannelCount: 1, samples: Float32Array.from({ length: 2048 }, (_, index) => ((next + index) % 31) / 64) });
          await runtime.drain();
        }
      };
      if (kind === 'envelope20') {
        // Without the pause gap breakpoint, 1440 source samples mean30ms, not the original20ms.
        await expect(feed()).rejects.toThrow('ACOUSTIC_SEGMENT_END_MISMATCH');
        expect(bridge.snapshot()).toMatchObject({ failed: true, pendingBoundaryCount: 0 });
        expect(runtime.snapshot().failureCode).toBe('ACOUSTIC_SEGMENT_END_MISMATCH');
        expect(worker.run).not.toHaveBeenCalled(); expect(publications).toEqual([]); return null;
      }
      await feed(); await runtime.seal();
      return { observations: publications.flatMap(publication => publication.observations), publications, windows };
    } finally { await runtime.dispose(); }
  }
  const original = (await replay('original'))!;
  expect(original.windows.map(window => [window.regionIndex, window.windowIndex])).toEqual([[0, 0], [1, 0]]);
  expect(original.observations.map(event => [event.pianoKey, event.performanceTimeMs, event.provenance!.sourceEventSample]))
    .toEqual([[60, 0, startA], [62, 10, startB]]);
  expect(original.observations.map(event => event.observationId)).toEqual([
    'breakpoint-source:s0:w0:p60:f32000', 'breakpoint-source:s1:w0:p62:f32320',
  ]);
  expect(original.publications.at(-1)).toMatchObject({ analyzedThroughPerformanceMs: 20, observations: [] });
  const omitA = (await replay('omitA'))!, omitB = (await replay('omitB'))!;
  // Even after making the remaining envelope internally valid, removing either interval loses legal evidence.
  expect(omitA.observations.map(event => event.pianoKey)).toEqual([62]);
  expect(omitB.observations.map(event => event.pianoKey)).toEqual([60]);
  expect(omitA.observations[0].performanceTimeMs).toBe(0); // B also moves from10ms to0ms.
  await replay('envelope20');
  const envelope = (await replay('envelope30'))!;
  expect(envelope.observations.map(event => [event.pianoKey, event.performanceTimeMs])).toEqual([[60, 0], [64, 15], [62, 20]]);
  expect(envelope.publications.at(-1)?.analyzedThroughPerformanceMs).toBe(30);
  // Accepting the gap as active can satisfy geometry only by changing the original observable topology.
});
