import { afterEach, expect, it, vi } from 'vitest';
import { decodeAcousticOutputs, verifyAcousticModel, AcousticModelSession } from './model-inference';
import { assertModelNames, checkedOutput } from './model-validation';
import { AcousticModelWorker } from './worker-client';
import type { PianoRawOutputs } from './raw-output-contract';
import { ACOUSTIC_MODEL } from './model-contract';
import type { AcousticInferenceInput } from '../runtime/inference-types';

const input: AcousticInferenceInput = { pcm: new Float32Array(29120), window: { jobIndex: 0, regionIndex: 0, windowIndex: 0,
  ownedStartTarget: 20000, ownedEndTarget: 29600, startSample: 3200, endSample: 32320 } };
afterEach(() => vi.unstubAllGlobals());
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
  postMessage(message: { id: number; type: string }) { this.messages.push(message); }
  terminate() { this.terminated = true; }
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

