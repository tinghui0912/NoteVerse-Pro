import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { ContinuousCaptureBridge } from './capture-bridge';
import { ContinuousAcousticProjection } from './continuous-projection';
import type { AcousticInferenceInput } from '../runtime/inference-types';
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
  expect(boundaries.every(b => b.sourceSampleIndex % 2048 !== 0)).toBe(true);
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
    const bridge = new ContinuousCaptureBridge(runtime, rate);
    try {
      for (const boundary of boundaries) bridge.schedule(boundary);
      let sequence = 0;
      for (let next = 0; next < pcm.length; next += blockSize) {
        const sourceEnd = Math.min(pcm.length, next + blockSize);
        bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: rate,
          sourceStartSampleIndex: next, sourceEndSampleIndex: sourceEnd, audioContextStartFrame: next,
          captureTimeSeconds: next / rate, inputChannelCount: 1, samples: pcm.subarray(next, sourceEnd) });
        await runtime.drain();
      }
      await runtime.seal();
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
  expect(await run(2048)).toEqual(await run(128));
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
