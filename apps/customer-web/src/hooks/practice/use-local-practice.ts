'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PracticeInputSource, PracticeMode, PracticeScope, PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import type { LocalPracticeLifecycle, LocalPracticeInputState, LocalPracticeSessionSnapshot } from '@/lib/practice/local-core/session';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '@/lib/practice/local-core/practice-tempo';
import type { PracticeRecordingMode } from '@/lib/practice/performance-recorder';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import { CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON } from '@/lib/practice/input-capability-reasons';
import { ContinuousPracticeController, type ContinuousControllerSnapshot } from '@/lib/practice/continuous/continuous-practice-controller';
import { useStepLocalPractice } from './use-step-local-practice';

export type { LocalPracticeLifecycle, LocalPracticeInputState };
export type UseLocalPracticeOptions = {
  artifact: PracticeScoreArtifact | null | undefined; mode: PracticeMode; inputSource: PracticeInputSource;
  scope: PracticeScope | null; tempoSelection?: PracticeTempoSelection; metronomeEnabled?: boolean;
  recordingMode?: PracticeRecordingMode; cameraMediaStream?: MediaStream | null;
  onCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
};

export function useLocalPractice(options: UseLocalPracticeOptions) {
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
      if (controller.current.snapshot().session !== 'FAILED_BEFORE_START') return;
      await dispose();
    }
    try {
      // Product capability remains closed; qualification constructs the controller directly.
      if (options.inputSource === 'MICROPHONE') throw new Error(CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON);
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
  const skip = useCallback(() => {}, []);
  if (options.mode === 'STEP_BY_STEP') return step;
  const transport = snapshot?.transport;
  const lifecycle: LocalPracticeLifecycle = !transport ? 'READY' : transport.state === 'ENDED' ? 'ENDED' : transport.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
  const inputError = error ?? snapshot?.inputError ?? snapshot?.analysisError ?? null;
  const inputState: LocalPracticeInputState = inputError ? 'ERROR' : snapshot?.session === 'PREPARING' ? 'STARTING'
    : lifecycle === 'ACTIVE' ? 'RUNNING' : 'IDLE';
  return { lifecycle, inputState, inputError, error: inputError, activeStepGroup: null,
    performanceClock: transport ?? null, performanceEvaluation: snapshot?.evaluation ?? null,
    elapsedSeconds: Math.floor(((transport?.performanceTimeMs ?? 0) + (transport?.countInTotalMs ?? 0) - (transport?.countInRemainingMs ?? 0)) / 1000),
    completionReason: transport?.completionReason ?? null, lastSnapshot: snapshot?.sessionSnapshot ?? null,
    resolvedTempoPlan: tempoPlan, isFinalizingRecording: snapshot?.session === 'FINALIZING', isFinalizingPerformance: snapshot?.session === 'FINALIZING',
    setMetronomeEnabled, start, pause, resume, finish, skip, restart };
}
