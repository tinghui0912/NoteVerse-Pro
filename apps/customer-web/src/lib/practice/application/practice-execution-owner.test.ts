import { beforeEach, expect, it, vi } from 'vitest';
import { PracticeExecutionOwner, type PracticeExecutionFactories } from './practice-execution-owner';
import { continuousSessionPlan, stepSessionPlan } from '../__fixtures__/session-plan';
import { rootHealthFixture } from '../__fixtures__/root-health';
import { borrowedDevices } from '../__fixtures__/device-roots';
import { canonicalContinuousResultFixture } from '../__fixtures__/continuous-result';
import artifactJson from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../kernel/artifact';
import { continuousCompletionStore } from '../continuous/completion-store';
import * as stepPlatform from '../step/step-platform';
import * as continuousPlatform from '../continuous/continuous-platform';
import { ManualClock } from '../kernel/timebase';

const artifact = artifactJson as PracticeScoreArtifact;
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { continuousCompletionStore.clearCompletion(); vi.restoreAllMocks(); });
function rig(mode: 'STEP_BY_STEP' | 'CONTINUOUS_PLAY' = 'STEP_BY_STEP') {
  const health = rootHealthFixture(), created: { options: Parameters<PracticeExecutionFactories['step']>[0] | Parameters<PracticeExecutionFactories['continuous']>[0];
    controller: ReturnType<PracticeExecutionFactories['step']> & ReturnType<PracticeExecutionFactories['continuous']>;
    emit(): void; complete(): void; stale(): void; disposeGate: ReturnType<typeof deferred> | null; startGate: ReturnType<typeof deferred> | null }[] = [];
  const create = (options: Parameters<PracticeExecutionFactories['step']>[0] | Parameters<PracticeExecutionFactories['continuous']>[0]) => {
    let state = 'IDLE', session = 'IDLE', detachHealth: (() => void) | undefined;
    const subscribers = new Set<() => void>();
    const savedCallbacks: (() => void)[] = [];
    let disposed = false;
    const result = canonicalContinuousResultFixture();
    const sessionSnapshot = { completionReason: 'SCOPE_COMPLETED' as const, localSessionId: `session-${created.length}` };
    const item = { options, controller: null as never, emit: () => subscribers.forEach(f => f()),
      complete: () => { state = 'ENDED'; session = 'COMPLETE'; item.emit(); options.onNaturalCompletion?.(sessionSnapshot as never); },
      stale: () => { savedCallbacks.forEach(f => f()); options.onNaturalCompletion?.(sessionSnapshot as never); },
      disposeGate: null as ReturnType<typeof deferred> | null, startGate: null as ReturnType<typeof deferred> | null };
    const controller = {
      start: vi.fn(async () => { state = 'PREPARING'; session = 'PREPARING'; item.emit();
        detachHealth = health.port.subscribe(() => {}); await item.startGate?.promise;
        if (!disposed) { state = 'ACTIVE'; session = 'ACTIVE'; item.emit(); } }),
      dispose: vi.fn(async () => { disposed = true; detachHealth?.(); state = 'DISPOSED'; session = 'DISPOSED'; await item.disposeGate?.promise; }),
      abandon: vi.fn(async () => {}), subscribe: vi.fn((f: () => void) => { subscribers.add(f); savedCallbacks.push(f); return () => subscribers.delete(f); }),
      snapshot: () => options.plan.mode === 'STEP_BY_STEP'
        ? { state, error: null, analysisIntervention: null, infrastructureIntervention: null, stepInteractionPhase: 'READY', canAcceptAttempt: true,
          pendingPostVerdict: null, activeStepGroup: options.plan.artifact.moments[options.plan.scope.startIndex], sessionSnapshot, lastSnapshot: sessionSnapshot }
        : { session, transport: session === 'ACTIVE' ? { state: 'RUNNING', performanceTimeMs: 5 } : null, analysis: 'NOT_REQUIRED', inputError: null,
          recording: null, evaluation: null, analysisIntervention: null, resourceIntervention: null, completed: session === 'COMPLETE' ? { result, recording: { status: 'NOT_RECORDED' } } : null },
      setMetronomeEnabled: vi.fn(), skip: vi.fn(), pause: vi.fn(), resume: vi.fn(), continueWithoutAnalysis: vi.fn(async () => {}),
      continueWithoutRecording: vi.fn(), continueAfterRecovery: vi.fn(() => true),
    } as unknown as ReturnType<PracticeExecutionFactories['step']> & ReturnType<PracticeExecutionFactories['continuous']>;
    Object.assign(item, { controller }); created.push(item); return controller;
  };
  const factories: PracticeExecutionFactories = { step: vi.fn(create), continuous: vi.fn(create) };
  const borrowRoots = vi.fn(() => borrowedDevices()), acquireInference = vi.fn();
  const owner = new PracticeExecutionOwner({ borrowRoots, rootHealth: health.port, acquireInference }, factories);
  const plan = mode === 'STEP_BY_STEP' ? stepSessionPlan(artifact) : continuousSessionPlan(artifact);
  owner.setCandidate(plan, true, 'score/revision');
  return { owner, health, created, factories, plan, borrowRoots, acquireInference };
}
it.each(['STEP_BY_STEP', 'CONTINUOUS_PLAY'] as const)('%s READY has no controller, subscription or resource use', async mode => {
  const r = rig(mode); expect(r.owner.snapshot()).toMatchObject({ mode, lifecycle: 'READY', executedPlan: null, canStart: true });
  expect(r.created).toHaveLength(0); expect(r.health.listenerCount()).toBe(0); expect(r.acquireInference).not.toHaveBeenCalled();
  expect(r.borrowRoots).not.toHaveBeenCalled();
  const first = r.owner.start(), second = r.owner.start(); expect(second).toBe(first); await first;
  expect(r.created).toHaveLength(1); expect(r.health.listenerCount()).toBe(1);
  expect(r.factories.step).toHaveBeenCalledTimes(mode === 'STEP_BY_STEP' ? 1 : 0);
  expect(r.factories.continuous).toHaveBeenCalledTimes(mode === 'CONTINUOUS_PLAY' ? 1 : 0);
  expect(r.owner.snapshot().executedPlan).toBe(r.plan); await r.owner.dispose(); expect(r.health.listenerCount()).toBe(0);
});
it('candidate edits change only pre-Start intent and active execution keeps its captured plan', async () => {
  const r = rig(), scope = { kind: 'RANGE' as const, startGroupId: artifact.moments[1].groupId, endGroupId: artifact.moments[2].groupId };
  const latest = stepSessionPlan(artifact, { scope, tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 }, metronomeEnabled: true });
  r.owner.setCandidate(latest, true, 'score/revision'); expect(r.created).toHaveLength(0);
  await r.owner.start(); expect(r.created[0].options.plan).toBe(latest);
  r.owner.setCandidate(r.plan, true, 'score/revision'); r.owner.setMetronomeEnabled(false);
  expect(r.owner.snapshot().executedPlan).toBe(latest); expect(r.created).toHaveLength(1);
  expect(r.created[0].controller.setMetronomeEnabled).toHaveBeenCalledExactlyOnceWith(false);
  await r.owner.dispose();
});
it.each(['STEP_BY_STEP', 'CONTINUOUS_PLAY'] as const)('%s End returns READY; fresh Start creates a fresh owner', async mode => {
  const r = rig(mode); await r.owner.start(); const first = r.created[0];
  const ending = r.owner.end(), twice = r.owner.end(); await Promise.all([ending, twice]);
  expect(r.owner.snapshot()).toMatchObject({ lifecycle: 'READY', executedPlan: null }); expect(r.created).toHaveLength(1);
  expect(first.controller.dispose).toHaveBeenCalledOnce(); expect(r.health.listenerCount()).toBe(0);
  await r.owner.start(); expect(r.created).toHaveLength(2); expect(r.created[1].controller).not.toBe(first.controller); await r.owner.dispose();
});
it.each(['STEP_BY_STEP', 'CONTINUOUS_PLAY'] as const)('%s natural completion notifies once; double Retry directly starts one fresh attempt', async mode => {
  const r = rig(mode), completed = vi.fn(); r.owner.setCompletionListener(completed); await r.owner.start();
  const first = r.created[0]; first.complete(); first.complete();
  expect(r.owner.snapshot().lifecycle).toBe('COMPLETED'); expect(completed).toHaveBeenCalledOnce(); expect(r.created).toHaveLength(1);
  if (mode === 'CONTINUOUS_PLAY') expect(continuousCompletionStore.getCompletion()).not.toBeNull();
  first.disposeGate = deferred(); const retry = r.owner.retry(), duplicate = r.owner.retry(); expect(duplicate).toBe(retry);
  await tick(); expect(r.created).toHaveLength(1); first.disposeGate.resolve(); await retry;
  expect(r.created).toHaveLength(2); expect(continuousCompletionStore.getCompletion()).toBeNull(); expect(r.health.listenerCount()).toBe(1);
  await r.owner.dispose();
});
it('release serialization fences Start pending + End + new Start and all stale callbacks', async () => {
  const r = rig(), completion = vi.fn(); r.owner.setCompletionListener(completion);
  const create = vi.mocked(r.factories.step).getMockImplementation()!;
  vi.mocked(r.factories.step).mockImplementationOnce((...args) => { const controller = create(...args); r.created[0].startGate = deferred(); return controller; });
  const starting = r.owner.start(); await tick(); const old = r.created[0]; old.disposeGate = deferred();
  const ending = r.owner.end(); const fresh = r.owner.start(); await tick(); expect(r.created).toHaveLength(1); expect(r.health.listenerCount()).toBe(0);
  old.stale(); expect(completion).not.toHaveBeenCalled(); old.disposeGate.resolve(); await tick(); expect(r.created).toHaveLength(1);
  old.startGate!.resolve(); await Promise.all([starting, ending, fresh]); expect(r.created).toHaveLength(2);
  const snapshot = r.owner.snapshot(); old.stale(); expect(r.owner.snapshot()).toBe(snapshot); expect(completion).not.toHaveBeenCalled();
  await r.owner.dispose();
});
it('composition replacement retires the old owner; candidate-only rerenders do not', async () => {
  const r = rig(); await r.owner.start(); const first = r.created[0]; first.disposeGate = deferred();
  r.owner.setCandidate(continuousSessionPlan(artifact), true, 'another/revision');
  expect(r.owner.snapshot().lifecycle).toBe('READY'); const start = r.owner.start(); await tick(); expect(r.created).toHaveLength(1);
  first.disposeGate.resolve(); await start; expect(r.created[1].options.plan.mode).toBe('CONTINUOUS_PLAY'); await r.owner.dispose();
});
it('disposal during pending Start fences completion and waits for late preparation', async () => {
  const r = rig(); const create = vi.mocked(r.factories.step).getMockImplementation()!;
  vi.mocked(r.factories.step).mockImplementationOnce((...args) => { const result = create(...args); r.created[0].startGate = deferred(); return result; });
  const completion = vi.fn(); r.owner.setCompletionListener(completion); const start = r.owner.start(); await tick();
  let done = false; const disposed = r.owner.dispose().then(() => { done = true; }); await tick(); expect(done).toBe(false);
  r.created[0].stale(); expect(completion).not.toHaveBeenCalled(); r.created[0].startGate!.resolve(); await Promise.all([disposed, start]);
  await r.owner.start(); expect(r.created).toHaveLength(1); expect(r.health.listenerCount()).toBe(0);
});
it('an immediate End cancels Start before construction and invalid admission cannot Start or Retry', async () => {
  const r = rig(); const start = r.owner.start(); await r.owner.end(); await start; expect(r.created).toHaveLength(0);
  r.owner.setCandidate(r.plan, false, 'score/revision'); await r.owner.start(); await r.owner.retry(); expect(r.created).toHaveLength(0);
  r.owner.setCandidate(null, true, 'score/revision'); await r.owner.start(); expect(r.created).toHaveLength(0); await r.owner.dispose();
});
it('candidate editing and blocked starts preserve a Continuous handoff; a genuine STEP Start clears it', async () => {
  const r = rig(); continuousCompletionStore.setCompletion({ result: canonicalContinuousResultFixture(), recording: { status: 'NOT_RECORDED' } });
  const saved = continuousCompletionStore.getCompletion(); r.owner.setCandidate(r.plan, false, 'score/revision');
  await r.owner.start(); expect(continuousCompletionStore.getCompletion()).toBe(saved);
  r.owner.setCandidate(r.plan, true, 'score/revision'); expect(continuousCompletionStore.getCompletion()).toBe(saved);
  await r.owner.start(); expect(continuousCompletionStore.getCompletion()).toBeNull(); await r.owner.dispose();
});
it('cleanup failure remains visible and prevents overlapping replacement ownership', async () => {
  const r = rig(); await r.owner.start(); vi.mocked(r.created[0].controller.dispose).mockRejectedValueOnce(new Error('STEP_RESOURCE_CLEANUP_FAILED'));
  await r.owner.end(); expect(r.owner.snapshot()).toMatchObject({ lifecycle: 'ERROR', inputError: 'STEP_RESOURCE_CLEANUP_FAILED', canStart: false });
  await r.owner.start(); expect(r.created).toHaveLength(1); await r.owner.dispose();
});
it('real STEP explicitly starts without count-in, waits for input, and next Start has a new localSessionId', async () => {
  const clock = new ManualClock(100), health = rootHealthFixture(), metronome = { start: vi.fn(), destroy: vi.fn(), setEnabled: vi.fn(), setStepContext: vi.fn() };
  const createMidi = vi.fn(() => ({ start: vi.fn(async () => {}), refreshInputs: vi.fn(), dispose: vi.fn() }));
  const platform = vi.spyOn(stepPlatform, 'browserStepPlatform').mockReturnValue({ clock, timer: { schedule: vi.fn(), cancel: vi.fn() }, createMidi, createMetronome: () => metronome });
  const continuous = vi.spyOn(continuousPlatform, 'browserContinuousPlatform');
  const owner = new PracticeExecutionOwner({ borrowRoots: () => borrowedDevices(), rootHealth: health.port });
  owner.setCandidate(stepSessionPlan(artifact), true, 'score/revision'); expect(platform).not.toHaveBeenCalled(); expect(continuous).not.toHaveBeenCalled();
  await owner.start(); const first = owner.snapshot(); expect(first).toMatchObject({ mode: 'STEP_BY_STEP', lifecycle: 'ACTIVE', stepInteractionPhase: 'READY', performanceClock: null });
  clock.advance(100000); expect(owner.snapshot()).toBe(first); expect(health.listenerCount()).toBe(1);
  const firstId = Reflect.get(vi.mocked(platform).mock.results[0], 'value'); expect(firstId).toBeDefined();
  const controllerIds: string[] = [];
  // The actual MIDI binding's timebase carries the local session identity.
  controllerIds.push(createMidi.mock.calls.length ? (vi.mocked(createMidi).mock.calls[0] as unknown as [{ timebase: { domainId: string } }])[0].timebase.domainId : '');
  await owner.end(); expect(owner.snapshot().lifecycle).toBe('READY'); await owner.start();
  controllerIds.push((vi.mocked(createMidi).mock.calls[1] as unknown as [{ timebase: { domainId: string } }])[0].timebase.domainId);
  expect(controllerIds[1]).not.toBe(controllerIds[0]); expect(continuous).not.toHaveBeenCalled(); await owner.dispose();
});
