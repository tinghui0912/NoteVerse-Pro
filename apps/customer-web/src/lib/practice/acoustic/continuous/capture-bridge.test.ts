import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { ContinuousCaptureBridge } from './capture-bridge';
import { ContinuousAcousticProjection } from './continuous-projection';
import type { AcousticInferenceInput } from '../runtime/inference-types';
import type { ContinuousEvidencePublication } from '../../local-core/continuous-evaluation-types';

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
      sourceSampleRateHz: rate, nowAvailabilityMs: () => 100000,
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
