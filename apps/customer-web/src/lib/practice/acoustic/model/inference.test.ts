import { afterEach, expect, it, vi } from 'vitest';
import { decodeAcousticOutputs, verifyAcousticModel, AcousticModelSession } from './model-inference';
import { assertModelNames, checkedOutput } from './model-validation';
import { AcousticModelWorker } from './worker-client';
import { ACOUSTIC_WORKER_RPC_SILENCE_TIMEOUT_MS as SILENCE } from './worker-liveness-policy';
import type { PianoRawOutputs } from './raw-output-contract';
import { ACOUSTIC_MODEL } from './model-contract';
import type { AcousticInferenceInput } from '../runtime/inference-types';

const input: AcousticInferenceInput = { pcm: new Float32Array(29120), window: { jobIndex: 0, regionIndex: 0, windowIndex: 0,
  ownedStartTarget: 20000, ownedEndTarget: 29600, startSample: 3200, endSample: 32320 } };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('WebGPU absence rejects session creation without requesting a fallback provider', async () => {
  vi.stubGlobal('navigator', {});
  const provider = new AcousticModelSession();
  await expect(provider.load('https://example.invalid/model.onnx')).rejects.toThrow('ACOUSTIC_WEBGPU_UNAVAILABLE');
  await provider.dispose();
});
it('decoder uses explicit authoritative .30/.05 on adversarial raw outputs', () => {
  const raw: PianoRawOutputs = { reg_onset_output: new Float32Array(183 * 88), reg_onset_shape: [1, 183, 88],
    frame_output: new Float32Array(183 * 88), frame_shape: [1, 183, 88] };
  raw.reg_onset_output[110 * 88 + 39] = .25; raw.frame_output[110 * 88 + 39] = .8;
  raw.reg_onset_output[120 * 88 + 40] = .6; raw.frame_output[120 * 88 + 40] = .1;
  expect(decodeAcousticOutputs(raw, input).map(e => e.midiPitch)).toEqual([61]);
  expect(ACOUSTIC_MODEL).toMatchObject({ onsetThreshold: .30, frameThreshold: .05 });
});
it('wrong model size/hash are rejected without inference', async () => {
  await expect(verifyAcousticModel(new Uint8Array(10))).rejects.toThrow('ACOUSTIC_MODEL_IDENTITY_MISMATCH');
  await expect(verifyAcousticModel(new Uint8Array(98689283))).rejects.toThrow('ACOUSTIC_MODEL_IDENTITY_MISMATCH');
});
it('wrong input/output descriptors and nonfinite output fail closed', () => {
  expect(() => assertModelNames(['wrong'], ['reg_onset_output', 'frame_output'])).toThrow('ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH');
  expect(() => assertModelNames(['audio'], ['frame_output'])).toThrow('ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH');
  expect(() => checkedOutput({ dims: [1, 182, 88], data: new Float32Array(183 * 88) })).toThrow('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  const data = new Float32Array(183 * 88); data[0] = NaN;
  expect(() => checkedOutput({ dims: [1, 183, 88], data })).toThrow('ACOUSTIC_NONFINITE_OUTPUT');
});
it('model port rejects inference before load and after disposal', async () => {
  const port = new AcousticModelSession();
  await expect(port.run('test', input)).rejects.toThrow('ACOUSTIC_WORKER_NOT_READY');
  await port.dispose(); await expect(port.load('/model')).rejects.toThrow('ACOUSTIC_WORKER_NOT_EMPTY');
});

class TestWorker extends EventTarget {
  messages: { id: number; type: string }[] = [];
  terminated = false;
  terminations = 0;
  postMessage(message: { id: number; type: string }) { this.messages.push(message); }
  terminate() { this.terminated = true; this.terminations++; }
  answer(result: unknown = {}) { this.dispatchEvent(new MessageEvent('message', { data: { id: this.messages.at(-1)!.id, result } })); }
}
for (const kind of ['error', 'messageerror']) it(`worker ${kind} rejects pending work and notifies a paused analyzer`, async () => {
  const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), listener = vi.fn();
  client.onFailure(listener);
  const pending = client.load('/exact-model');
  worker.dispatchEvent(new Event(kind));
  await expect(pending).rejects.toThrow(kind === 'error' ? 'ACOUSTIC_WORKER_CRASH' : 'ACOUSTIC_WORKER_MESSAGE_ERROR');
  expect(worker.terminated).toBe(true); expect(listener).toHaveBeenCalledTimes(1);
});
it('worker enforces one active inference, sequential reuse and dispose/terminate', async () => {
  const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker);
  const load = client.load('/exact-model'); worker.answer(); await load;
  const begin = client.beginSession('test'); worker.answer(); await begin;
  const run = client.run('test', input); await expect(client.run('test', input)).rejects.toThrow('ACOUSTIC_WORKER_CONCURRENCY_OR_STATE');
  worker.answer({ events: [], inferenceMs: 1, decodeMs: 0, actualSessionRunCount: 1 }); await run;
  const end = client.endSession('test'); worker.answer(); await end;
  const dispose = client.dispose(); worker.answer(); await dispose;
  expect(worker.messages.map(m => m.type)).toEqual(['LOAD', 'BEGIN_SESSION', 'INFER', 'END_SESSION', 'DISPOSE']); expect(worker.terminated).toBe(true);
  await expect(client.run('test', input)).rejects.toThrow();
});
it('disposing active worker rejects pending inference instead of hanging', async () => {
  const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker);
  const load = client.load('/exact-model'); worker.answer(); await load;
  const begin = client.beginSession('test'); worker.answer(); await begin;
  const run = client.run('test', input); await client.dispose(); await expect(run).rejects.toThrow('ACOUSTIC_WORKER_DISPOSED');
});



for (const rpc of ['LOAD', 'BEGIN_SESSION', 'INFER', 'END_SESSION', 'DISPOSE'] as const)
  for (const outcome of ['response', 'error', 'messageerror'] as const)
    it(`R14 ${rpc}: ${outcome} before the silence deadline clears its watchdog`, async () => {
      vi.useFakeTimers();
      const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), failure = vi.fn();
      client.onFailure(failure);
      const answer = async (operation: Promise<unknown>) => { worker.answer(); await operation; };
      try {
        if (rpc !== 'LOAD') await answer(client.load('/verified-model'));
        if (rpc === 'INFER' || rpc === 'END_SESSION') await answer(client.beginSession('lease'));
        const operation = rpc === 'LOAD' ? client.load('/verified-model') : rpc === 'BEGIN_SESSION' ? client.beginSession('lease')
          : rpc === 'INFER' ? client.run('lease', input) : rpc === 'END_SESSION' ? client.endSession('lease') : client.dispose();
        let settled = false;
        const observed = operation.then(value => { settled = true; return { value, error: null }; }, error => { settled = true; return { value: null, error }; });
        const requests = worker.messages.length;
        expect(worker.messages.at(-1)?.type).toBe(rpc);
        await vi.advanceTimersByTimeAsync(SILENCE - 1);
        expect(settled).toBe(false); expect(worker.terminated).toBe(false); expect(failure).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1); expect(worker.messages).toHaveLength(requests);
        if (rpc !== 'DISPOSE') {
          await expect(client.run('lease', input)).rejects.toThrow('ACOUSTIC_WORKER_CONCURRENCY_OR_STATE');
          expect(worker.messages).toHaveLength(requests); // Pending load/session/inference RPC owns the busy client.
        } // Idle DISPOSE has no busy latch; a valid disposing owner issues no concurrent work.
        if (outcome === 'response') worker.answer({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 });
        else worker.dispatchEvent(new Event(outcome));
        const result = await observed;
        if (outcome === 'response') { expect(result.error).toBeNull(); expect(failure).not.toHaveBeenCalled(); }
        else {
          expect(result.error.message).toBe(outcome === 'error' ? 'ACOUSTIC_WORKER_CRASH' : 'ACOUSTIC_WORKER_MESSAGE_ERROR');
          expect(failure).toHaveBeenCalledOnce(); expect(worker.terminated).toBe(true);
        }
        expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(SILENCE * 2);
        expect(failure).toHaveBeenCalledTimes(outcome === 'response' ? 0 : 1);
      } finally { client.terminate(); vi.useRealTimers(); }
    });

for (const rpc of ['LOAD', 'BEGIN_SESSION', 'INFER', 'END_SESSION', 'DISPOSE'] as const) {
  it(`R14 silent ${rpc} terminates once at its safety deadline and fences late messages`, async () => {
    vi.useFakeTimers();
    const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), failure = vi.fn();
    client.onFailure(failure);
    if (rpc !== 'LOAD') { const load = client.load('/model'); worker.answer(); await load; }
    if (rpc === 'INFER' || rpc === 'END_SESSION') { const begin = client.beginSession('lease'); worker.answer(); await begin; }
    const operation = rpc === 'LOAD' ? client.load('/model') : rpc === 'BEGIN_SESSION' ? client.beginSession('lease')
      : rpc === 'INFER' ? client.run('lease', input) : rpc === 'END_SESSION' ? client.endSession('lease') : client.dispose();
    const rejected = vi.fn(), observed = operation.catch(rejected), requests = worker.messages.length;
    await vi.advanceTimersByTimeAsync(SILENCE - 1);
    expect(rejected).not.toHaveBeenCalled(); expect(worker.terminated).toBe(false); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); await observed;
    expect(rejected).toHaveBeenCalledOnce(); expect(rejected.mock.calls[0][0].message).toBe('ACOUSTIC_WORKER_RPC_TIMEOUT');
    expect(failure).toHaveBeenCalledOnce(); expect(failure.mock.calls[0][0].message).toBe('ACOUSTIC_WORKER_RPC_TIMEOUT');
    expect(worker.terminations).toBe(1); expect(vi.getTimerCount()).toBe(0);
    worker.answer(); worker.dispatchEvent(new Event('error')); worker.dispatchEvent(new Event('messageerror'));
    client.terminate('OTHER_LATE_CAUSE'); await client.dispose(); await vi.advanceTimersByTimeAsync(SILENCE * 2);
    await expect(client.load('/model')).rejects.toThrow('ACOUSTIC_WORKER_NOT_EMPTY');
    await expect(client.run('lease', input)).rejects.toThrow('ACOUSTIC_WORKER_CONCURRENCY_OR_STATE');
    expect(worker.messages).toHaveLength(requests); expect(worker.terminations).toBe(1);
    expect(failure).toHaveBeenCalledOnce(); expect(rejected).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
}

it('LOAD progress refreshes only its silence window so total load duration may exceed60s', async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), progress = vi.fn(), failure = vi.fn();
  client.onFailure(failure); const loading = client.load('/model', progress), id = worker.messages[0].id;
  const report = (bytesDownloaded: number) => worker.dispatchEvent(new MessageEvent('message', { data: { id, type: 'PROGRESS', progress: { bytesDownloaded, totalBytes: 3 } } }));
  await vi.advanceTimersByTimeAsync(SILENCE - 1); report(1);
  await vi.advanceTimersByTimeAsync(SILENCE - 1); expect(worker.terminated).toBe(false); report(2);
  await vi.advanceTimersByTimeAsync(SILENCE - 1); expect(worker.terminated).toBe(false);
  expect(progress).toHaveBeenCalledTimes(2); expect(worker.messages).toHaveLength(1); expect(worker.messages[0].id).toBe(id);
  worker.answer(); await loading; expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(SILENCE * 2); expect(failure).not.toHaveBeenCalled(); client.terminate();
});

it('LOAD progress followed by silence times out from the last legal progress', async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), progress = vi.fn();
  const observed = client.load('/model', progress).catch(error => error);
  await vi.advanceTimersByTimeAsync(SILENCE - 1);
  worker.dispatchEvent(new MessageEvent('message', { data: { id: worker.messages[0].id, type: 'PROGRESS', progress: { bytesDownloaded: 1, totalBytes: null } } }));
  await vi.advanceTimersByTimeAsync(SILENCE - 1); expect(worker.terminated).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(await observed).toMatchObject({ message: 'ACOUSTIC_WORKER_RPC_TIMEOUT' });
  expect(progress).toHaveBeenCalledOnce(); expect(worker.terminations).toBe(1); expect(vi.getTimerCount()).toBe(0);
});

it('malformed matching LOAD messages cannot refresh or settle a pending request', async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), progress = vi.fn();
  const observed = client.load('/model', progress).catch(error => error), id = worker.messages[0].id;
  await vi.advanceTimersByTimeAsync(SILENCE - 1);
  for (const data of [{ id, type: 'PROGRESS', progress: { bytesDownloaded: NaN, totalBytes: 3 } },
    { id, type: 'PROGRESS', progress: { bytesDownloaded: -1, totalBytes: 3 } },
    { id, type: 'PROGRESS', progress: { bytesDownloaded: 1 } }, { id, type: 'OTHER' }]) {
    worker.dispatchEvent(new MessageEvent('message', { data }));
  }
  expect(progress).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1); expect(await observed).toMatchObject({ message: 'ACOUSTIC_WORKER_RPC_TIMEOUT' }); expect(vi.getTimerCount()).toBe(0);
});

it('non-LOAD progress cannot refresh INFER, and unmatched progress preserves the protocol failure', async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker);
  const load = client.load('/model'); worker.answer(); await load;
  const run = client.run('lease', input).catch(error => error), id = worker.messages.at(-1)!.id;
  await vi.advanceTimersByTimeAsync(SILENCE - 1);
  worker.dispatchEvent(new MessageEvent('message', { data: { id, type: 'PROGRESS', progress: { bytesDownloaded: 1, totalBytes: 2 } } }));
  await vi.advanceTimersByTimeAsync(1); expect((await run).message).toBe('ACOUSTIC_WORKER_RPC_TIMEOUT');
  const other = new TestWorker(), otherClient = new AcousticModelWorker(other as unknown as Worker);
  const pending = otherClient.load('/model').catch(error => error);
  other.dispatchEvent(new MessageEvent('message', { data: { id: 999, type: 'PROGRESS', progress: { bytesDownloaded: 1, totalBytes: 2 } } }));
  expect(await pending).toMatchObject({ message: 'UNEXPECTED_WORKER_RESPONSE' }); expect(vi.getTimerCount()).toBe(0);
});

it('explicit busy dispose remains immediate and clears the inference watchdog', async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), failure = vi.fn(); client.onFailure(failure);
  const load = client.load('/model'); worker.answer(); await load;
  const run = client.run('lease', input), observed = expect(run).rejects.toThrow('ACOUSTIC_WORKER_DISPOSED');
  expect(vi.getTimerCount()).toBe(1); await client.dispose(); await observed;
  expect(worker.terminations).toBe(1); expect(vi.getTimerCount()).toBe(0); expect(failure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(SILENCE * 2); expect(failure).not.toHaveBeenCalled();
});

it('synchronous postMessage throw rejects immediately without leaving a watchdog', async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker);
  vi.spyOn(worker, 'postMessage').mockImplementation(() => { throw new Error('POST_FAILED'); });
  await expect(client.load('/model')).rejects.toThrow('POST_FAILED');
  expect(vi.getTimerCount()).toBe(0); expect(worker.terminations).toBe(1);
});

it('a terminal event between LOAD response and continuation cannot revive CLOSED client', async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), client = new AcousticModelWorker(worker as unknown as Worker), failure = vi.fn(); client.onFailure(failure);
  const loading = client.load('/model'); worker.answer(); worker.dispatchEvent(new Event('error'));
  await expect(loading).rejects.toThrow('ACOUSTIC_WORKER_CRASH');
  await expect(client.beginSession('lease')).rejects.toThrow('ACOUSTIC_WORKER_CONCURRENCY_OR_STATE');
  expect(worker.terminations).toBe(1); expect(failure).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
