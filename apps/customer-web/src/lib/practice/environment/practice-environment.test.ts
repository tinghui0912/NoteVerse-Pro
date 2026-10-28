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
  const r = rig(); await r.environment.requalify(['midi']);
  expect(r.environment.matches(['midi'])).toBe(true); expect(r.environment.matches(mic)).toBe(false);
  expect(r.platform.modelUrl).not.toHaveBeenCalled(); expect(r.platform.createEngine).not.toHaveBeenCalled();
  await expect(r.environment.acquireInference(new AbortController().signal)).rejects.toThrow('NOT_READY');
  await r.environment.dispose();
});
it('every explicit qualification reruns probes while healthy acoustic session leases share one cold preparation', async () => {
  const r = rig(); await r.environment.requalify(mic);
  for (let i = 0; i < 3; i++) {
    await r.environment.requalify([...mic].reverse());
    const lease = await r.environment.acquireInference(new AbortController().signal); await lease.dispose();
  }
  expect(r.platform.probe).toHaveBeenCalledTimes(4); expect(r.platform.modelUrl).toHaveBeenCalledOnce();
  expect(r.worker.load).toHaveBeenCalledOnce(); expect(r.worker.beginSession).toHaveBeenCalledTimes(4);
  expect(r.worker.dispose).not.toHaveBeenCalled(); await r.environment.dispose(); expect(r.worker.dispose).toHaveBeenCalledOnce();
});
it('camera failure leaves VIDEO requirements blocked rather than turning them into a ready OFF set', async () => {
  const r = rig(); r.platform.probe.mockRejectedValueOnce(new Error('CAMERA_PERMISSION_DENIED'));
  const requirements: PracticeRequirement[] = ['midi', 'microphone', 'camera', 'videoRecording'];
  await r.environment.requalify(requirements);
  expect(r.environment.snapshot()).toMatchObject({ status: 'BLOCKED', reason: 'CAMERA_PERMISSION_DENIED' });
  expect(r.environment.matches(requirements)).toBe(false); expect(r.environment.matches(['midi'])).toBe(false);
  expect(r.platform.createEngine).not.toHaveBeenCalled(); await r.environment.dispose();
});
it('failure invalidates live readiness and only explicit prepare creates a replacement engine', async () => {
  const r = rig(); await r.environment.requalify(mic); r.crash();
  expect(r.environment.snapshot()).toMatchObject({ status: 'BLOCKED', components: { acousticEngine: 'BLOCKED' } });
  await expect(r.environment.acquireInference(new AbortController().signal)).rejects.toThrow('NOT_READY');
  expect(r.platform.createEngine).toHaveBeenCalledOnce();
  await r.environment.requalify(mic); expect(r.platform.createEngine).toHaveBeenCalledTimes(2);
  expect(r.environment.matches(mic)).toBe(true); await r.environment.dispose();
});
it('cancellation cannot publish readiness after disposal', async () => {
  const r = rig(); let release!: () => void;
  r.platform.probe.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const preparation = r.environment.requalify(['midi']); const disposed = r.environment.dispose();
  release(); await preparation; await disposed; expect(r.environment.snapshot().status).toBe('UNCONFIGURED');
  await expect(r.environment.requalify(['midi'])).rejects.toThrow('DISPOSED');
});

it('an unused acoustic engine failure does not invalidate MIDI-only readiness', async () => {
  const r = rig(); await r.environment.requalify(mic); await r.environment.requalify(['midi']);
  r.crash(); expect(r.environment.matches(['midi'])).toBe(true);
  expect(r.platform.createEngine).toHaveBeenCalledOnce();
  await r.environment.requalify(mic);
  expect(r.platform.createEngine).toHaveBeenCalledTimes(2);
  expect(r.environment.matches(mic)).toBe(true); await r.environment.dispose();
});

it('requalification transitions READY → CHECKING → READY without manufacturing a failure', async () => {
  const r=rig(); await r.environment.requalify(mic);
  const states: string[]=[], reasons: (string|null)[]=[];
  r.environment.subscribe(()=>{states.push(r.environment.snapshot().status);reasons.push(r.environment.snapshot().reason);});
  expect(r.environment.matches(mic)).toBe(true);
  await r.environment.requalify(mic);
  expect(states[0]).toBe('CHECKING'); expect(states.at(-1)).toBe('READY'); expect(states).not.toContain('BLOCKED');
  expect(reasons.every(reason=>reason===null)).toBe(true); expect(r.platform.probe).toHaveBeenCalledTimes(2);
  expect(r.platform.createEngine).toHaveBeenCalledOnce(); expect(r.platform.modelUrl).toHaveBeenCalledOnce(); expect(r.worker.load).toHaveBeenCalledOnce();
  await r.environment.dispose();
});
for(const state of ['FAILED','DISPOSED'] as const) it(`${state} engine is replaced only during explicit requalification`, async()=>{
  const r=rig(); await r.environment.requalify(mic);
  if(state==='FAILED')r.crash(); else await r.platform.createEngine.mock.results[0].value.dispose();
  expect(r.environment.matches(mic)).toBe(false);
  expect(r.platform.createEngine).toHaveBeenCalledOnce();
  await r.environment.requalify(mic);
  expect(r.platform.probe).toHaveBeenCalledTimes(2); expect(r.platform.createEngine).toHaveBeenCalledTimes(2);
  expect(r.platform.modelUrl).toHaveBeenCalledTimes(2); expect(r.worker.load).toHaveBeenCalledTimes(2);
  expect(r.environment.matches(mic)).toBe(true); await r.environment.dispose();
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function watchRetirement(engine: AcousticEngine) {
  const subscribe = engine.subscribe.bind(engine), detachments: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(engine, 'subscribe').mockImplementation(listener => {
    const detach = vi.fn(subscribe(listener)); detachments.push(detach); return detach;
  });
  return detachments;
}
it('LEASED handoff waits for the attempt to dispose its own lease, without stealing ownership', async () => {
  const r = rig(); await r.environment.requalify(mic);
  const engine = r.platform.createEngine.mock.results[0].value, lease = await r.environment.acquireInference(new AbortController().signal);
  const ownerDispose = vi.fn(() => lease.dispose());
  const engineDispose = vi.spyOn(engine, 'dispose'), detachments = watchRetirement(engine);
  const endCalls = r.worker.endSession.mock.calls.length, states: string[] = [];
  r.environment.subscribe(() => states.push(r.environment.snapshot().status));
  let settled = false; const qualification = r.environment.requalify(mic).then(() => { settled = true; });
  await vi.waitFor(() => expect(detachments).toHaveLength(1));
  expect(r.platform.probe).toHaveBeenCalledTimes(2); expect(engine.snapshot().state).toBe('LEASED');
  expect(settled).toBe(false); expect(r.environment.snapshot()).toMatchObject({status:'CHECKING', reason:null});
  expect(ownerDispose).not.toHaveBeenCalled(); expect(engineDispose).not.toHaveBeenCalled();
  expect(r.worker.endSession).toHaveBeenCalledTimes(endCalls); expect(r.worker.dispose).not.toHaveBeenCalled(); expect(r.worker.terminate).not.toHaveBeenCalled();
  expect(r.worker.beginSession).toHaveBeenCalledTimes(2); // Initial smoke + the original attempt; no second lease.
  await ownerDispose(); await qualification;
  expect(ownerDispose).toHaveBeenCalledOnce(); expect(r.worker.endSession).toHaveBeenCalledTimes(endCalls + 1);
  expect(engine.snapshot().state).toBe('READY_IDLE'); expect(r.environment.matches(mic)).toBe(true);
  expect(states).not.toContain('BLOCKED'); expect(detachments[0]).toHaveBeenCalledOnce();
  expect(r.platform.createEngine).toHaveBeenCalledOnce(); expect(r.platform.modelUrl).toHaveBeenCalledOnce(); expect(r.worker.load).toHaveBeenCalledOnce();
  await r.environment.dispose();
});
it('RETIRING deferred endSession keeps qualification CHECKING and reuses the same warm engine', async () => {
  const r = rig(); await r.environment.requalify(mic);
  const engine = r.platform.createEngine.mock.results[0].value, lease = await r.environment.acquireInference(new AbortController().signal);
  const end = deferred<void>(); r.worker.endSession.mockImplementationOnce(() => end.promise);
  const retirement = lease.dispose(); await vi.waitFor(() => expect(engine.snapshot().state).toBe('RETIRING'));
  const detachments = watchRetirement(engine), states: string[] = [];
  r.environment.subscribe(() => states.push(r.environment.snapshot().status));
  let settled = false; const qualification = r.environment.requalify(mic).then(() => { settled = true; });
  await vi.waitFor(() => expect(detachments).toHaveLength(1));
  expect(r.platform.probe).toHaveBeenCalledTimes(2); expect(settled).toBe(false);
  expect(r.environment.snapshot()).toMatchObject({status:'CHECKING', reason:null}); expect(states).not.toContain('BLOCKED');
  expect(r.platform.createEngine).toHaveBeenCalledOnce(); expect(r.platform.modelUrl).toHaveBeenCalledOnce(); expect(r.worker.load).toHaveBeenCalledOnce();
  end.resolve(); await retirement; await qualification;
  expect(engine.snapshot().state).toBe('READY_IDLE'); expect(r.environment.matches(mic)).toBe(true);
  expect(detachments[0]).toHaveBeenCalledOnce(); expect(states).not.toContain('BLOCKED');
  expect(r.platform.createEngine).toHaveBeenCalledOnce(); expect(r.worker.load).toHaveBeenCalledOnce();
  await r.environment.dispose();
});
for (const replacementFails of [false, true]) it(`real failure during retirement is transaction-owned; replacement failure=${replacementFails}`, async () => {
  const r = rig(); await r.environment.requalify(mic);
  const engine = r.platform.createEngine.mock.results[0].value, lease = await r.environment.acquireInference(new AbortController().signal);
  const end = deferred<void>(), load = deferred<object>();
  r.worker.endSession.mockImplementationOnce(() => end.promise);
  r.worker.terminate.mockImplementationOnce(() => { end.reject(new Error('ACOUSTIC_WORKER_CRASH')); });
  if (replacementFails) r.worker.load.mockImplementationOnce(() => load.promise);
  const retirement = lease.dispose().catch(() => {}), detachments = watchRetirement(engine);
  const states: string[] = [];
  r.environment.subscribe(() => states.push(r.environment.snapshot().status));
  const qualification = r.environment.requalify(mic);
  await vi.waitFor(() => expect(detachments).toHaveLength(1));
  r.crash();
  if (replacementFails) {
    await vi.waitFor(() => expect(r.worker.load).toHaveBeenCalledTimes(2));
    expect(r.environment.snapshot()).toMatchObject({status:'CHECKING', reason:null}); expect(states).not.toContain('BLOCKED');
    load.reject(new Error('REPLACEMENT_LOAD_FAILED'));
  }
  await retirement; await qualification;
  expect(detachments[0]).toHaveBeenCalledOnce();
  expect(r.platform.probe).toHaveBeenCalledTimes(2); expect(r.platform.createEngine).toHaveBeenCalledTimes(2);
  expect(r.platform.modelUrl).toHaveBeenCalledTimes(2); expect(r.worker.load).toHaveBeenCalledTimes(2);
  if (replacementFails) {
    expect(r.environment.snapshot()).toMatchObject({status:'BLOCKED', reason:'REPLACEMENT_LOAD_FAILED'});
    expect(states.filter(state => state === 'BLOCKED')).toHaveLength(1);
  } else { expect(r.environment.matches(mic)).toBe(true); expect(states).not.toContain('BLOCKED'); }
  await r.environment.dispose();
});
it('disposing the Environment aborts and detaches its wait without a later READY or dangling qualification', async () => {
  const r = rig(); await r.environment.requalify(mic);
  const engine = r.platform.createEngine.mock.results[0].value, lease = await r.environment.acquireInference(new AbortController().signal);
  const end = deferred<void>(); r.worker.endSession.mockImplementationOnce(() => end.promise);
  const retirement = lease.dispose(), detachments = watchRetirement(engine), states: string[] = [];
  r.environment.subscribe(() => states.push(r.environment.snapshot().status));
  const qualification = r.environment.requalify(mic);
  await vi.waitFor(() => expect(detachments).toHaveLength(1));
  const disposed = r.environment.dispose();
  await qualification; expect(detachments[0]).toHaveBeenCalledOnce();
  expect(states).not.toContain('READY'); expect(states).not.toContain('BLOCKED');
  end.resolve(); await retirement; await disposed;
  expect(r.environment.snapshot().status).toBe('UNCONFIGURED'); expect(states).not.toContain('READY');
  expect(r.platform.createEngine).toHaveBeenCalledOnce(); expect(r.worker.dispose).toHaveBeenCalledOnce();
  await expect(r.environment.requalify(mic)).rejects.toThrow('PRACTICE_ENVIRONMENT_DISPOSED');
});
