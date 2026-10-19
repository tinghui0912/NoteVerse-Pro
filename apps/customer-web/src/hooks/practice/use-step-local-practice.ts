'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StepPracticeController } from '@/lib/practice/step/step-practice-controller';
import type { LocalPracticeInputState, StepPracticeLifecycle } from '@/lib/practice/local-core/session';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import type { UseLocalPracticeOptions } from './use-local-practice';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/local-core/practice-tempo';

/** Presentation/commands only. Every STEP resource belongs to its application owner. */
export function useStepLocalPractice(options: UseLocalPracticeOptions, tempoPlan: ResolvedPracticeTempoPlan | null) {
  const owner = useRef<StepPracticeController | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const completion = useRef(options.onCompletion);
  useEffect(() => { completion.current = options.onCompletion; }, [options.onCompletion]);
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
    unsubscribe.current?.(); unsubscribe.current = null; owner.current?.dispose(); owner.current = null;
  }, []);
  useEffect(() => dispose, [key, options.artifact, dispose]);
  useEffect(() => { owner.current?.setMetronomeEnabled(options.metronomeEnabled ?? false); }, [options.metronomeEnabled]);
  useEffect(() => {
    if (options.mode !== 'STEP_BY_STEP') return;
    // Drawing reads elapsed time only; it does not assemble or finalize attempts.
    let frame: number;
    const draw = () => { if (owner.current) setSnapshot(owner.current.snapshot()); frame = requestAnimationFrame(draw); };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, [options.mode, setSnapshot]);
  const start = useCallback(async () => {
    if (owner.current && owner.current.snapshot().state !== 'IDLE') return;
    if (!options.artifact || !options.scope || !tempoPlan) { setPreparationError('STEP_SCORE_UNAVAILABLE'); return; }
    if (!owner.current) {
      const controller = new StepPracticeController({ artifact: options.artifact, scope: options.scope,
        inputSource: options.inputSource, tempoSelection: options.tempoSelection, metronomeEnabled: options.metronomeEnabled,
        onCompletion: result => completion.current?.(result) });
      owner.current = controller; unsubscribe.current = controller.subscribe(() => setSnapshot(controller.snapshot()));
    }
    setPreparationError(null); await owner.current.start();
  }, [options, tempoPlan, setPreparationError, setSnapshot]);
  const finish = useCallback(async () => { owner.current?.finish(); }, []);
  const skip = useCallback(() => { owner.current?.skip(); }, []);
  const restart = useCallback(async () => { dispose(); completedPerformanceStore.clearPerformance(); setSnapshot(null); setPreparationError(null); await start(); }, [dispose, start, setSnapshot, setPreparationError]);
  const setMetronomeEnabled = useCallback((enabled: boolean) => owner.current?.setMetronomeEnabled(enabled), []);
  const state = snapshot?.state ?? 'IDLE';
  const lifecycle: StepPracticeLifecycle = state;
  const inputError = preparationError ?? snapshot?.error ?? null;
  const inputState: LocalPracticeInputState = inputError ? 'ERROR' : state === 'PREPARING' ? 'STARTING' : state === 'ACTIVE' ? 'RUNNING' : 'IDLE';
  return { mode: 'STEP_BY_STEP' as const, lifecycle, inputState, inputError, error: inputError, activeStepGroup: snapshot?.activeStepGroup ?? null,
    stepInteractionPhase: snapshot?.stepInteractionPhase ?? null,
    canAcceptAttempt: snapshot?.canAcceptAttempt ?? false,
    lastFinalizedVerdict: snapshot?.lastFinalizedVerdict ?? null,
    performanceClock: null, performanceEvaluation: null, elapsedSeconds: snapshot?.elapsedSeconds ?? 0,
    completionReason: snapshot?.lastSnapshot?.completionReason ?? null, lastSnapshot: snapshot?.lastSnapshot ?? null,
    resolvedTempoPlan: tempoPlan, isFinalizingRecording: false, isFinalizingPerformance: false,
    start, skip, finish, restart, setMetronomeEnabled };
}
