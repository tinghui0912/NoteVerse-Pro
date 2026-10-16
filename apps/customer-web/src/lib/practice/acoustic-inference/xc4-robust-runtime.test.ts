import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { XC4, assertXc4Identity, sha256, requireSourceRate } from './xc4-robust-runtime-contract';
import { Xc4StreamingResampler } from './xc4-robust-streaming-resampler';
import { Xc4RobustAcousticRuntime, type Xc4Options } from './xc4-robust-acoustic-runtime';
import { Xc4WorkerAdapter, decodeXc4, verifyXc4Model, type Xc4InferencePort, type Xc4WorkerInput } from './xc4-robust-worker-adapter';
import { xc4Window, owns } from './xc4-robust-window-planner';
import { decodeByteDanceRawOutputs } from './bytedance-decoder';
import { BYTEDANCE_INFERENCE_CONTRACT, type AcousticNoteEvent, type ByteDanceRawOutputs } from './bytedance-contract';

const repo = process.env.XC5_REPO_ROOT ?? path.resolve('../..');
const coefficients = () => readFile('public/engineering/xc4/fir-160-441.f32');
const block = (start: number, length: number, rate = 16000) => ({ sourceSampleRateHz: rate,
  sourceStartSampleIndex: start, sourceEndSampleIndex: start + length, samples: new Float32Array(length) });
const event = (input: Xc4WorkerInput, ms: number, pitch = 60): AcousticNoteEvent => ({ midiPitch: pitch, pitch: 'C4',
  onsetTime: { domainId: 'xc4-acoustic-performance', ms, sampleIndex: Math.round(input.window.startSample + (ms - input.window.inputWindowStartMs) * 16) },
  confidence: .4, onsetScore: .6, frameScore: .4, source: 'ACOUSTIC' });
const port = (events: (input: Xc4WorkerInput) => AcousticNoteEvent[] = () => []): Xc4InferencePort => ({
  run: vi.fn(async input => ({ events: events(input), inferenceMs: 2, decodeMs: .1 })), dispose: vi.fn(async () => {}) });
async function ready(worker = port()) {
  let time = 0;
  const performanceClock = { nowMs: vi.fn(() => time) };
  const options: Xc4Options = { engineeringOnly: true, sessionId: 'test', sourceSampleRateHz: 16000,
    mode: 'ALREADY_16K_TEST_INJECTION', worker, performanceClock };
  const runtime = await Xc4RobustAcousticRuntime.create(options);
  runtime.append(block(0, 16800)); runtime.startPerformance({ sourceStartSampleIndex: 16800 });
  return { runtime, worker, options, clock: performanceClock, setTime: (value: number) => { time = value; } };
}

describe('XC4 engineering contract', () => {
  it('recomputes exact committed XC4 identity and fixed parameters', async () => {
    await expect(assertXc4Identity()).resolves.toBeUndefined();
    expect(XC4.engineeringIdentitySha256).toBe('93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443');
    expect([XC4.ownedMs, XC4.futureMs, XC4.pastMs, XC4.inputSamples]).toEqual([600,170,1050,29120]);
    expect(XC4.provider).toBe('webgpu'); expect(XC4.automaticFallback).toBe(false);
    expect(XC4.ortVersion).toBe('1.20.1'); expect(XC4.productionMicrophone).toBe(false);
  });

  it('explicit0.30/0.05 differs from historical0.2/0.2 in both directions', () => {
    const raw: ByteDanceRawOutputs = { reg_onset_output: new Float32Array(183 * 88), reg_onset_shape: [1,183,88],
      frame_output: new Float32Array(183 * 88), frame_shape: [1,183,88] };
    raw.reg_onset_output[110*88+39] = .25; raw.frame_output[110*88+39] = .8;
    raw.reg_onset_output[120*88+40] = .6; raw.frame_output[120*88+40] = .1;
    const input = { window: xc4Window(0,16800), pcm: new Float32Array(29120) };
    const current = decodeXc4(raw,input);
    const old = decodeByteDanceRawOutputs(raw, { requestId:'old', pcm:input.pcm, sampleRateHz:16000,
      channelCount:1, captureStartSampleIndex:0, captureStartTime:{ domainId:'test',ms:-1050 } });
    expect(current.map(e=>e.midiPitch)).toEqual([61]); expect(old.map(e=>e.midiPitch)).toEqual([60]);
    expect(BYTEDANCE_INFERENCE_CONTRACT.onsetThreshold).toBe(.2);
    expect(BYTEDANCE_INFERENCE_CONTRACT.frameThreshold).toBe(.2);
  });

  it('rejects wrong model bytes before any session execution', async () => {
    await expect(verifyXc4Model(new Uint8Array(10))).rejects.toThrow('XC4_MODEL_IDENTITY_DRIFT');
  });
  it('48k and implicit16k capture fail without a fallback', () => {
    expect(()=>requireSourceRate(48000,'CAPTURE')).toThrow('SOURCE_SAMPLE_RATE_NOT_XC4_QUALIFIED');
    expect(()=>requireSourceRate(16000,'CAPTURE')).toThrow('SOURCE_SAMPLE_RATE_NOT_XC4_QUALIFIED');
    expect(()=>requireSourceRate(44100,'CAPTURE')).not.toThrow();
    expect(()=>requireSourceRate(16000,'ALREADY_16K_TEST_INJECTION')).not.toThrow();
  });
});

describe('frozen streaming FIR', () => {
  it('verifies exact coefficients and rejects mutation', async () => {
    const bytes = await coefficients(); expect(bytes.length).toBe(35284);
    expect(await sha256(bytes)).toBe(XC4.coefficientSha256);
    bytes[5] ^= 1; await expect(Xc4StreamingResampler.create(bytes)).rejects.toThrow('XC4_FIR_IDENTITY_DRIFT');
  });
  it('is exactly equal to frozen research streaming FIR across arbitrary chunk boundaries', async () => {
    const bytes = await coefficients(), a = await Xc4StreamingResampler.create(bytes), b = await Xc4StreamingResampler.create(bytes);
    const { StreamingRationalResampler } = await import(/* @vite-ignore */ pathToFileURL(path.join(repo,'backend/research/browser_runtime/xc2_r1_streaming_resampler.mjs')).href);
    const h = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
    const reference = new StreamingRationalResampler(h);
    const input = Float32Array.from({ length:44101 },(_,i)=>Math.fround(Math.sin(i*.173)*.3));
    const expected = reference.push(input), actual = a.push(input), chunks: number[] = [];
    for (let i=0;i<input.length;i+=137) chunks.push(...b.push(input.subarray(i,i+137)));
    expect(actual).toEqual(expected); expect(Float32Array.from(chunks)).toEqual(actual);
    expect(a.firstFullyRealOutputIndex).toBe(10);
  });
  it('waits for actual lookahead and preserves rational time coordinates without padded finish', async () => {
    const f = await Xc4StreamingResampler.create(await coefficients());
    expect(f.push(new Float32Array(27)).length).toBe(0);
    expect(f.push(new Float32Array(1)).length).toBe(1);
    expect(XC4.realSourceLookahead / 44100 * 1000).toBeCloseTo(.6349206349,10);
    expect('finish' in f).toBe(false);
  });
});

describe('real-context ownership and capture lifecycle', () => {
  it('requires1050ms real pre-roll, never fabricated startup samples', async () => {
    const o = (await ready()).options, r = await Xc4RobustAcousticRuntime.create(o);
    r.append(block(0,16799)); expect(r.state).toBe('CAPTURING_PREROLL');
    expect(()=>r.startPerformance({sourceStartSampleIndex:16799})).toThrow('XC4_REAL_PREROLL_REQUIRED');
    r.append(block(16799,1)); expect(r.state).toBe('READY_FOR_PERFORMANCE');
    r.startPerformance({sourceStartSampleIndex:16800}); expect(r.state).toBe('RUNNING');
    expect(r.snapshot().publications).toHaveLength(0);
  });
  it('adds a fully-real FIR origin guard, not merely1050ms of padded filtered outputs', async () => {
    const options = {...(await ready()).options, sourceSampleRateHz:44100, mode:'CAPTURE' as const, coefficientBytes:await coefficients()};
    const r = await Xc4RobustAcousticRuntime.create(options);
    r.append(block(1000,46305,44100)); expect(r.state).toBe('CAPTURING_PREROLL');
    r.append(block(47305,100,44100)); expect(r.state).toBe('READY_FOR_PERFORMANCE');
    r.startPerformance({sourceStartSampleIndex:47405});
  });
  it('queues exactly29120 real samples per ordered full/partial window through scoreable end', async () => {
    const {runtime:r,worker} = await ready();
    r.append(block(16800,24000)); r.stopPerformance({sourceEndSampleIndex:40800});
    r.append(block(40800,2720)); await r.seal();
    const calls = vi.mocked(worker.run).mock.calls.map(c=>c[0]);
    expect(calls.map(c=>[c.window.ownedStartMs,c.window.ownedEndMs])).toEqual([[0,600],[600,1200],[1200,1500]]);
    expect(calls.every(c=>c.pcm.length===29120 && c.window.endSample-c.window.startSample===29120)).toBe(true);
    expect(calls[2].window.inputWindowStartMs).toBe(-150);
    expect(r.snapshot().outstandingDepth).toBe(0); expect(r.state).toBe('SEALED');
  });
  it('tail capture never extends performance ownership and requires real context before seal', async () => {
    const {runtime:r} = await ready(); r.append(block(16800,19200));
    r.stopPerformance({sourceEndSampleIndex:36000});
    await expect(r.seal()).rejects.toThrow('XC4_REAL_TAIL_CONTEXT_REQUIRED');
    r.append(block(36000,2720)); await r.seal();
    const s=r.snapshot().performanceSegments[0];
    expect(s.sourcePerformanceEndSampleIndex).toBe(36000);
    expect(s.sourceContextTailEndSampleIndex).toBe(38720);
    expect(r.snapshot().queuedOwnedEndMs).toBe(1200);
  });
  it('short stop with insufficient shifted-window past fails rather than padding', async () => {
    const {runtime:r} = await ready(); r.append(block(16800,1600));
    r.stopPerformance({sourceEndSampleIndex:18400});
    expect(()=>r.append(block(18400,2720))).toThrow('XC4_REAL_PREROLL_REQUIRED');
  });
  it('half-open filters outside events and adjacent boundary event is published only once', async () => {
    const worker=port(input=>[event(input,-10),event(input,0),event(input,600),event(input,1200)]);
    const {runtime:r,setTime} = await ready(worker); setTime(1500);
    r.append(block(16800,19200)); r.stopPerformance({sourceEndSampleIndex:36000});
    r.append(block(36000,2720)); await r.seal();
    const obs=r.snapshot().publications.flatMap(p=>p.observations);
    expect(obs.map(o=>o.performanceTimeMs)).toEqual([0,600]);
    expect(obs.map(o=>o.sourceSamplePosition)).toEqual([16800,26400]);
    expect(obs.every(o=>Object.isFrozen(o))).toBe(true);
    expect(obs.every(o=>o.availabilityTimeMs===1500)).toBe(true);
    expect(new Set(obs.map(o=>o.observationId)).size).toBe(2);
    expect(owns(xc4Window(0,16800),600)).toBe(false);
  });
  it('rejects overlapping/backwards/skipped source identities and source-rate changes', async () => {
    const {runtime:r}=await ready();
    for(const start of [16799,16801]) expect(()=>r.append(block(start,1))).toThrow('XC4_NONCHRONOLOGICAL_SOURCE');
    expect(()=>r.append(block(16800,1,48000))).toThrow('XC4_CAPTURE_IDENTITY');
  });
  it('score-shaped fields fail at construction, block, anchor and worker API', async () => {
    const {runtime:r,options}=await ready();
    await expect(Xc4RobustAcousticRuntime.create({...options,expectedPitch:'C4'} as Xc4Options)).rejects.toThrow('XC4_ACOUSTIC_FIELD_VIOLATION');
    expect(()=>r.append({...block(16800,1),score:[]} as ReturnType<typeof block>)).toThrow('XC4_ACOUSTIC_FIELD_VIOLATION');
    expect(()=>r.stopPerformance({sourceEndSampleIndex:16800,truth:[]} as {sourceEndSampleIndex:number})).toThrow('XC4_ACOUSTIC_FIELD_VIOLATION');
    await expect(new Xc4WorkerAdapter().run({pcm:new Float32Array(),window:xc4Window(0,16800),expectedPitch:'C4'} as Xc4WorkerInput)).rejects.toThrow('XC4_ACOUSTIC_FIELD_VIOLATION');
  });
  it('does not control the fixed performance clock and retains queue/backlog diagnostics', async () => {
    let resolve: (()=>void)|undefined;
    const worker=port(); vi.mocked(worker.run).mockImplementationOnce(async ()=>{
      await new Promise<void>(r=>{resolve=r;}); return {events:[],inferenceMs:700,decodeMs:1};
    });
    const {runtime:r,setTime,clock}=await ready(worker);
    setTime(1400); r.append(block(16800,21920));
    await Promise.resolve(); expect(r.snapshot().maxOutstandingDepth).toBe(2);
    setTime(2100); resolve!(); await r.drain();
    expect(r.snapshot().timings[1].queueDelayMs).toBe(700);
    expect(r.snapshot().outstandingDepth).toBe(0);
    expect(Object.keys(clock)).toEqual(['nowMs']); expect(clock.nowMs()).toBe(2100);
  });
  it('reset is pre-roll-only and dispose is idempotent; sealed capture cannot silently resume', async () => {
    const {runtime:r,options}=await ready();
    await expect(r.resetPreRoll()).rejects.toThrow('XC4_RESET_REQUIRES_UNSTARTED_CAPTURE');
    await r.dispose(); await r.dispose(); expect(()=>r.append(block(16800,1))).toThrow('XC4_RUNTIME_DISPOSED');
    const fresh=await Xc4RobustAcousticRuntime.create(options), reset=await fresh.resetPreRoll();
    expect(reset.state).toBe('CAPTURING_PREROLL'); expect(fresh.state).toBe('DISPOSED');
  });
});

describe('worker adapter serialization',()=>{
  it('rejects a concurrent inference/dispose and requires deterministic order',async()=>{
    let finish: ((raw:ByteDanceRawOutputs)=>void)|undefined;
    const adapter=new Xc4WorkerAdapter();
    // Synthetic unit port only; browser smoke independently uses actual verified model/session load.
    Object.assign(adapter,{core:{infer:vi.fn(()=>new Promise(r=>{finish=r;})),dispose:vi.fn()}});
    const input={window:xc4Window(0,16800),pcm:new Float32Array(29120)};
    const first=adapter.run(input);
    await expect(adapter.run(input)).rejects.toThrow('XC4_WORKER_CONCURRENCY_REJECTED');
    await expect(adapter.dispose()).rejects.toThrow('XC4_WORKER_CONCURRENCY_REJECTED');
    finish!({reg_onset_output:new Float32Array(183*88),reg_onset_shape:[1,183,88],frame_output:new Float32Array(183*88),frame_shape:[1,183,88]});
    await first; await expect(adapter.run(input)).rejects.toThrow('XC4_WORKER_WINDOW_DRIFT');
    await adapter.dispose(); await expect(adapter.run(input)).rejects.toThrow('XC4_WORKER_NOT_READY');
  });
});
