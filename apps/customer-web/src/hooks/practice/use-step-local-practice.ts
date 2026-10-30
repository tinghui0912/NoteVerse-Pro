'use client';
import { projectPracticeMomentView } from '@/lib/practice/score-view/moment-view';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import { browserStepPlatform } from '@/lib/practice/step/step-platform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StepPracticeController, type StepControllerState } from '@/lib/practice/step/step-practice-controller';
import type { LocalPracticeInputState } from '@/lib/practice/input-state';
import type { UseLocalPracticeOptions } from './use-local-practice';
import type { PracticeResourceCoordinator } from './practice-resource-coordinator';

/** Presentation/commands only. Every STEP resource belongs to its application owner. */
export function useStepLocalPractice(options: UseLocalPracticeOptions,
  resources: PracticeResourceCoordinator, onSessionStart: () => void) {
  const plan = options.plan?.mode === 'STEP_BY_STEP' ? options.plan : null;
  const artifact = plan?.artifact;
  const owner = useRef<StepPracticeController | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const completion = useRef(options.onNaturalCompletion);
  useEffect(() => { completion.current = options.onNaturalCompletion; }, [options.onNaturalCompletion]);
  const key = JSON.stringify([options.plan?.mode, plan?.sourceId, plan?.inputSource, plan?.recordingMode, plan?.scope, plan?.tempoPlan]);
  const [pendingBinding, setPendingBinding] = useState<Binding<boolean> | null>(null);
  type Snapshot = ReturnType<StepPracticeController['snapshot']> | null;
  type Binding<T> = { key: string; artifact: NonNullable<UseLocalPracticeOptions['plan']>['artifact'] | undefined; value: T };
  const [savedSnapshot, saveSnapshot] = useState<Binding<Snapshot> | null>(null);
  const [savedError, saveError] = useState<Binding<string | null> | null>(null);
  const snapshot = savedSnapshot?.key === key && savedSnapshot.artifact === artifact ? savedSnapshot.value : null;
  const preparationError = savedError?.key === key && savedError.artifact === artifact ? savedError.value : null;
  const setSnapshot = useCallback((value: Snapshot) => saveSnapshot({ key, artifact: artifact, value }), [key, artifact]);
  const setPreparationError = useCallback((value: string | null) => saveError({ key, artifact: artifact, value }), [key, artifact]);
  const dispose = useCallback(() => {
    generation.current++; starting.current = false;
    unsubscribe.current?.(); unsubscribe.current = null;
    const old = owner.current; owner.current = null;
    const pending = old?.dispose();
    return resources.trackRelease(pending);
  }, [resources]);
  useEffect(() => () => { void dispose(); }, [key, artifact, dispose]);
  useEffect(() => { owner.current?.setMetronomeEnabled(plan?.metronomeInitiallyEnabled ?? false); }, [plan?.metronomeInitiallyEnabled]);
  const start = useCallback(async () => {
    if (starting.current || (owner.current && ['PREPARING', 'ACTIVE'].includes(owner.current.snapshot().state))) return;
    if (!plan) { setPreparationError('STEP_SCORE_UNAVAILABLE'); return; }
    const released = dispose(), operation = generation.current;
    starting.current = true;
    setPendingBinding({ key, artifact: artifact, value: true });
    const startupTimings = new PracticeStartupTimings();
    try {
      await startupTimings.measure('waitPreviousRelease', () => released);
      if (operation !== generation.current) return;
      const devices = options.borrowRoots();
      if (!devices) throw new Error('PRACTICE_DEVICE_UNAVAILABLE');
      onSessionStart();
      const controller = new StepPracticeController({ devices, rootHealth: options.rootHealth, startupTimings, plan,
        platform: browserStepPlatform(options.acquireInference),
        onNaturalCompletion: result => {
          if (operation === generation.current && owner.current === controller && result.completionReason === 'SCOPE_COMPLETED') completion.current?.(result);
        } });
      owner.current = controller; unsubscribe.current = controller.subscribe(() => {
        if (operation === generation.current && owner.current === controller) setSnapshot(controller.snapshot());
      });
      setPreparationError(null); await controller.start();
    } catch (failure) { if (operation === generation.current) setPreparationError((failure as Error).message); } finally {
      if (operation === generation.current) { starting.current = false; setPendingBinding({ key, artifact: artifact, value: false }); }
    }
  }, [options, plan, artifact, key, setPreparationError, setSnapshot, dispose, onSessionStart]);
  const abandon = useCallback(async () => {
    const current = owner.current, operation = generation.current;
    if (!current) return;
    await current.abandon();
    if (operation !== generation.current || owner.current !== current) return;
    const terminal = current.snapshot();
    if (terminal.lastSnapshot?.completionReason === 'SCOPE_COMPLETED' || terminal.error === 'STEP_RESOURCE_CLEANUP_FAILED') { setSnapshot(terminal); return; }
    const released = dispose(), discarded = generation.current;
    await released;
    if (discarded === generation.current) { setSnapshot(null); setPreparationError(null); }
  }, [dispose, setSnapshot, setPreparationError]);
  const skip = useCallback(() => { owner.current?.skip(); }, []);
  const restart = useCallback(async () => {
    const released = dispose(), operation = generation.current;
    await released;
    if (operation !== generation.current) return;
    setSnapshot(null); setPreparationError(null); await start();
  }, [dispose, start, setSnapshot, setPreparationError]);
  const setMetronomeEnabled = useCallback((enabled: boolean) => owner.current?.setMetronomeEnabled(enabled), []);
  const applicationState: StepControllerState = snapshot?.state ?? 'IDLE';
  const inputError = preparationError ?? snapshot?.error ?? null;
  const bindingPending = pendingBinding?.key === key && pendingBinding.artifact === artifact && pendingBinding.value;
  const inputState: LocalPracticeInputState = bindingPending ? 'STARTING' : inputError ? 'ERROR' : applicationState === 'PREPARING' ? 'STARTING' : applicationState === 'ACTIVE' ? 'RUNNING' : 'IDLE';
  // Generic UI boundary only: lifecycle denotes application presentation, never domain status.
  return { analysisIntervention: snapshot?.analysisIntervention ?? null, infrastructureIntervention: snapshot?.infrastructureIntervention ?? null,
    mode: 'STEP_BY_STEP' as const, applicationState, lifecycle: applicationState,
    runtimeStatus: snapshot?.sessionSnapshot?.runtimeStatus ?? null,
    inputState, inputError, error: inputError, activeStepGroup: snapshot?.activeStepGroup && artifact ? projectPracticeMomentView(artifact, snapshot.activeStepGroup) : null,
    stepInteractionPhase: snapshot?.stepInteractionPhase ?? null,
    canAcceptAttempt: snapshot?.canAcceptAttempt ?? false,
    pendingPostVerdict: snapshot?.pendingPostVerdict ?? null,
    performanceClock: null, performanceEvaluation: null, recordingIndicator: null,
    completionReason: snapshot?.lastSnapshot?.completionReason ?? null, lastSnapshot: snapshot?.lastSnapshot ?? null,
    resolvedTempoPlan: plan?.tempoPlan ?? null, isFinalizingRecording: false, isFinalizingPerformance: false,
    start, skip, abandon, restart, setMetronomeEnabled };
}
