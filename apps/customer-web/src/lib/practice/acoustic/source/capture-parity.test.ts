import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { CaptureChunk } from './capture-types';
import { ContinuousCaptureBridge } from '../continuous/capture-bridge';
import { ContinuousAcousticProjection } from '../continuous/continuous-projection';
import type { AcousticInferenceInput } from '../runtime/inference-types';
import type { ContinuousEvidencePublication } from '../../local-core/continuous-evaluation-types';

const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function packets(script: string, pcm: Float32Array, rate: number): Promise<CaptureChunk[]> {
  const chunks: CaptureChunk[] = []; let worklet: { process(i: Float32Array[][], o: Float32Array[][]): boolean; port: { onmessage(e: unknown): void } };
  const scope: Record<string, unknown> = { sampleRate: rate, currentFrame: 0, currentTime: 0, Float32Array,
    AudioWorkletProcessor: class { port = { postMessage: (message: CaptureChunk) => { if (message.type !== 'pcm-chunk') throw Error(JSON.stringify(message)); chunks.push(message); } }; },
    registerProcessor: (_: string, Ctor: new () => typeof worklet) => { worklet = new Ctor(); } };
  vm.runInNewContext(script, scope);
  for (let next = 0; next < pcm.length; next += 128) {
    scope.currentFrame = 8192 + next; scope.currentTime = (8192 + next) / rate;
    expect(worklet!.process([[pcm.subarray(next, next + 128)]], [])).toBe(true);
    const last = chunks.at(-1); if (last && last.sourceEndSampleIndex === next + 128) worklet!.port.onmessage({ data: { type: 'ACK', sequence: last.sequence } });
  }
  return chunks;
}
for (const rate of [44100, 48000]) it(`${rate}: frozen real PCM, all model-input SHA256 and inner-block boundaries are exact`, async () => {
  const root = path.resolve('../..');
  const corpus = JSON.parse(await readFile(path.join(root, 'backend/data/work/product_completion_replay/v1/audio_only/manifest.json'), 'utf8'));
  const bytes = await readFile(path.join(root, corpus.clips[0].pcm[rate].path));
  const archived = await readFile(path.join(root, 'backend/research/history/capture-transport-128-quantum/capture.worklet.js'));
  const provenance = JSON.parse(await readFile(path.join(root, 'backend/research/history/capture-transport-128-quantum/manifest.json'), 'utf8'));
  expect(hash(archived)).toBe(provenance.sha256); expect(archived.length).toBe(provenance.bytes);
  expect(createHash('sha1').update(`blob ${archived.length}\0`).update(archived).digest('hex')).toBe(provenance.gitBlob);
  const pcm = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + Math.floor(bytes.length / 8192) * 8192));
  const before = await packets(archived.toString('utf8'), pcm, rate);
  const after = await packets(await readFile('src/lib/practice/acoustic/source/capture.worklet.js', 'utf8'), pcm, rate);
  const concatenated = (chunks: CaptureChunk[]) => { const values = new Float32Array(pcm.length); for (const c of chunks) values.set(c.samples, c.sourceStartSampleIndex); return new Uint8Array(values.buffer); };
  expect(concatenated(after)).toEqual(concatenated(before));
  expect(hash(concatenated(after))).toBe(hash(new Uint8Array(pcm.buffer)));
  expect(after.length * 16).toBe(before.length);
  const begin = Math.round(rate * 1.8) + 37, pause = begin + Math.round(rate * .6) + 5;
  const resume = pause + 37, end = resume + Math.round(rate * .6) + 7;
  const pauseT = (pause - begin) * 1000 / rate, endT = pauseT + (end - resume) * 1000 / rate;
  const boundaries = [{ type: 'BEGIN', sourceSampleIndex: begin, performanceTimeMs: 0 },
    { type: 'PAUSE', sourceSampleIndex: pause, performanceTimeMs: pauseT },
    { type: 'BEGIN', sourceSampleIndex: resume, performanceTimeMs: pauseT },
    { type: 'TERMINAL', sourceSampleIndex: end, performanceTimeMs: endT }] as const;
  expect(boundaries.every(b => b.sourceSampleIndex % 2048 !== 0)).toBe(true);
  async function run(chunks: CaptureChunk[]) {
    const inputs: { window: AcousticInferenceInput['window']; sha256: string }[] = [], publications: ContinuousEvidencePublication[] = [];
    const runtime = await ContinuousAcousticProjection.create({ sessionDomainId: 'parity', sourceDomainId: 'parity:source', sourceSampleRateHz: rate,
      coefficientBytes: await readFile(`public/model-assets/practice-acoustic/${rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`),
      nowAvailabilityMs: () => 1e7, onPublication: p => { publications.push(p); },
      worker: { run: async input => { inputs.push({ window: input.window, sha256: hash(new Uint8Array(input.pcm.buffer)) });
        return { events: [], actualSessionRunCount: inputs.length, inferenceMs: 0, decodeMs: 0 }; }, dispose: async () => {} } });
    const bridge = new ContinuousCaptureBridge(runtime, rate);
    for (const boundary of boundaries) bridge.schedule(boundary);
    for (const chunk of chunks) { bridge.receive(chunk); await runtime.drain(); }
    await runtime.seal(); const snapshot = bridge.snapshot(); await runtime.dispose();
    expect(snapshot.nextSourceSampleIndex).toBe(pcm.length);
    expect(snapshot.boundaryDiagnostics.filter(b => b.action === 'APPLIED').map(b => b.sourceSampleIndex)).toEqual(boundaries.map(b => b.sourceSampleIndex));
    return { inputs, publications, boundaries: snapshot.boundaryDiagnostics.filter(b => b.action === 'APPLIED').map(b => ({ type: b.type, source: b.sourceSampleIndex, appliedAt: b.nextSourceAtAction })) };
  }
  const prior = await run(before), current = await run(after);
  expect(current).toEqual(prior); expect(current.inputs.length).toBeGreaterThanOrEqual(2);
  expect(current.publications.at(-1)?.analyzedThroughPerformanceMs).toBe(endT);
  if (process.env.CAPTURE_PARITY_RECEIPTS) await writeFile(path.join(process.env.CAPTURE_PARITY_RECEIPTS, `parity-${rate}.json`), JSON.stringify({
    rate, sourceSamples: pcm.length, sourceSha256: hash(concatenated(after)), priorChunks: before.length, currentChunks: after.length,
    samePcm: true, sameModelInputs: true, samePublicationSemantics: true, ...current }, null, 2) + '\n', { flag: 'wx' });
}, 30000);
