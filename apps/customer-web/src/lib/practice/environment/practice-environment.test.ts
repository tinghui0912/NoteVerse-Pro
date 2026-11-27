import { expect, it, vi } from 'vitest';
import { PracticeEnvironment } from './practice-environment';
import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
function rig() {
  let crash: (error: Error) => void = () => {};
  const worker = { load: vi.fn(async () => ({})), beginSession: vi.fn(async () => {}),
    run: vi.fn(async () => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 })),
    endSession: vi.fn(async () => {}), dispose: vi.fn(async () => {}), terminate: vi.fn(),
    onFailure: (listener: (error: Error) => void) => { crash = listener; return () => {}; } };
  const platform = { modelUrl: vi.fn(async () => '/verified-model'), createEngine: vi.fn(() => new AcousticEngine(() => worker)),
    validateCapture: vi.fn(async (_stream: MediaStream, _signal: AbortSignal) => {}) };
  const environment = new PracticeEnvironment(platform);
  return { environment, platform, worker, crash: () => crash(new Error('ACOUSTIC_WORKER_CRASH')) };
}

const inputMicrophone = {} as MediaStream;
const options = () => ({ inputMicrophone, signal: new AbortController().signal });
it('starts empty and cannot grant an inference lease before acoustic preparation', async () => {
  const r = rig(); expect(r.environment.acousticState()).toBe('EMPTY');
  await expect(r.environment.acquireInference(options().signal)).rejects.toMatchObject({kind:'ACOUSTIC', code:'ENVIRONMENT_NOT_READY'});
  expect(r.platform.modelUrl).not.toHaveBeenCalled(); await r.environment.dispose();
});
it('validates the exact borrowed microphone on every command, retaining one warm engine', async () => {
  const r = rig();
  for (let i = 0; i < 3; i++) {
    const command = options(); await r.environment.validateAcoustic(command);
    expect(r.platform.validateCapture).toHaveBeenLastCalledWith(inputMicrophone, expect.any(AbortSignal));
    const lease = await r.environment.acquireInference(command.signal); await lease.dispose();
  }
  expect(r.platform.validateCapture).toHaveBeenCalledTimes(3); expect(r.platform.modelUrl).toHaveBeenCalledOnce();
  expect(r.worker.load).toHaveBeenCalledOnce(); expect(r.worker.beginSession).toHaveBeenCalledTimes(4);
  await r.environment.dispose(); expect(r.worker.dispose).toHaveBeenCalledOnce();
});
it('capture validation failure propagates and does not acquire/model-load an engine', async () => {
  const r = rig(), cause = new Error('capture'); r.platform.validateCapture.mockRejectedValueOnce(cause);
  await expect(r.environment.validateAcoustic(options())).rejects.toBe(cause);
  expect(r.platform.createEngine).not.toHaveBeenCalled(); await r.environment.dispose();
});
it('engine failure is an infrastructure fact; only a new explicit validation replaces it', async () => {
  const r = rig(); await r.environment.validateAcoustic(options()); r.crash();
  expect(r.environment.acousticState()).toBe('FAILED');
  await expect(r.environment.acquireInference(options().signal)).rejects.toMatchObject({code:'ENVIRONMENT_NOT_READY'});
  expect(r.platform.createEngine).toHaveBeenCalledOnce(); await r.environment.validateAcoustic(options());
  expect(r.platform.createEngine).toHaveBeenCalledTimes(2); expect(r.environment.acousticState()).toBe('READY_IDLE');
  await r.environment.dispose();
});
it('observes engine LEASED/RETIRING truth and never steals an active lease during validation', async () => {
  const r = rig(); await r.environment.validateAcoustic(options());
  const lease = await r.environment.acquireInference(options().signal);
  expect(r.environment.acousticState()).toBe('LEASED');
  await expect(r.environment.acquireInference(options().signal)).rejects.toMatchObject({code:'ENVIRONMENT_NOT_READY'});
  let done = false; const next = r.environment.validateAcoustic(options()).then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  await lease.dispose(); await next;
  expect(r.environment.acousticState()).toBe('READY_IDLE'); expect(r.worker.load).toHaveBeenCalledOnce();
  await r.environment.dispose();
});
it('aborted validation cannot succeed after temporary capture finishes', async () => {
  const r = rig(); let finish!: () => void;
  r.platform.validateCapture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const abort = new AbortController(); const pending = r.environment.validateAcoustic({ inputMicrophone, signal: abort.signal });
  abort.abort(); finish(); await expect(pending).rejects.toThrow(); expect(r.platform.modelUrl).not.toHaveBeenCalled();
  await r.environment.dispose();
});
it('dispose cancels a waiting engine handoff and releases infrastructure exactly once', async () => {
  const r = rig(); await r.environment.validateAcoustic(options());
  const lease = await r.environment.acquireInference(options().signal);
  const next = r.environment.validateAcoustic(options()); const rejected = expect(next).rejects.toThrow();
  await r.environment.dispose(); await rejected; await lease.dispose(); await r.environment.dispose();
  expect(r.environment.acousticState()).toBe('DISPOSED'); expect(r.worker.dispose).toHaveBeenCalledOnce();
  await expect(r.environment.validateAcoustic(options())).rejects.toThrow('DISPOSED');
});
