'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PracticeInputSource, PracticeMode, PracticeScope, PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import type { ContinuousPracticeLifecycle, LocalPracticeInputState, LocalPracticeSessionSnapshot } from '@/lib/practice/local-core/session';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '@/lib/practice/local-core/practice-tempo';
import type { PracticeRecordingMode } from '@/lib/practice/performance-recorder';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import { ContinuousPracticeController, type ContinuousControllerSnapshot } from '@/lib/practice/continuous/continuous-practice-controller';
import { useStepLocalPractice } from './use-step-local-practice';
import { continuousControllerView } from '@/lib/practice/continuous/continuous-presentation';

export type { ContinuousPracticeLifecycle, LocalPracticeInputState };
export type UseLocalPracticeOptions = {
  artifact: PracticeScoreArtifact | null | undefined; mode: PracticeMode; inputSource: PracticeInputSource;
  scope: PracticeScope | null; tempoSelection?: PracticeTempoSelection; metronomeEnabled?: boolean;
  recordingMode?: PracticeRecordingMode; cameraMediaStream?: MediaStream | null;
  onCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
};

type PracticeBinding = ReturnType<typeof usePracticeModeBinding>;
export function useLocalPractice(options: UseLocalPracticeOptions & { mode: 'STEP_BY_STEP' }): Extract<PracticeBinding, { mode: 'STEP_BY_STEP' }>;
export function useLocalPractice(options: UseLocalPracticeOptions & { mode: 'CONTINUOUS_PLAY' }): Extract<PracticeBinding, { mode: 'CONTINUOUS_PLAY' }>;
export function useLocalPractice(options: UseLocalPracticeOptions): PracticeBinding;
export function useLocalPractice(options: UseLocalPracticeOptions): PracticeBinding {
  return usePracticeModeBinding(options);
}

function usePracticeModeBinding(options: UseLocalPracticeOptions) {
  const key = JSON.stringify([options.mode, options.inputSource, options.scope, options.tempoSelection]);
  const tempoPlan = useMemo(() => options.artifact ? resolvePracticeTempoPlan(options.artifact, options.tempoSelection ?? { mode: 'SCORE' }) : null,
    [options.artifact, options.tempoSelection]);
  const step = useStepLocalPractice(options, tempoPlan);
  const controller = useRef<ContinuousPracticeController | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const [snapshot, setSnapshot] = useState<ContinuousControllerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completion = useRef(options.onCompletion); completion.current = options.onCompletion;
  const dispose = useCallback(async () => { unsubscribe.current?.(); unsubscribe.current = null;
    const old = controller.current; controller.current = null; await old?.dispose(); }, []);
  useEffect(() => { setSnapshot(null); setError(null); return () => { void dispose(); }; }, [key, options.artifact, dispose]);
  useEffect(() => { controller.current?.setMetronomeEnabled(options.metronomeEnabled ?? false); }, [options.metronomeEnabled]);
  useEffect(() => {
    if (options.mode !== 'CONTINUOUS_PLAY') return;
    let frame: number;
    const draw = () => { controller.current?.refresh(); frame = requestAnimationFrame(draw); };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, [options.mode]);
  const start = useCallback(async () => {
    if (controller.current) {
      if (!['FAILED_BEFORE_START', 'FAILED', 'DISPOSED'].includes(controller.current.snapshot().session)) return;
      await dispose();
    }
    try {
      if (!options.artifact || !options.scope) throw new Error('Score artifact is not available yet.');
      const current = new ContinuousPracticeController({ artifact: options.artifact, scope: options.scope,
        inputSource: options.inputSource, tempoSelection: options.tempoSelection, metronomeEnabled: options.metronomeEnabled,
        recordingMode: options.recordingMode, cameraStream: options.cameraMediaStream,
        onCompletion: value => completion.current?.(value) });
      controller.current = current; unsubscribe.current = current.subscribe(() => setSnapshot(current.snapshot()));
      setError(null); await current.start(); setSnapshot(current.snapshot());
    } catch (failure) { setError((failure as Error).message); }
  }, [options, dispose]);
  const restart = useCallback(async () => { await dispose(); setSnapshot(null); setError(null); completedPerformanceStore.clearPerformance(); await start(); }, [dispose, start]);
  const pause = useCallback(async () => { controller.current?.pause(); }, []);
  const resume = useCallback(async () => { controller.current?.resume(); }, []);
  const finish = useCallback(async () => { await controller.current?.finish(); }, []);
  const setMetronomeEnabled = useCallback((enabled: boolean) => controller.current?.setMetronomeEnabled(enabled), []);
  if (options.mode === 'STEP_BY_STEP') return step;
  const transport = snapshot?.transport;
  const view = continuousControllerView(snapshot), lifecycle = view.lifecycle;
  const inputError = error ?? view.inputError;
  const inputState: LocalPracticeInputState = inputError ? 'ERROR' : view.inputState;
  return { mode: 'CONTINUOUS_PLAY' as const, lifecycle, inputState, inputError, error: inputError, activeStepGroup: null,
    performanceClock: transport ?? null, performanceEvaluation: snapshot?.evaluation ?? null,
    elapsedSeconds: Math.floor(((transport?.performanceTimeMs ?? 0) + (transport?.countInTotalMs ?? 0) - (transport?.countInRemainingMs ?? 0)) / 1000),
    completionReason: transport?.completionReason ?? null, lastSnapshot: snapshot?.sessionSnapshot ?? null,
    resolvedTempoPlan: tempoPlan, isFinalizingRecording: snapshot?.session === 'FINALIZING', isFinalizingPerformance: snapshot?.session === 'FINALIZING',
    setMetronomeEnabled, start, pause, resume, finish, restart };
}
