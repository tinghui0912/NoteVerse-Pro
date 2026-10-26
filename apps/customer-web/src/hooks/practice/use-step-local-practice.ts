'use client';
import { browserStepPlatform } from '@/lib/practice/step/step-platform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StepPracticeController, type StepControllerState } from '@/lib/practice/step/step-practice-controller';
import type { LocalPracticeInputState } from '@/lib/practice/input-state';
import type { UseLocalPracticeOptions } from './use-local-practice';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import type { PracticeResourceCoordinator } from './practice-resource-coordinator';

/** Presentation/commands only. Every STEP resource belongs to its application owner. */
export function useStepLocalPractice(options: UseLocalPracticeOptions, tempoPlan: ResolvedPracticeTempoPlan | null,
  resources: PracticeResourceCoordinator, onSessionStart: () => void) {
  const owner = useRef<StepPracticeController | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const completion = useRef(options.onNaturalCompletion);
  useEffect(() => { completion.current = options.onNaturalCompletion; }, [options.onNaturalCompletion]);
  const key = JSON.stringify([options.mode, options.inputSource, options.scope, options.tempoSelection]);
  type Snapshot = ReturnType<StepPracticeController['snapshot']> | null;
  type Binding<T> = { key: string; artifact: UseLocalPracticeOptions['artifact']; value: T };
  const [savedSnapshot, saveSnapshot] = useState<Binding<Snapshot> | null>(null);
  const [savedError, saveError] = useState<Binding<string | null> | null>(null);
  const snapshot = savedSnapshot?.key === key && savedSnapshot.artifact === options.artifact ? savedSnapshot.value : null;
  const preparationError = savedError?.key === key && savedError.artifact === options.artifact ? savedError.value : null;
  const setSnapshot = useCallback((value: Snapshot) => saveSnapshot({ key, artifact: options.artifact, value }), [key, options.artifact]);
  const setPreparationError = useCallback((value: string | null) => saveError({ key, artifact: options.artifact, value }), [key, options.artifact]);
  const dispose = useCallback(() => {
    generation.current++; starting.current = false;
    unsubscribe.current?.(); unsubscribe.current = null;
    const old = owner.current; owner.current = null;
    const pending = old?.dispose();
    return resources.trackRelease(pending);
  }, [resources]);
  useEffect(() => () => { void dispose(); }, [key, options.artifact, dispose]);
  useEffect(() => { owner.current?.setMetronomeEnabled(options.metronomeEnabled ?? false); }, [options.metronomeEnabled]);
  useEffect(() => {
    if (options.mode !== 'STEP_BY_STEP') return;
    // Drawing reads elapsed time only; it does not assemble or finalize attempts.
    let frame: number;
    const draw = () => { if (owner.current) setSnapshot(owner.current.snapshot()); frame = requestAnimationFrame(draw); };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, [options.mode, setSnapshot]);
  const start = useCallback(async () => {
    if (starting.current || (owner.current && ['PREPARING', 'ACTIVE'].includes(owner.current.snapshot().state))) return;
    if (!options.artifact || !options.scope || !tempoPlan) { setPreparationError('STEP_SCORE_UNAVAILABLE'); return; }
    const released = dispose(), operation = generation.current;
    starting.current = true;
    try {
      await released;
      if (operation !== generation.current) return;
      onSessionStart();
      const controller = new StepPracticeController({ artifact: options.artifact, scope: options.scope,
        platform: browserStepPlatform(options.acquireInference), inputSource: options.inputSource, tempoSelection: options.tempoSelection, metronomeEnabled: options.metronomeEnabled,
        onNaturalCompletion: result => {
          if (operation === generation.current && owner.current === controller && result.completionReason === 'SCOPE_COMPLETED') completion.current?.(result);
        } });
      owner.current = controller; unsubscribe.current = controller.subscribe(() => setSnapshot(controller.snapshot()));
      setPreparationError(null); await controller.start();
    } finally {
      if (operation === generation.current) starting.current = false;
    }
  }, [options, tempoPlan, setPreparationError, setSnapshot, dispose, onSessionStart]);
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
  const inputState: LocalPracticeInputState = inputError ? 'ERROR' : applicationState === 'PREPARING' ? 'STARTING' : applicationState === 'ACTIVE' ? 'RUNNING' : 'IDLE';
  // Generic UI boundary only: lifecycle denotes application presentation, never domain status.
  return { mode: 'STEP_BY_STEP' as const, applicationState, lifecycle: applicationState,
    runtimeStatus: snapshot?.sessionSnapshot?.runtimeStatus ?? null,
    inputState, inputError, error: inputError, activeStepGroup: snapshot?.activeStepGroup ?? null,
    stepInteractionPhase: snapshot?.stepInteractionPhase ?? null,
    canAcceptAttempt: snapshot?.canAcceptAttempt ?? false,
    pendingPostVerdict: snapshot?.pendingPostVerdict ?? null,
    performanceClock: null, performanceEvaluation: null, elapsedSeconds: snapshot?.elapsedSeconds ?? 0,
    completionReason: snapshot?.lastSnapshot?.completionReason ?? null, lastSnapshot: snapshot?.lastSnapshot ?? null,
    resolvedTempoPlan: tempoPlan, isFinalizingRecording: false, isFinalizingPerformance: false,
    start, skip, abandon, restart, setMetronomeEnabled };
}
