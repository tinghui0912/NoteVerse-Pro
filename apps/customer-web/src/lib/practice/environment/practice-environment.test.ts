import { expect, it, vi } from 'vitest';
import { PracticeEnvironment } from './practice-environment';
import { AcousticEngine } from '@/lib/practice/acoustic/model/acoustic-engine';
import type { PracticeRequirement } from '@/lib/practice/readiness/requirements';
const mic: PracticeRequirement[] = ['acousticEngine', 'browserAudio', 'microphone'];
function rig() {
  let crash: (error: Error) => void = () => {};
  const worker = { load: vi.fn(async () => ({})), beginSession: vi.fn(async () => {}),
    run: vi.fn(async () => ({ events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 })),
    endSession: vi.fn(async () => {}), dispose: vi.fn(async () => {}), terminate: vi.fn(),
    onFailure: (listener: (error: Error) => void) => { crash = listener; return () => {}; } };
  const platform = { modelUrl: vi.fn(async () => '/verified-model'), createEngine: vi.fn(() => new AcousticEngine(() => worker)),
    probe: vi.fn(async (requirements: readonly PracticeRequirement[], ready: (key: PracticeRequirement) => void) => {
      requirements.filter(key => key !== 'acousticEngine').forEach(ready);
    }) };
  const environment = new PracticeEnvironment(platform);
  return { environment, platform, worker, crash: () => crash(new Error('ACOUSTIC_WORKER_CRASH')) };
}
it('MIDI OFF prepares no audio, acoustic engine or model, and uses the exact requirements fingerprint', async () => {
  const r = rig(); await r.environment.prepare(['midi']);
  expect(r.environment.matches(['midi'])).toBe(true); expect(r.environment.matches(mic)).toBe(false);
  expect(r.platform.modelUrl).not.toHaveBeenCalled(); expect(r.platform.createEngine).not.toHaveBeenCalled();
  await expect(r.environment.acquireInference(new AbortController().signal)).rejects.toThrow('NOT_READY');
  await r.environment.dispose();
});
it('equivalent requirements preserve readiness and all healthy acoustic session leases share one cold preparation', async () => {
  const r = rig(); await r.environment.prepare(mic);
  for (let i = 0; i < 3; i++) {
    await r.environment.prepare([...mic].reverse());
    const lease = await r.environment.acquireInference(new AbortController().signal); await lease.dispose();
  }
  expect(r.platform.probe).toHaveBeenCalledOnce(); expect(r.platform.modelUrl).toHaveBeenCalledOnce();
  expect(r.worker.load).toHaveBeenCalledOnce(); expect(r.worker.beginSession).toHaveBeenCalledTimes(4);
  expect(r.worker.dispose).not.toHaveBeenCalled(); await r.environment.dispose(); expect(r.worker.dispose).toHaveBeenCalledOnce();
});
it('camera failure leaves VIDEO requirements blocked rather than turning them into a ready OFF set', async () => {
  const r = rig(); r.platform.probe.mockRejectedValueOnce(new Error('CAMERA_PERMISSION_DENIED'));
  const requirements: PracticeRequirement[] = ['midi', 'microphone', 'camera', 'videoRecording'];
  await r.environment.prepare(requirements);
  expect(r.environment.snapshot()).toMatchObject({ status: 'BLOCKED', reason: 'CAMERA_PERMISSION_DENIED' });
  expect(r.environment.matches(requirements)).toBe(false); expect(r.environment.matches(['midi'])).toBe(false);
  expect(r.platform.createEngine).not.toHaveBeenCalled(); await r.environment.dispose();
});
it('failure invalidates live readiness and only explicit prepare creates a replacement engine', async () => {
  const r = rig(); await r.environment.prepare(mic); r.crash();
  expect(r.environment.snapshot()).toMatchObject({ status: 'BLOCKED', components: { acousticEngine: 'BLOCKED' } });
  await expect(r.environment.acquireInference(new AbortController().signal)).rejects.toThrow('NOT_READY');
  expect(r.platform.createEngine).toHaveBeenCalledOnce();
  await r.environment.prepare(mic); expect(r.platform.createEngine).toHaveBeenCalledTimes(2);
  expect(r.environment.matches(mic)).toBe(true); await r.environment.dispose();
});
it('cancellation cannot publish readiness after disposal', async () => {
  const r = rig(); let release!: () => void;
  r.platform.probe.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const preparation = r.environment.prepare(['midi']); const disposed = r.environment.dispose();
  release(); await preparation; await disposed; expect(r.environment.snapshot().status).toBe('UNCONFIGURED');
  await expect(r.environment.prepare(['midi'])).rejects.toThrow('DISPOSED');
});

it('an unused acoustic engine failure does not invalidate MIDI-only readiness', async () => {
  const r = rig(); await r.environment.prepare(mic); await r.environment.prepare(['midi']);
  r.crash(); expect(r.environment.matches(['midi'])).toBe(true);
  expect(r.platform.createEngine).toHaveBeenCalledOnce();
  await r.environment.prepare(mic);
  expect(r.platform.createEngine).toHaveBeenCalledTimes(2);
  expect(r.environment.matches(mic)).toBe(true); await r.environment.dispose();
});
