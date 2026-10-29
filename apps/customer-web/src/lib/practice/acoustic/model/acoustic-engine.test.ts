import { expect, it, vi } from 'vitest';
import { AcousticEngine } from './acoustic-engine';
import { ACOUSTIC_MODEL as M, ACOUSTIC_TARGET_SAMPLES_PER_MS } from './model-contract';
import { assertWindowGeometry } from './model-validation';
import { workerRpcRig } from './__fixtures__/worker-rpc';
import { ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS as SILENCE } from './worker-liveness-policy';
import type { AcousticInferenceInput, AcousticInferenceResult } from '../runtime/inference-types';

const input: AcousticInferenceInput = { pcm: new Float32Array(29120), window: { jobIndex: 0, regionIndex: 0, windowIndex: 0,
  ownedStartTarget: 16800, ownedEndTarget: 26400, startSample: 0, endSample: 29120 } };
const result: AcousticInferenceResult = { events: [], inferenceMs: 1, decodeMs: 0, actualSessionRunCount: 1 };
function rig() {
  let failure: (error: Error) => void = () => {};
  const worker = { load: vi.fn(async () => ({})), beginSession: vi.fn(async (_token: string) => {}),
    run: vi.fn(async (_token: string, _input: AcousticInferenceInput) => result), endSession: vi.fn(async (_token: string) => {}),
    dispose: vi.fn(async () => {}), terminate: vi.fn(), onFailure: vi.fn((listener: (error: Error) => void) => {
      failure = listener; return () => {};
    }) };
  const engine = new AcousticEngine(() => worker);
  return { engine, worker, fail: () => failure(new Error('ACOUSTIC_WORKER_CRASH')) };
}
it('reuses one model load across smoke, STEP and Continuous leases with fresh job zero and tokens', async () => {
  const { engine, worker } = rig(); await engine.prepare('/verified-model');
  for (const mode of ['STEP', 'CONTINUOUS']) {
    const lease = await engine.acquire(); expect(await lease.run(input), mode).toEqual(result);
    await lease.dispose(); expect(engine.snapshot().state).toBe('READY_IDLE');
    await expect(lease.run(input)).rejects.toThrow('RETIRED');
  }
  expect(worker.load).toHaveBeenCalledOnce();
  expect(new Set(worker.beginSession.mock.calls.map(call => call[0])).size).toBe(3);
  expect(worker.run.mock.calls.every(call => call[1].window.jobIndex === 0)).toBe(true);
  expect(worker.endSession).toHaveBeenCalledTimes(3); expect(worker.dispose).not.toHaveBeenCalled();
  await engine.dispose(); expect(worker.dispose).toHaveBeenCalledOnce();
});
it('prepare derives one unchanged smoke input from model geometry, without planner or past declaration ownership', async () => {
  const { engine, worker } = rig(), states: string[] = [], calls: string[] = [];
  engine.subscribe(() => states.push(engine.snapshot().state));
  worker.load.mockImplementation(async () => { calls.push('LOAD'); return {}; });
  worker.beginSession.mockImplementation(async () => { calls.push('BEGIN_SESSION'); });
  worker.run.mockImplementation(async (_token, smoke) => { calls.push('INFER'); assertWindowGeometry(smoke.window); return result; });
  worker.endSession.mockImplementation(async () => { calls.push('END_SESSION'); });
  try {
    await engine.prepare('/verified-model');
    expect(worker.run).toHaveBeenCalledOnce();
    const [token, smoke] = worker.run.mock.calls[0];
    const expectedEnd = M.inputSamples - M.futureMs * ACOUSTIC_TARGET_SAMPLES_PER_MS;
    const expectedStart = expectedEnd - M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS;
    expect(smoke.pcm).toBeInstanceOf(Float32Array); expect(smoke.pcm).toHaveLength(M.inputSamples);
    expect(smoke.pcm.every(sample => sample === 0)).toBe(true);
    expect(smoke.window).toEqual({ jobIndex: 0, regionIndex: 0, windowIndex: 0, ownedStartTarget: expectedStart,
      ownedEndTarget: expectedEnd, startSample: 0, endSample: M.inputSamples });
    expect(smoke.window.endSample - smoke.window.startSample).toBe(M.inputSamples);
    expect(smoke.window.ownedEndTarget - smoke.window.ownedStartTarget).toBe(M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS);
    expect(smoke.window.endSample - smoke.window.ownedEndTarget - M.futureMs * ACOUSTIC_TARGET_SAMPLES_PER_MS).toBe(0);
    expect([M.inputSamples, M.futureMs * ACOUSTIC_TARGET_SAMPLES_PER_MS, M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS,
      smoke.window.ownedStartTarget, smoke.window.ownedEndTarget, smoke.window.startSample, smoke.window.endSample, smoke.pcm.length])
      .toEqual([29120, 2720, 9600, 16800, 26400, 0, 29120, 29120]); // Secondary current characterization.
    expect(worker.beginSession).toHaveBeenCalledExactlyOnceWith(token);
    expect(worker.endSession).toHaveBeenCalledExactlyOnceWith(token);
    expect(calls).toEqual(['LOAD', 'BEGIN_SESSION', 'INFER', 'END_SESSION']);
    expect(states).toEqual(['PREPARING', 'READY_IDLE', 'LEASED', 'RETIRING', 'READY_IDLE']);
    expect(engine.snapshot()).toEqual({ state: 'READY_IDLE', failure: null });
    await engine.prepare('/verified-model'); // Warm prepare remains idempotent; no second smoke.
    expect(worker.load).toHaveBeenCalledOnce(); expect(worker.run).toHaveBeenCalledOnce();
  } finally { await engine.dispose(); }
  expect(worker.dispose).toHaveBeenCalledOnce(); expect(engine.snapshot().state).toBe('DISPOSED');
});
it('retires outstanding inference before ending the lease and cannot leak its result into a new session', async () => {
  const { engine, worker } = rig(); await engine.prepare('/verified-model');
  const a = await engine.acquire(); let settle!: (value: AcousticInferenceResult) => void;
  worker.run.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const pending = a.run(input), rejected = expect(pending).rejects.toThrow('RETIRED');
  const retirement = a.dispose();
  await expect(engine.acquire()).rejects.toThrow('NOT_READY'); expect(engine.snapshot().state).toBe('RETIRING');
  expect(worker.endSession).toHaveBeenCalledTimes(1);
  settle(result); await rejected; await retirement;
  const b = await engine.acquire(); expect(await b.run(input)).toEqual(result); await b.dispose(); await engine.dispose();
});
it('worker failure blocks new leases, notifies the active owner and releases the broken engine', async () => {
  const r = rig(); await r.engine.prepare('/model'); const lease = await r.engine.acquire(), failure = vi.fn(); lease.onFailure?.(failure);
  r.fail(); expect(r.engine.snapshot().state).toBe('FAILED'); expect(failure).toHaveBeenCalledOnce();
  expect(r.worker.terminate).toHaveBeenCalledOnce(); await expect(r.engine.acquire()).rejects.toThrow('NOT_READY');
  await lease.dispose(); await r.engine.dispose();
});
it('a lease is exclusive, and abort releases only that lease', async () => {
  const r = rig(); await r.engine.prepare('/model'); const signal = new AbortController();
  const lease = await r.engine.acquire(signal.signal); await expect(r.engine.acquire()).rejects.toThrow('NOT_READY');
  signal.abort(); await lease.dispose(); expect(r.engine.snapshot().state).toBe('READY_IDLE');
  expect(r.worker.dispose).not.toHaveBeenCalled(); await r.engine.dispose();
});

it('Worker construction failure is terminal and does not leave a preparing engine reusable', async () => {
  const engine = new AcousticEngine(() => { throw new Error('WORKER_UNAVAILABLE'); });
  await expect(engine.prepare('/model')).rejects.toThrow('WORKER_UNAVAILABLE');
  expect(engine.snapshot().state).toBe('FAILED');
  await expect(engine.acquire()).rejects.toThrow('NOT_READY');
  await engine.dispose(); expect(engine.snapshot().state).toBe('DISPOSED');
});


it('R14 END_SESSION silence fails retirement finitely and lets concurrent engine disposal finish', async () => {
  vi.useFakeTimers(); const { service, client } = workerRpcRig(), engine = new AcousticEngine(() => client), states: string[] = [];
  engine.subscribe(() => states.push(engine.snapshot().state));
  try {
    await engine.prepare('/model'); const lease = await engine.acquire(); service.silent.add('END_SESSION');
    const failed = vi.fn(), retirement = lease.dispose().catch(failed); await Promise.resolve();
    expect(engine.snapshot().state).toBe('RETIRING');
    let disposed = false; const disposal = engine.dispose().then(() => { disposed = true; });
    await vi.advanceTimersByTimeAsync(SILENCE - 1); expect(disposed).toBe(false); expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await retirement; await disposal;
    expect(failed).toHaveBeenCalledOnce(); expect(failed.mock.calls[0][0].message).toBe('ACOUSTIC_WORKER_RPC_TIMEOUT');
    expect(states).toContain('FAILED'); expect(engine.snapshot().state).toBe('DISPOSED');
    await expect(engine.acquire()).rejects.toThrow('NOT_READY');
    expect(service.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  } finally { await engine.dispose(); vi.useRealTimers(); }
});

for (const rpc of ['LOAD', 'BEGIN_SESSION', 'INFER'] as const) it(`${rpc} silence makes the real engine FAILED and prevents reuse`, async () => {
  vi.useFakeTimers(); const { service, client } = workerRpcRig(), create = vi.fn(() => client), engine = new AcousticEngine(create), failure = vi.fn();
  engine.onFailure(failure);
  try {
    let operation: Promise<unknown>, lease;
    if (rpc === 'INFER') {
      await engine.prepare('/model'); lease = await engine.acquire(); service.silent.add(rpc); operation = lease.run(input);
    } else { service.silent.add(rpc); operation = engine.prepare('/model'); }
    const failed = vi.fn(), observed = operation.catch(failed);
    await vi.advanceTimersByTimeAsync(SILENCE - 1); expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await observed;
    expect(failed).toHaveBeenCalledOnce(); expect(failed.mock.calls[0][0].message).toBe('ACOUSTIC_WORKER_RPC_TIMEOUT');
    expect(engine.snapshot()).toEqual({ state: 'FAILED', failure: 'ACOUSTIC_WORKER_RPC_TIMEOUT' });
    expect(failure).toHaveBeenCalledOnce(); expect(service.terminate).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
    await expect(engine.acquire()).rejects.toThrow('NOT_READY'); await lease?.dispose();
    expect(engine.snapshot().state).toBe('FAILED'); expect(vi.getTimerCount()).toBe(0);
  } finally { await engine.dispose(); vi.useRealTimers(); }
});

it('idle DISPOSE silence rejects engine cleanup rather than reporting normal successful disposal', async () => {
  vi.useFakeTimers(); const { service, client } = workerRpcRig(), engine = new AcousticEngine(() => client);
  try {
    await engine.prepare('/model'); service.silent.add('DISPOSE');
    const failed = vi.fn(), disposal = engine.dispose().catch(failed);
    await vi.advanceTimersByTimeAsync(SILENCE - 1); expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await disposal;
    expect(failed).toHaveBeenCalledOnce(); expect(failed.mock.calls[0][0].message).toBe('ACOUSTIC_WORKER_RPC_TIMEOUT');
    expect(service.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); expect(engine.snapshot().state).toBe('DISPOSED');
  } finally { await engine.dispose(); vi.useRealTimers(); }
});
