import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContinuousMicrophoneInput } from './continuous-microphone-input';
import type { ContinuousPlatform } from './continuous-input';
import type { ContinuousCaptureBridge } from '../acoustic/continuous/capture-bridge';
import type { ContinuousEvidencePublication } from './domain/evaluation/evidence-types';
import type { AcousticInferencePort } from '../acoustic/runtime/inference-types';
import { ManualClock } from '../kernel/timebase';
import { SourceAnalysisRuntime } from '../acoustic/runtime/source-analysis-runtime';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** Real bridge/source/FIR geometry, deterministic PCM and inference; no qualification claims. */
function rig() {
  const context = { currentTime: 0, sampleRate: 48000 }, stream = {} as MediaStream;
  const publications: ContinuousEvidencePublication[] = [], failure = vi.fn();
  let stopped!: () => void; const captureStopped = new Promise<void>(resolve => { stopped = resolve; }), stop = vi.fn(() => stopped());
  const clock = new ManualClock(10000), listeners = new Set<() => void>(), stale: (() => void)[] = [], detaches: ReturnType<typeof vi.fn>[] = [];
  let beforeSubscribe: (() => void) | undefined, deliver = true;
  let bridge!: ContinuousCaptureBridge, next = 0, sequence = 0, workerFailure: ((error: Error) => void) | undefined;
  let subscribed!: () => void; const subscription = new Promise<void>(resolve => { subscribed = resolve; });
  const worker: AcousticInferencePort = { run: vi.fn(async ({ window }) => ({ events: [{ targetSample: Math.ceil(window.ownedStartTarget),
    midiPitch: 60, pitch: 'C4', confidence: .8, onsetScore: .8, frameScore: .8 }], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 })),
    dispose: vi.fn(async () => {}), onFailure: listener => { workerFailure = listener; return () => { workerFailure = undefined; }; } };
  const platform: ContinuousPlatform = { midiClock: clock, acquireInference: vi.fn(async () => worker),
    createAudioContext: vi.fn(), coefficients: async () => readFileSync('public/model-assets/practice-acoustic/fir-1-3.f32'), workletUrl: '/worklet',
    createMidi: vi.fn(), createRecorder: vi.fn(), createMetronome: vi.fn(), connectCapture: async options => {
      bridge = options.bridge;
      const subscribe = bridge.subscribeReadiness.bind(bridge);
      vi.spyOn(bridge, 'subscribeReadiness').mockImplementation(listener => {
        beforeSubscribe?.();
        listeners.add(listener); stale.push(listener);
        const detach = subscribe(() => { if (deliver) listener(); }), remove = vi.fn(() => { listeners.delete(listener); detach(); });
        detaches.push(remove); subscribed(); return remove;
      });
      return { stop };
    } };
  const input = new ContinuousMicrophoneInput(platform, failure), abort = new AbortController();
  const feed = (end: number) => {
    while (next < end) {
      const start = next; next = Math.min(end, start + 2048);
      bridge.receive({ type: 'pcm-chunk', sequence: sequence++, sourceSampleRateHz: 48000,
        sourceStartSampleIndex: start, sourceEndSampleIndex: next, audioContextStartFrame: start,
        captureTimeSeconds: start / 48000, inputChannelCount: 1, samples: new Float32Array(next - start) });
    }
    context.currentTime = next / 48000;
  };
  const connect = async () => {
    await input.acquire(abort.signal);
    const connecting = input.connect({ context: context as AudioContext, stream, sessionDomainId: 'readiness', clock,
      publish: p => { publications.push(p); } }, abort.signal);
    await subscription; return { connecting };
  };
  const ready = async () => { const { connecting } = await connect(); feed(88064); await connecting; };
  const terminal = () => {
    const origin = next;
    input.boundary('BEGIN', origin / 48000, 0); input.boundary('TERMINAL', origin / 48000 + .1, 100);
    feed(origin + 4800); return origin;
  };
  const cleanWait = () => { expect(listeners.size).toBe(0); for (const detach of detaches) expect(detach).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); };
  return { input, abort, context, worker, clock, publications, failure, stop, listeners, stale, detaches, connect, ready, terminal, feed,
    bridge: () => bridge, captureStopped, captureConnected: subscription, cleanWait, duringSubscribe: (callback: () => void) => { beforeSubscribe = callback; },
    suppressNotifications: () => { deliver = false; }, workerFailure: () => workerFailure?.(new Error('ACOUSTIC_WORKER_RPC_TIMEOUT')) };
}

it.each([184, 185])('Continuous retains the :capture composition for session length%i', async length => {
  const r = rig(), sourceCreate = vi.spyOn(SourceAnalysisRuntime, 'create'), sessionDomainId = 's'.repeat(length);
  await r.input.acquire(r.abort.signal);
  const connecting = r.input.connect({ context: r.context as AudioContext, stream: {} as MediaStream,
    sessionDomainId, clock: r.clock, publish: vi.fn() }, r.abort.signal);
  try {
    if (length === 184) {
      await r.captureConnected; r.feed(88064); await connecting;
      expect(r.bridge().runtime.prerollReady).toBe(true);
    } else {
      await expect(connecting).rejects.toThrow('INVALID_ACOUSTIC_DOMAIN');
      expect(r.bridge()).toBeUndefined();
    }
    expect(sourceCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sourceDomainId: `${sessionDomainId}:capture` }));
    expect(`${sessionDomainId}:capture`.length).toBe(length + 8);
  } finally { await r.input.dispose(); }
});

it('preroll wakes at the real PCM threshold with one deadline and no periodic timer', async () => {
  const r = rig(), timer = vi.spyOn(globalThis, 'setTimeout');
  const { connecting } = await r.connect(); let connected = false; const observed = connecting.then(() => { connected = true; });
  try {
    expect(timer.mock.calls.map(call => call[1])).toEqual([15000]); expect(vi.getTimerCount()).toBe(1);
    r.feed(79229); await Promise.resolve(); expect(r.bridge().runtime.prerollReady).toBe(false); expect(connected).toBe(false);
    r.feed(79230); expect(r.bridge().runtime.prerollReady).toBe(true); expect(connected).toBe(false); // Promise continuation waits for capture stack unwind.
    await observed; expect(connected).toBe(true); expect(r.bridge().snapshot()).toMatchObject({ nextSourceSampleIndex: 79230, audioContextOriginFrame: 0 });
    expect(timer.mock.calls.some(call => call[1] === 5)).toBe(false); r.cleanWait(); expect(r.failure).not.toHaveBeenCalled();
  } finally { await r.input.dispose(); }
});

it('snapshot-subscribe-recheck notices readiness committed before the listener is installed', async () => {
  const r = rig(); r.duringSubscribe(() => r.feed(88064));
  try { const { connecting } = await r.connect(); await connecting; expect(r.bridge().runtime.prerollReady).toBe(true); r.cleanWait(); }
  finally { await r.input.dispose(); }
});

it('tail notification wakes readiness immediately; subsequent inference drain remains a separate owner', async () => {
  const r = rig(), timer = vi.spyOn(globalThis, 'setTimeout'); await r.ready();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(r.worker.run).mockImplementation(async ({ window }) => { await gate; return { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: window.jobIndex + 1 }; });
  try {
    const origin = r.terminal(); expect(r.bridge().runtime.tailReady).toBe(false);
    let finished = false; const finishing = r.input.finish(r.abort.signal).then(() => { finished = true; });
    expect(r.listeners.size).toBe(1); expect(timer.mock.calls.map(call => call[1])).toEqual([15000, 60000]);
    r.feed(origin + 14336); expect(r.bridge().runtime.tailReady).toBe(true);
    r.cleanWait(); await r.captureStopped; expect(r.stop).toHaveBeenCalledOnce(); expect(finished).toBe(false);
    expect(r.bridge().runtime.snapshot().outstanding).toBeGreaterThan(0); expect(r.publications).toHaveLength(0);
    release(); await finishing; expect(finished).toBe(true); expect(r.publications.at(-1)?.analyzedThroughPerformanceMs).toBe(100);
    expect(timer.mock.calls.some(call => call[1] === 5)).toBe(false); expect(r.failure).not.toHaveBeenCalled();
  } finally { release(); await r.input.dispose(); }
});

it('TERMINAL applied at current source wakes tail readiness even without another PCM receive', async () => {
  const r = rig(); await r.ready();
  try {
    let finished = false; const finishing = r.input.finish(r.abort.signal).then(() => { finished = true; });
    expect(r.listeners.size).toBe(1); expect(r.bridge().runtime.tailReady).toBe(false);
    r.input.boundary('TERMINAL', r.context.currentTime, 0);
    expect(r.bridge().runtime.tailReady).toBe(true); expect(finished).toBe(false);
    await finishing; r.cleanWait(); expect(r.publications.at(-1)?.analyzedThroughPerformanceMs).toBe(0);
  } finally { await r.input.dispose(); }
});

for (const phase of ['preroll', 'tail'] as const) it(`${phase} deadline fails at the existing safety window and detaches all observation`, async () => {
  const r = rig(); let operation: Promise<void>;
  if (phase === 'preroll') operation = (await r.connect()).connecting;
  else { await r.ready(); r.terminal(); operation = r.input.finish(r.abort.signal); }
  const failure = vi.fn(), observed = operation.catch(failure), timeout = phase === 'preroll' ? 15000 : 60000;
  try {
    await vi.advanceTimersByTimeAsync(timeout - 1); expect(failure).not.toHaveBeenCalled(); expect(r.listeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1); await observed;
    expect(failure).toHaveBeenCalledOnce(); expect(failure.mock.calls[0][0].message).toBe('CONTINUOUS_ANALYSIS_TIMEOUT'); r.cleanWait();
    const count = r.publications.length; r.stale.forEach(listener => listener()); expect(failure).toHaveBeenCalledOnce(); expect(r.publications).toHaveLength(count);
    expect(r.publications.some(p => p.publicationId.endsWith(':terminal'))).toBe(false);
  } finally { await r.input.dispose(); }
});

for (const phase of ['preroll', 'tail'] as const) it(`${phase} readiness wins a delayed deadline callback that rechecks committed truth`, async () => {
  const r = rig(), original = globalThis.setTimeout; let delayed!: () => void;
  const timeout = phase === 'preroll' ? 15000 : 60000;
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (delay === timeout) { delayed = callback as () => void; return original(() => {}, delay); }
    return original(callback, delay, ...args);
  });
  let operation: Promise<void>, origin = 0;
  if (phase === 'preroll') operation = (await r.connect()).connecting;
  else { await r.ready(); origin = r.terminal(); operation = r.input.finish(r.abort.signal); }
  const notify = [...r.listeners][0];
  // Suppress delivery at the existing subscription seam to exercise deadline's own predicate recheck.
  r.suppressNotifications();
  try {
    await vi.advanceTimersByTimeAsync(timeout + 100); r.feed(phase === 'preroll' ? 88064 : origin + 14336);
    delayed(); await operation; expect(r.failure).not.toHaveBeenCalled();
    delayed(); notify(); r.cleanWait();
  } finally { await r.input.dispose(); timer.mockRestore(); }
});

for (const phase of ['preroll', 'tail'] as const) for (const event of ['abort', 'dispose', 'worker', 'source'] as const) {
  it(`${phase} ${event} promptly settles once and clears listeners, abort hooks and deadline`, async () => {
    const r = rig(), add = vi.spyOn(r.abort.signal, 'addEventListener'), remove = vi.spyOn(r.abort.signal, 'removeEventListener');
    let operation: Promise<void>;
    if (phase === 'preroll') operation = (await r.connect()).connecting;
    else { await r.ready(); r.terminal(); operation = r.input.finish(r.abort.signal); }
    const rejected = vi.fn(), observed = operation.catch(rejected);
    try {
      if (event === 'abort') r.abort.abort();
      else if (event === 'dispose') await r.input.dispose();
      else if (event === 'worker') r.workerFailure();
      else r.bridge().runtime.failAnalysis(new Error('SOURCE_TEST_FAILURE'));
      await observed; expect(rejected).toHaveBeenCalledOnce();
      expect(rejected.mock.calls[0][0].message).toBe(event === 'worker' ? 'ACOUSTIC_WORKER_RPC_TIMEOUT'
        : event === 'source' ? 'SOURCE_TEST_FAILURE' : 'CONTINUOUS_PREPARATION_CANCELLED');
      r.cleanWait();
      for (const call of add.mock.calls.filter(call => call[0] === 'abort')) expect(remove.mock.calls.some(removed => removed[0] === 'abort' && removed[1] === call[1])).toBe(true);
      r.stale.forEach(listener => listener()); r.abort.abort(); r.input.fail('LATER_FAILURE');
      await vi.advanceTimersByTimeAsync(120000); expect(rejected).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
      if (event === 'worker' || event === 'source') expect(r.input.snapshot().failure).toBe(event === 'worker' ? 'ACOUSTIC_WORKER_RPC_TIMEOUT' : 'SOURCE_TEST_FAILURE');
    } finally { await r.input.dispose(); }
  });
}
