import { expect, it, vi } from 'vitest';
import { AcousticEngine } from './acoustic-engine';
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
