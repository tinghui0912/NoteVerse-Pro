'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StepPracticeRuntime, groupForCurrentStep } from '@/lib/practice/local-core/step-runtime';
import { PracticeTimebase } from '@/lib/practice/local-core/timebase';
import { createLocalSessionId, type LocalPracticeLifecycle, type LocalPracticeInputState, type LocalPracticeSessionSnapshot } from '@/lib/practice/local-core/session';
import { resolvePracticeScope } from '@/lib/practice/local-core/artifact';
import { MetronomeController } from '@/lib/practice/metronome/metronome-controller';
import { BrowserMidiController, type BrowserMidiState } from '@/lib/practice/midi/browser-midi-controller';
import { STEP_ANALYSIS_UNAVAILABLE_REASON } from '@/lib/practice/input-capability-reasons';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import type { UseLocalPracticeOptions } from './use-local-practice';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/local-core/practice-tempo';

/** Existing correctness-driven STEP lifecycle; no Continuous acoustic input. */
export function useStepLocalPractice(options: UseLocalPracticeOptions, tempoPlan: ResolvedPracticeTempoPlan | null) {
  const [lifecycle, setLifecycle] = useState<LocalPracticeLifecycle>('READY');
  const [inputState, setInputState] = useState<LocalPracticeInputState>('IDLE');
  const [inputError, setInputError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastSnapshot, setLastSnapshot] = useState<LocalPracticeSessionSnapshot | null>(null);
  const [activeStepGroup, setActiveStepGroup] = useState<ReturnType<typeof groupForCurrentStep>>(null);
  const runtime = useRef<StepPracticeRuntime | null>(null), midi = useRef<BrowserMidiController | null>(null);
  const metronome = useRef<MetronomeController | null>(null), timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const life = useRef(lifecycle), error = useRef(inputError), source = useRef(options.inputSource);
  const stopTimer = useCallback(() => { if (timer.current) clearInterval(timer.current); timer.current = null; }, []);
  const cleanup = useCallback(() => { stopTimer(); midi.current?.dispose(); midi.current = null; metronome.current?.destroy(); metronome.current = null; }, [stopTimer]);
  const startTimer = useCallback(() => { stopTimer(); timer.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000); }, [stopTimer]);
  useEffect(() => { life.current = lifecycle; error.current = inputError; }, [lifecycle, inputError]);
  const complete = useCallback(() => {
    const snapshot = runtime.current?.snapshot(); cleanup(); setLifecycle('ENDED'); life.current = 'ENDED'; setInputState('IDLE');
    if (snapshot) { setLastSnapshot(snapshot); options.onCompletion?.(snapshot); }
  }, [cleanup, options]);
  const stateChanged = useCallback((state: BrowserMidiState) => {
    if (state.connectedInputCount > 0) { if (error.current === 'NO_CONNECTED_INPUT') { setInputError(null); error.current = null; setInputState('IDLE'); } return; }
    if (life.current !== 'ACTIVE' && life.current !== 'PAUSED') return;
    if (life.current === 'ACTIVE') { runtime.current?.pause(); setLifecycle('PAUSED'); life.current = 'PAUSED'; }
    stopTimer(); metronome.current?.pause(); setInputError('NO_CONNECTED_INPUT'); error.current = 'NO_CONNECTED_INPUT'; setInputState('ERROR');
  }, [stopTimer]);
  const startSession = useCallback(async () => {
    if (options.inputSource === 'MICROPHONE') throw new Error(STEP_ANALYSIS_UNAVAILABLE_REASON);
    if (!options.artifact || !options.scope || !tempoPlan) throw new Error('Score artifact is not available yet.');
    setInputError(null); setInputState('STARTING'); source.current = options.inputSource;
    const localSessionId = createLocalSessionId(), timebase = new PracticeTimebase({ domainId: localSessionId });
    const step = new StepPracticeRuntime({ artifact: options.artifact, scope: options.scope, inputSource: options.inputSource,
      localSessionId, timebase, clock: { nowMs: () => performance.now() }, tempoSelection: options.tempoSelection,
      metronomeEnabled: options.metronomeEnabled });
    runtime.current = step;
    const scope = resolvePracticeScope(options.artifact, options.scope);
    metronome.current = new MetronomeController({ artifact: options.artifact, tempoPlan, enabled: options.metronomeEnabled,
      mode: 'STEP', scopeStartBeat: scope.startBeat, scopeEndBeat: scope.terminalBeat });
    midi.current = new BrowserMidiController({ timebase, getCurrentStepTarget: () => step.currentTarget(), onStateChange: stateChanged,
      onStepObservation: observation => {
        if (step.state !== 'ACTIVE') return;
        if (step.observe(observation).kind === 'MATCH') {
          if (step.isCompleted) complete();
          else { setActiveStepGroup(groupForCurrentStep(step)); metronome.current?.setStepContext(step.currentOnsetBeat); }
        }
      } });
    try {
      await midi.current.start(); setActiveStepGroup(groupForCurrentStep(step));
      metronome.current.setStepContext(step.currentOnsetBeat); metronome.current.start(step.currentOnsetBeat);
      setLifecycle('ACTIVE'); life.current = 'ACTIVE'; setInputState('RUNNING'); setElapsedSeconds(0); setLastSnapshot(null); startTimer();
    } catch (failure) { cleanup(); runtime.current = null; throw failure; }
  }, [options, tempoPlan, stateChanged, complete, startTimer, cleanup]);
  const start = useCallback(async () => {
    if (lifecycle !== 'READY') return;
    try { await startSession(); } catch (failure) { source.current = options.inputSource; setInputError((failure as Error).message); setInputState('ERROR'); }
  }, [lifecycle, startSession, options.inputSource]);
  const pause = useCallback(async () => {
    if (lifecycle !== 'ACTIVE') return; stopTimer(); metronome.current?.pause(); runtime.current?.pause(); midi.current?.stop();
    setLifecycle('PAUSED'); life.current = 'PAUSED'; setInputState('IDLE');
  }, [lifecycle, stopTimer]);
  const resume = useCallback(async () => {
    if (lifecycle !== 'PAUSED') return; setInputState('STARTING'); setInputError(null);
    try {
      if (options.inputSource === 'MICROPHONE') throw new Error(STEP_ANALYSIS_UNAVAILABLE_REASON);
      if (!midi.current || midi.current.getState().connectedInputCount === 0) throw new Error('NO_CONNECTED_INPUT');
      await midi.current.start(); runtime.current?.resume(); metronome.current?.resume(runtime.current?.currentOnsetBeat ?? 0);
      setInputState('RUNNING'); setLifecycle('ACTIVE'); life.current = 'ACTIVE'; startTimer();
    } catch (failure) { source.current = options.inputSource; setInputError((failure as Error).message); setInputState('ERROR'); }
  }, [lifecycle, options.inputSource, startTimer]);
  const finish = useCallback(async () => {
    runtime.current?.end('STOPPED_BY_USER'); const snapshot = runtime.current?.snapshot(); cleanup();
    if (snapshot) setLastSnapshot(snapshot); setLifecycle('ENDED'); life.current = 'ENDED'; setInputState('IDLE');
  }, [cleanup]);
  const skip = useCallback(() => {
    const step = runtime.current; if (!step || step.state !== 'ACTIVE') return; step.skip();
    if (step.isCompleted) complete(); else { setActiveStepGroup(groupForCurrentStep(step)); metronome.current?.setStepContext(step.currentOnsetBeat); }
  }, [complete]);
  const restart = useCallback(async () => { cleanup(); completedPerformanceStore.clearPerformance(); runtime.current = null; setLifecycle('READY'); setInputState('IDLE'); setInputError(null); setLastSnapshot(null);
    try { await startSession(); } catch (failure) { setInputError((failure as Error).message); setInputState('ERROR'); }
  }, [cleanup, startSession]);
  const setMetronomeEnabled = useCallback((enabled: boolean) => {
    runtime.current?.setMetronomeEnabled(enabled); metronome.current?.setEnabled(enabled);
    if (enabled && runtime.current) metronome.current?.setStepContext(runtime.current.currentOnsetBeat);
  }, []);
  useEffect(() => { if (options.mode === 'STEP_BY_STEP') setMetronomeEnabled(options.metronomeEnabled ?? false); }, [options.mode, options.metronomeEnabled, setMetronomeEnabled]);
  useEffect(() => () => cleanup(), [options.mode, cleanup]);
  const effectiveError = source.current === options.inputSource ? inputError : null;
  return { lifecycle, inputState: effectiveError ? inputState : inputState === 'ERROR' ? 'IDLE' as const : inputState,
    inputError: effectiveError, error: effectiveError, activeStepGroup, performanceClock: null, performanceEvaluation: null,
    elapsedSeconds, completionReason: lastSnapshot?.completionReason ?? null, lastSnapshot, resolvedTempoPlan: tempoPlan,
    isFinalizingRecording: false, isFinalizingPerformance: false, setMetronomeEnabled, start, pause, resume, finish, skip, restart };
}
