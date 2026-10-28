import { borrowedDevices } from '@/lib/practice/__fixtures__/device-roots';
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { ContinuousPracticeController, type ContinuousControllerSnapshot } from '@/lib/practice/continuous/continuous-practice-controller';
import { continuousCompletionStore } from '@/lib/practice/continuous/completion-store';
import type { UseLocalPracticeOptions } from './use-local-practice';
import { useContinuousLocalPractice } from './use-continuous-local-practice';
import { PracticeResourceCoordinator } from './practice-resource-coordinator';

const artifact = artifactJson as PracticeScoreArtifact;
const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
const options: UseLocalPracticeOptions = { getDevices: () => borrowedDevices(),
  artifact, mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', scope: { kind: 'FULL' },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function ownerMocks() {
  let snapshot: ContinuousControllerSnapshot = {
    session: 'PREPARING', transport: null, analysis: 'NOT_REQUIRED', analysisIntervention: null, resourceIntervention: null, analysisError: null,
    inputError: null, recording: null, evaluation: null, completed: null, sessionSnapshot: null,
  };
  const listeners = new Set<() => void>(), events: string[] = [];
  const unsubscribe = vi.fn(() => { events.push('unsubscribe'); listeners.clear(); });
  const subscribe = vi.spyOn(ContinuousPracticeController.prototype, 'subscribe').mockImplementation(listener => {
    listeners.add(listener); return unsubscribe;
  });
  const snapshots = vi.spyOn(ContinuousPracticeController.prototype, 'snapshot').mockImplementation(() => snapshot);
  const start = vi.spyOn(ContinuousPracticeController.prototype, 'start').mockResolvedValue();
  const dispose = vi.spyOn(ContinuousPracticeController.prototype, 'dispose').mockImplementation(async () => { events.push('dispose'); });
  const refresh = vi.spyOn(ContinuousPracticeController.prototype, 'refresh').mockImplementation(() => {});
  return { start, dispose, subscribe, unsubscribe, snapshots, refresh, events,
    publish(next: ContinuousControllerSnapshot) { snapshot = next; listeners.forEach(listener => listener()); },
    snapshot: () => snapshot };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('owns one controller, subscription, RAF and commands, and releases the subscription before disposal', async () => {
  const owner = ownerMocks();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => frames.push(callback)));
  const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel);
  const pause = vi.spyOn(ContinuousPracticeController.prototype, 'pause').mockImplementation(() => {});
  const resume = vi.spyOn(ContinuousPracticeController.prototype, 'resume').mockImplementation(() => {});
  const finish = vi.spyOn(ContinuousPracticeController.prototype, 'abandon').mockResolvedValue();
  const metronome = vi.spyOn(ContinuousPracticeController.prototype, 'setMetronomeEnabled').mockImplementation(() => {});
  const barrier = new PracticeResourceCoordinator();
  const { result, unmount } = renderHook(() => useContinuousLocalPractice(options, tempoPlan, barrier, () => continuousCompletionStore.clearCompletion()));
  await act(async () => { await result.current.start(); await result.current.start(); });
  expect(owner.start).toHaveBeenCalledOnce(); expect(owner.subscribe).toHaveBeenCalledOnce();
  expect(owner.subscribe.mock.contexts[0]).toBe(owner.start.mock.contexts[0]);
  expect(result.current).toMatchObject({ mode: 'CONTINUOUS_PLAY', lifecycle: 'READY', inputState: 'STARTING', inputError: null });
  const transport = { state: 'RUNNING' as const, countInKind: null, nowMs: 4000, musicalBeat: 2, performanceTimeMs: 1250,
    countInTotalMs: 2000, countInRemainingMs: 0, countInBeats: 4, countInPulses: 4, countInPulse: 1,
    scopeCompleted: false, scopeStartBeat: 0, scopeTerminalBeat: artifact.scoreEndBeat, completionReason: null };
  act(() => owner.publish({ ...owner.snapshot(), session: 'ACTIVE', transport }));
  expect(result.current).toMatchObject({ lifecycle: 'ACTIVE', inputState: 'RUNNING', performanceClock: transport,
    activeStepGroup: null, recordingIndicator: null, resolvedTempoPlan: tempoPlan });
  act(() => frames.shift()!(0)); expect(owner.refresh).toHaveBeenCalledOnce();
  await act(async () => { await result.current.pause(); await result.current.resume(); await result.current.abandon(); });
  act(() => result.current.setMetronomeEnabled(true));
  expect(pause).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce(); expect(finish).toHaveBeenCalledOnce();
  expect(metronome).toHaveBeenCalledWith(true);
  unmount(); await barrier.waitForRelease();
  expect(owner.unsubscribe).toHaveBeenCalledOnce(); expect(owner.dispose).toHaveBeenCalledOnce();
  expect(owner.events).toEqual(['unsubscribe', 'dispose']); expect(cancel).toHaveBeenCalledOnce();
});

it.each(['unmount', 'input change'] as const)('awaits late preparation after %s without reviving stale ownership', async invalidation => {
  const owner = ownerMocks(), preparation = deferred(), release = deferred();
  owner.start.mockReturnValueOnce(preparation.promise);
  owner.dispose.mockReturnValueOnce(release.promise);
  const barrier = new PracticeResourceCoordinator();
  const { result, rerender, unmount } = renderHook(props => useContinuousLocalPractice(props, tempoPlan, barrier, () => continuousCompletionStore.clearCompletion()),
    { initialProps: options });
  let starting!: Promise<void>;
  await act(async () => { starting = result.current.start(); });
  expect(owner.start).toHaveBeenCalledOnce();
  await act(async () => { await result.current.start(); });
  expect(owner.start).toHaveBeenCalledOnce();
  if (invalidation === 'unmount') unmount();
  else rerender({ ...options, inputSource: 'MICROPHONE' });
  expect(owner.unsubscribe).toHaveBeenCalledOnce(); expect(owner.dispose).toHaveBeenCalledOnce();
  let released = false;
  const waiting = barrier.waitForRelease().then(() => { released = true; });
  await act(async () => { release.resolve(); });
  expect(released).toBe(false);
  const snapshotReads = owner.snapshots.mock.calls.length;
  await act(async () => { preparation.resolve(); await starting; await waiting; });
  expect(released).toBe(true);
  expect(owner.snapshots).toHaveBeenCalledTimes(snapshotReads);
  expect(owner.start).toHaveBeenCalledOnce();
  if (invalidation === 'input change') {
    expect(result.current).toMatchObject({ lifecycle: 'READY', inputState: 'IDLE', performanceClock: null });
    await act(async () => { await result.current.pause(); await result.current.abandon(); });
    unmount(); expect(owner.dispose).toHaveBeenCalledOnce();
  }
});

it('restart waits for disposal and preparation, then clears completed truth and creates a fresh owner', async () => {
  const owner = ownerMocks(), preparation = deferred(), release = deferred();
  owner.start.mockReturnValueOnce(preparation.promise);
  owner.dispose.mockReturnValueOnce(release.promise);
  const clear = vi.spyOn(continuousCompletionStore, 'clearCompletion');
  const barrier = new PracticeResourceCoordinator();
  const { result, unmount } = renderHook(() => useContinuousLocalPractice(options, tempoPlan, barrier, () => continuousCompletionStore.clearCompletion()));
  let starting!: Promise<void>, restarting!: Promise<void>;
  await act(async () => { starting = result.current.start(); });
  expect(clear).toHaveBeenCalledOnce(); clear.mockClear();
  const first = owner.start.mock.contexts[0];
  act(() => owner.publish({ ...owner.snapshot(), session: 'ACTIVE', analysis: 'INTERRUPTED', analysisError: 'ANALYSIS_FAILED', analysisIntervention: { pauseOrigin: 'INTERVENTION' } }));
  const stalePublish = owner.subscribe.mock.calls[0][0];
  await act(async () => { restarting = result.current.restart(); });
  expect(owner.dispose).toHaveBeenCalledOnce(); expect(owner.start).toHaveBeenCalledOnce();
  expect(clear).not.toHaveBeenCalled();
  await act(async () => { preparation.resolve(); await starting; });
  expect(owner.start).toHaveBeenCalledOnce(); expect(clear).not.toHaveBeenCalled();
  await act(async () => { release.resolve(); await restarting; });
  expect(clear).toHaveBeenCalledOnce(); expect(owner.start).toHaveBeenCalledTimes(2);
  expect(owner.start.mock.contexts[1]).not.toBe(first);
  expect(owner.subscribe).toHaveBeenCalledTimes(2);
  expect(owner.subscribe.mock.contexts[1]).toBe(owner.start.mock.contexts[1]);
  const reads = owner.snapshots.mock.calls.length;
  act(() => stalePublish());
  expect(owner.snapshots).toHaveBeenCalledTimes(reads);
  unmount(); await barrier.waitForRelease();
  expect(owner.dispose).toHaveBeenCalledTimes(2); expect(owner.unsubscribe).toHaveBeenCalledTimes(2);
});

it('uses the latest completion callback and metronome option without replacing the owner', async () => {
  const owner = ownerMocks(), first = vi.fn(), latest = vi.fn();
  const metronome = vi.spyOn(ContinuousPracticeController.prototype, 'setMetronomeEnabled').mockImplementation(() => {});
  const barrier = new PracticeResourceCoordinator();
  const { result, rerender, unmount } = renderHook(props => useContinuousLocalPractice(props, tempoPlan, barrier, () => continuousCompletionStore.clearCompletion()),
    { initialProps: { ...options, onNaturalCompletion: first, metronomeEnabled: false } });
  await act(async () => { await result.current.start(); });
  const controller = owner.start.mock.contexts[0] as ContinuousPracticeController;
  // Simulate the controller's completion notification at its existing callback boundary.
  const completion = Reflect.get(controller, 'options').onNaturalCompletion;
  rerender({ ...options, onNaturalCompletion: latest, metronomeEnabled: true });
  const completed = { localSessionId: 'latest-completion', completionReason: 'SCOPE_COMPLETED' };
  act(() => completion(completed));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledExactlyOnceWith(completed);
  expect(owner.start).toHaveBeenCalledOnce(); expect(owner.dispose).not.toHaveBeenCalled();
  expect(metronome).toHaveBeenLastCalledWith(true);
  unmount(); await barrier.waitForRelease();
});

it('does not restore a previous snapshot when an input identity is revisited', async () => {
  const owner = ownerMocks(), barrier = new PracticeResourceCoordinator();
  const { result, rerender, unmount } = renderHook(props => useContinuousLocalPractice(props, tempoPlan, barrier, () => continuousCompletionStore.clearCompletion()),
    { initialProps: options });
  await act(async () => { await result.current.start(); });
  const stalePublish = owner.subscribe.mock.calls[0][0];
  act(() => owner.publish({ ...owner.snapshot(), inputError: 'PREVIOUS_OWNER' }));
  expect(result.current.inputError).toBe('PREVIOUS_OWNER');
  rerender({ ...options, inputSource: 'MICROPHONE' });
  expect(result.current.inputState).toBe('IDLE');
  rerender(options);
  act(() => stalePublish());
  expect(result.current).toMatchObject({ lifecycle: 'READY', inputState: 'IDLE', inputError: null, performanceClock: null });
  expect(owner.start).toHaveBeenCalledOnce();
  unmount(); await barrier.waitForRelease();
});

it.each(['input', 'scope', 'artifact'] as const)('rejects the old subscription during a %s identity commit before passive cleanup', async change => {
  const owner = ownerMocks(), barrier = new PracticeResourceCoordinator();
  let requestPublication = false, published = false;
  const clean = { inputState: 'IDLE', inputError: null, performanceClock: null, isFinalizingPerformance: false };
  const { result, rerender, unmount } = renderHook(props => {
    const practice = useContinuousLocalPractice(props, tempoPlan, barrier, () => continuousCompletionStore.clearCompletion());
    // Layout runs after B's binding commits but before A's passive unsubscribe.
    // Keep the actual captured callback so cleanup cannot erase the queued publication.
    useLayoutEffect(() => {
      if (!requestPublication || published) return;
      published = true;
      expect(practice).toMatchObject(clean);
      expect(owner.unsubscribe).not.toHaveBeenCalled();
      const stalePublish = owner.subscribe.mock.calls[0][0];
      stalePublish();
    });
    return practice;
  }, { initialProps: options });
  await act(async () => { await result.current.start(); });
  act(() => owner.publish({ ...owner.snapshot(), session: 'FINALIZING', inputError: 'OWNER_A_ERROR' }));
  expect(result.current).toMatchObject({ inputError: 'OWNER_A_ERROR', isFinalizingPerformance: true });
  const next: UseLocalPracticeOptions = change === 'input' ? { ...options, inputSource: 'MICROPHONE' }
    : change === 'artifact' ? { ...options, artifact: { ...artifact } }
    : { ...options, scope: { kind: 'RANGE', startGroupId: artifact.expectedPracticeGroups[0].groupId,
      endGroupId: artifact.expectedPracticeGroups.at(-1)!.groupId } };
  requestPublication = true;
  rerender(next);
  expect(published).toBe(true);
  expect(result.current).toMatchObject(clean);
  expect(owner.events).toEqual(['unsubscribe', 'dispose']);
  unmount(); await barrier.waitForRelease();
});

it('exposes only analysis choice commands and keeps accepted degradation out of generic input errors', async () => {
  const owner = ownerMocks(), barrier = new PracticeResourceCoordinator();
  const choice = vi.spyOn(ContinuousPracticeController.prototype, 'continueWithoutAnalysis').mockResolvedValue();
  const { result, unmount } = renderHook(() => useContinuousLocalPractice({ ...options, inputSource: 'MICROPHONE' }, tempoPlan, barrier, () => {}));
  await act(async () => { await result.current.start(); });
  act(() => owner.publish({ ...owner.snapshot(), session: 'ACTIVE', analysis: 'INTERRUPTED', analysisError: 'ANALYSIS_FAILED',
    analysisIntervention: { pauseOrigin: 'USER' } }));
  expect(result.current.analysisIntervention).toEqual({ pauseOrigin: 'USER' }); expect(result.current.error).toBeNull();
  await act(async () => { await result.current.continueWithoutAnalysis(); }); expect(choice).toHaveBeenCalledOnce();
  act(() => owner.publish({ ...owner.snapshot(), analysis: 'DISABLED', analysisIntervention: null }));
  expect(result.current.analysisIntervention).toBeNull(); expect(result.current.inputState).not.toBe('ERROR');
  expect(result.current).not.toHaveProperty('controller'); unmount(); await barrier.waitForRelease();
});
