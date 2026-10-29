import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { CAPTURE_TRANSPORT_BLOCK_SAMPLES, CAPTURE_TRANSPORT_MAX_UNACKED } from './capture-transport-contract';
import type { CaptureChunk } from './capture-types';
import { SourceAnalysisRuntime } from '../runtime/source-analysis-runtime';

type Processor = { state: string; filled: number; originFrame: number | null; stabilizationRestarts: number;
  accumulator: Float32Array | null; process(input: Float32Array[][], output: Float32Array[][]): boolean;
  port: { onmessage(event: { data: unknown }): void; onmessageerror(): void } };
async function fixture(rate = 48000) {
  const sent: { message: CaptureChunk & { code?: string }; transfer?: Transferable[] }[] = [];
  const scope: Record<string, unknown> = { Float32Array, sampleRate: rate, currentFrame: 0, currentTime: 0,
    AudioWorkletProcessor: class { port = { postMessage: (message: CaptureChunk & { code?: string }, transfer?: Transferable[]) => sent.push({ message, transfer }) }; },
    registerProcessor: (_name: string, constructor: unknown) => { scope.Processor = constructor; } };
  const text = await readFile('src/lib/practice/acoustic/source/capture.worklet.js', 'utf8');
  vm.runInNewContext(text, scope);
  const processor = new (scope.Processor as new () => Processor)();
  const run = (frame: number, length: number, channels = 2) => {
    scope.currentFrame = frame; scope.currentTime = frame / rate;
    return processor.process([Array.from({ length: channels }, (_, c) => Float32Array.from({ length }, (_, i) => Math.fround((frame + i) % 211 / 211 + c * .1)))], []);
  };
  return { processor, sent, run, scope };
}
it.each([44100, 48000])('arbitrary legal quanta preserve every real averaged sample at %i', async rate => {
  const f = await fixture(rate); let frame = 7000, count = 0;
  for (const length of [17, 127, 2048, 3, 511, 1024, 366]) { expect(f.run(frame, length)).toBe(true); frame += length; count += length; }
  expect(count).toBe(4096); expect(f.sent).toHaveLength(2);
  for (let block = 0; block < 2; block++) {
    const { message, transfer } = f.sent[block];
    expect(message.samples).toHaveLength(CAPTURE_TRANSPORT_BLOCK_SAMPLES);
    expect(message.sourceStartSampleIndex).toBe(block * 2048); expect(message.sourceEndSampleIndex).toBe((block + 1) * 2048);
    expect(message.audioContextStartFrame).toBe(7000 + block * 2048);
    expect(message.captureTimeSeconds).toBe(message.audioContextStartFrame / rate);
    expect(transfer?.[0]).toBe(message.samples.buffer);
    for (let i = 0; i < 2048; i++) {
      const value = (7000 + block * 2048 + i) % 211 / 211;
      expect(message.samples[i]).toBe(Math.fround((Math.fround(value) + Math.fround(value + .1)) / 2));
    }
  }
  expect(f.processor.state).toBe('ACTIVE');
});
it('only unpublished provisional startup is retired on a frame discontinuity', async () => {
  const f = await fixture(); f.run(0, 128); f.run(1024, 128);
  expect(f.sent).toHaveLength(0); expect(f.processor.stabilizationRestarts).toBe(1);
  f.run(1152, 1920);
  expect(f.sent[0].message).toMatchObject({ sourceStartSampleIndex: 0, sourceEndSampleIndex: 2048, audioContextStartFrame: 1024 });
  expect(f.processor.originFrame).toBe(1024); expect(f.processor.state).toBe('ACTIVE');
  expect(f.run(3200, 128)).toBe(false);
  expect(f.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_FRAME_DISCONTINUITY');
  expect(f.processor.originFrame).toBe(1024); expect(f.processor.stabilizationRestarts).toBe(1);
});
it('standalone Worklet block/credit declarations match the authoritative transport contract', async () => {
  const text = await readFile('src/lib/practice/acoustic/source/capture.worklet.js', 'utf8');
  expect(CAPTURE_TRANSPORT_BLOCK_SAMPLES).toBe(2048);
  expect(Number(text.match(/const CAPTURE_TRANSPORT_BLOCK_SAMPLES = (\d+);/)?.[1])).toBe(CAPTURE_TRANSPORT_BLOCK_SAMPLES);
  expect(CAPTURE_TRANSPORT_MAX_UNACKED).toBe(32);
  expect(Number(text.match(/const CAPTURE_TRANSPORT_MAX_UNACKED = (\d+);/)?.[1])).toBe(CAPTURE_TRANSPORT_MAX_UNACKED);
});
it('32 unacked full blocks accepted; 33rd fails with no further accumulator allocation', async () => {
  const f = await fixture();
  for (let i = 0; i < CAPTURE_TRANSPORT_MAX_UNACKED; i++) expect(f.run(i * 2048, 2048)).toBe(true);
  expect(f.sent).toHaveLength(32); expect(f.processor.accumulator?.length).toBe(2048);
  expect(f.run(32 * 2048, 2048)).toBe(false); expect(f.sent).toHaveLength(33);
  expect(f.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED');
  expect(f.processor.accumulator).toBeNull(); expect(f.processor.state).toBe('FAILED');
});
it('one ordered ACK at full credit admits exactly one more block before overflow', async () => {
  const f = await fixture();
  for (let i = 0; i < 32; i++) expect(f.run(i * 2048, 2048)).toBe(true);
  f.processor.port.onmessage({ data: { type: 'ACK', sequence: 0 } });
  expect(f.run(32 * 2048, 2048)).toBe(true); expect(f.sent).toHaveLength(33);
  expect(f.sent.at(-1)?.message).toMatchObject({ type: 'pcm-chunk', sequence: 32 });
  expect(f.processor.state).toBe('ACTIVE');
  expect(f.run(33 * 2048, 2048)).toBe(false);
  expect(f.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED');
  expect(f.processor.state).toBe('FAILED'); expect(f.processor.accumulator).toBeNull();
});
it('ACK order is exact, and terminal states accept no new PCM', async () => {
  const f = await fixture();
  for (let i = 0; i < 100; i++) { f.run(i * 2048, 2048); f.processor.port.onmessage({ data: { type: 'ACK', sequence: i } }); }
  expect(f.sent).toHaveLength(100);
  f.processor.port.onmessage({ data: { type: 'ACK', sequence: 100 } });
  expect(f.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_ACK_ORDER_VIOLATION');
  expect(f.run(204800, 2048)).toBe(false); expect(f.sent).toHaveLength(101);
});
it.each([false, true])('intentional STOP discards real partial state without padding (ACTIVE=%s)', async active => {
  const f = await fixture(); if (active) f.run(0, 2048);
  f.run(active ? 2048 : 0, 127); const emitted = f.sent.length;
  f.processor.port.onmessage({ data: { type: 'STOP' } });
  expect(f.processor.state).toBe('STOPPED'); expect(f.processor.accumulator).toBeNull();
  expect(f.run(4096, 2048)).toBe(false); expect(f.sent).toHaveLength(emitted);
});
it('unsupported sample rate and port decode failure fail closed', async () => {
  const f = await fixture(32000); expect(f.run(0, 2048)).toBe(false);
  expect(f.sent.at(-1)?.message.code).toBe('ACOUSTIC_SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
  const valid = await fixture(); valid.processor.port.onmessageerror();
  expect(valid.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_MESSAGE_ERROR');
});
it('invalid geometry/nonfinite samples and post-ACTIVE input loss are fatal, never padded', async () => {
  const empty = await fixture(); empty.run(0, 2048);
  expect(empty.processor.process([], [])).toBe(false);
  expect(empty.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_INPUT_UNAVAILABLE');
  const bad = await fixture();
  expect(bad.processor.process([[new Float32Array(128), new Float32Array(127)]], [])).toBe(false);
  expect(bad.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_BLOCK_SIZE_VIOLATION');
  const nan = await fixture(); expect(nan.processor.process([[new Float32Array([NaN])]], [])).toBe(false);
  expect(nan.sent.at(-1)?.message.code).toBe('ACOUSTIC_CAPTURE_NONFINITE_PCM');
});


it('R04 ACKed valid transport can exceed 32 total blocks while worker stall independently reaches R01', async () => {
  const f = await fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const published: number[] = [], failures: Error[] = [];
  const runtime = await SourceAnalysisRuntime.create({ sourceDomainId: 'credits', sourceSampleRateHz: 48000,
    coefficientBytes: await readFile('public/model-assets/practice-acoustic/fir-1-3.f32'),
    nowAvailabilityRuntimeMs: () => 0, onPublication: p => { published.push(p.window.jobIndex); }, onFailure: e => { failures.push(e); },
    worker: { run: async ({ window }) => { await gate; return { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 }; }, dispose: async () => {} } });
  let block = 0;
  const accept = () => {
    expect(f.run(block * 2048, 2048)).toBe(true);
    const m = f.sent.at(-1)!.message; block++;
    runtime.append({ sourceSampleRateHz: m.sourceSampleRateHz, sourceStartSampleIndex: m.sourceStartSampleIndex,
      sourceEndSampleIndex: m.sourceEndSampleIndex, samples: m.samples });
    f.processor.port.onmessage({ data: { type: 'ACK', sequence: m.sequence } });
  };
  try {
    while (block < 48) accept(); // Real preroll, already more than one full credit budget cumulatively.
    runtime.beginAnalysisRegion(block * 2048);
    while (runtime.snapshot().outstanding < 4) accept();
    await Promise.resolve();
    expect(runtime.snapshot().counts.windowsStarted).toBe(1); expect(f.processor.state).toBe('ACTIVE');
    // Finite fixture: enough48k PCM for five600ms ownership windows +170ms future +30-sample FIR lookahead.
    const fifthReadyBlock = 48 + Math.ceil((5 * 600 * 48 + 170 * 48 + 30) / 2048);
    expect(() => { while (block < fifthReadyBlock) accept(); }).toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
    expect(block).toBeGreaterThan(32); expect(f.processor.state).toBe('ACTIVE');
    expect(f.sent.every(({ message }) => message.type === 'pcm-chunk')).toBe(true);
    expect(runtime.snapshot()).toMatchObject({ state: 'FAILED', outstanding: 4 });
    expect(failures).toHaveLength(1); expect(published).toEqual([]);
  } finally { release(); await runtime.dispose(); f.processor.port.onmessage({ data: { type: 'STOP' } }); }
});
