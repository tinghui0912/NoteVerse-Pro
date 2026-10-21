'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalPracticeInputState } from '@/lib/practice/local-core/session';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/local-core/practice-tempo';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import { ContinuousPracticeController, type ContinuousControllerSnapshot } from '@/lib/practice/continuous/continuous-practice-controller';
import { continuousControllerView } from '@/lib/practice/continuous/continuous-presentation';
import type { UseLocalPracticeOptions } from './use-local-practice';

export function useContinuousLocalPractice(options: UseLocalPracticeOptions, tempoPlan: ResolvedPracticeTempoPlan | null,
  resourceBarrier: { current: Promise<void> }) {
  const key = JSON.stringify([options.mode, options.inputSource, options.scope, options.tempoSelection]);
  const generation = useRef(0);
  const starting = useRef(false);
  const preparation = useRef<Promise<void> | null>(null);
  const controller = useRef<ContinuousPracticeController | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const [snapshot, setSnapshot] = useState<ContinuousControllerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completion = useRef(options.onCompletion); completion.current = options.onCompletion;
  const dispose = useCallback(() => {
    generation.current++; starting.current = false;
    unsubscribe.current?.(); unsubscribe.current = null;
    const old = controller.current; controller.current = null;
    const pending = preparation.current; preparation.current = null;
    resourceBarrier.current = Promise.all([resourceBarrier.current, old?.dispose(), pending]).then(() => {});
    return resourceBarrier.current;
  }, [resourceBarrier]);
  useEffect(() => { setSnapshot(null); setError(null); return () => { void dispose(); }; }, [key, options.artifact, dispose]);
  useEffect(() => { controller.current?.setMetronomeEnabled(options.metronomeEnabled ?? false); }, [options.metronomeEnabled]);
  useEffect(() => {
    if (options.mode !== 'CONTINUOUS_PLAY') return;
    let frame: number;
    const draw = () => { controller.current?.refresh(); frame = requestAnimationFrame(draw); };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, [options.mode]);
  const start = useCallback(async () => {
    if (starting.current) return;
    if (controller.current && !['FAILED_BEFORE_START', 'FAILED', 'DISPOSED'].includes(controller.current.snapshot().session)) return;
    const released = controller.current ? dispose() : resourceBarrier.current;
    const operation = generation.current;
    starting.current = true;
    try {
      await released;
      if (operation !== generation.current) return;
      if (!options.artifact || !options.scope) throw new Error('Score artifact is not available yet.');
      const current = new ContinuousPracticeController({ artifact: options.artifact, scope: options.scope,
        inputSource: options.inputSource, tempoSelection: options.tempoSelection, metronomeEnabled: options.metronomeEnabled,
        recordingMode: options.recordingMode, cameraStream: options.cameraMediaStream,
        onCompletion: value => completion.current?.(value) });
      controller.current = current; unsubscribe.current = current.subscribe(() => setSnapshot(current.snapshot()));
      setError(null); preparation.current = current.start(); await preparation.current;
      if (operation === generation.current) setSnapshot(current.snapshot());
    } catch (failure) { if (operation === generation.current) setError((failure as Error).message); }
    finally { if (operation === generation.current) starting.current = false; }
  }, [options, dispose, resourceBarrier]);
  const restart = useCallback(async () => {
    const released = dispose(), operation = generation.current;
    await released;
    if (operation !== generation.current) return;
    setSnapshot(null); setError(null); completedPerformanceStore.clearPerformance(); await start();
  }, [dispose, start]);
  const pause = useCallback(async () => { controller.current?.pause(); }, []);
  const resume = useCallback(async () => { controller.current?.resume(); }, []);
  const finish = useCallback(async () => { await controller.current?.finish(); }, []);
  const setMetronomeEnabled = useCallback((enabled: boolean) => controller.current?.setMetronomeEnabled(enabled), []);
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
