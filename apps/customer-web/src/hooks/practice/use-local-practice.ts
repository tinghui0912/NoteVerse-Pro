'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  entryGroupEndBeat,
  resolvePracticeScope,
  type ExpectedPracticeGroup,
  type PracticeInputSource,
  type PracticeMode,
  type PracticeScope,
  type PracticeScoreArtifact,
} from '@/lib/practice/local-core/artifact';
import {
  PracticeTimebase,
  type LocalClock,
} from '@/lib/practice/local-core/timebase';
import {
  StepPracticeRuntime,
  groupForCurrentStep,
} from '@/lib/practice/local-core/step-runtime';
import {
  ContinuousPracticeSession,
  type PerformanceClockSnapshot,
} from '@/lib/practice/local-core/performance-runtime';
import {
  createLocalSessionId,
  type LocalPracticeCompletionReason,
  type LocalPracticeLifecycle,
  type LocalPracticeInputState,
  type LocalPracticeSessionSnapshot,
  type LocalPerformanceSessionSnapshot,
} from '@/lib/practice/local-core/session';
import {
  resolvePracticeTempoPlan,
  type PracticeTempoSelection,
  type ResolvedPracticeTempoPlan,
} from '@/lib/practice/local-core/practice-tempo';
import { MetronomeController } from '@/lib/practice/metronome/metronome-controller';
import type {
  PerformanceEvidenceObservation,
  StepVerifierObservation,
} from '@/lib/practice/local-core/evidence';
import type { ContinuousEvaluationSnapshot } from '@/lib/practice/local-core/continuous-evaluation-session';
import {
  StepMicrophoneCaptureController,
} from '@/lib/practice/audio-analysis/step/step-acoustic-session';
import {
  CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON,
} from '@/lib/practice/audio-analysis/continuous/transcription-contract';
import {
  createByteDanceManifestFromAccess,
} from '@/lib/practice/acoustic-inference/bytedance-contract';
import { modelAssetsApi } from '@/lib/api';
import {
  BrowserMidiController,
  type BrowserMidiState,
} from '@/lib/practice/midi/browser-midi-controller';
import {
  completedPerformanceStore,
  type CompletedPerformance,
} from '@/lib/practice/completed-performance';
import {
  PerformanceRecorder,
  type PracticeRecordingMode,
} from '@/lib/practice/performance-recorder';

export type { LocalPracticeLifecycle, LocalPracticeInputState };

export type UseLocalPracticeOptions = {
  artifact: PracticeScoreArtifact | null | undefined;
  mode: PracticeMode;
  inputSource: PracticeInputSource;
  scope: PracticeScope | null;
  tempoSelection?: PracticeTempoSelection;
  metronomeEnabled?: boolean;
  recordingMode?: PracticeRecordingMode;
  cameraMediaStream?: MediaStream | null;
  onCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
};

const defaultClock: LocalClock = {
  nowMs: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

export function useLocalPractice({
  artifact,
  mode,
  inputSource,
  scope,
  tempoSelection = { mode: 'SCORE' },
  metronomeEnabled = false,
  recordingMode,
  cameraMediaStream = null,
  onCompletion,
}: UseLocalPracticeOptions) {
  const [lifecycle, setLifecycle] = useState<LocalPracticeLifecycle>('READY');
  const [inputState, setInputState] = useState<LocalPracticeInputState>('IDLE');
  const [inputError, setInputError] = useState<string | null>(null);
  const [errorInputSource, setErrorInputSource] = useState<PracticeInputSource | null>(null);
  const [activeStepGroup, setActiveStepGroup] = useState<ExpectedPracticeGroup | null>(null);
  const [performanceClock, setPerformanceClock] = useState<PerformanceClockSnapshot | null>(null);
  const [performanceEvaluation, setPerformanceEvaluation] = useState<ContinuousEvaluationSnapshot | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [completionReason, setCompletionReason] = useState<LocalPracticeCompletionReason | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<LocalPracticeSessionSnapshot | null>(null);
  const [isFinalizingPerformance, setIsFinalizingPerformance] = useState(false);
  const lifecycleRef = useRef<LocalPracticeLifecycle>('READY');
  const inputStateRef = useRef<LocalPracticeInputState>('IDLE');
  const errorInputSourceRef = useRef<PracticeInputSource | null>(null);
  const inputErrorRef = useRef<string | null>(null);

  const stepRuntimeRef = useRef<StepPracticeRuntime | null>(null);
  const performanceRuntimeRef = useRef<ContinuousPracticeSession | null>(null);
  const metronomeRef = useRef<MetronomeController | null>(null);
  const micControllerRef = useRef<StepMicrophoneCaptureController | null>(null);
  const midiControllerRef = useRef<BrowserMidiController | null>(null);
  const timebaseRef = useRef<PracticeTimebase | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const performanceRecorderRef = useRef<PerformanceRecorder | null>(null);
  const sessionGenerationRef = useRef<number>(0);
  const hasFinalizedRef = useRef<boolean>(false);
  const continuousCompletionRef = useRef<Promise<void> | null>(null);

  const resolvedTempoPlan: ResolvedPracticeTempoPlan | null = useMemo(
    () => (artifact ? resolvePracticeTempoPlan(artifact, tempoSelection) : null),
    [artifact, tempoSelection]
  );

  useEffect(() => {
    if (mode === 'STEP_BY_STEP') {
      const runtime = stepRuntimeRef.current;
      if (runtime) {
        runtime.setMetronomeEnabled(metronomeEnabled);
        if (metronomeEnabled) {
          metronomeRef.current?.setStepContext(runtime.currentOnsetBeat);
        }
      }
    } else {
      const runtime = performanceRuntimeRef.current;
      if (runtime) {
        runtime.setMetronomeEnabled(metronomeEnabled);
        if (metronomeEnabled) {
          metronomeRef.current?.syncContinuous(runtime.snapshot());
        }
      }
    }
    metronomeRef.current?.setEnabled(metronomeEnabled);
  }, [metronomeEnabled, mode]);

  useEffect(() => {
    if (resolvedTempoPlan) {
      metronomeRef.current?.setTempoPlan(resolvedTempoPlan);
    }
  }, [resolvedTempoPlan]);

  useEffect(() => {
    lifecycleRef.current = lifecycle;
    inputStateRef.current = inputState;
    errorInputSourceRef.current = errorInputSource;
    inputErrorRef.current = inputError;
  }, [errorInputSource, inputError, inputState, lifecycle]);

  // Stop performance animation loop
  const stopAnimationLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Stop elapsed seconds timer
  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Start elapsed seconds timer
  const startTimer = useCallback(() => {
    stopTimer();
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds((sec) => sec + 1);
    }, 1000);
  }, [stopTimer]);

  // Teardown inputs completely
  const teardownInputs = useCallback(async () => {
    performanceRecorderRef.current?.stopAndCleanup();
    performanceRecorderRef.current = null;

    const mic = micControllerRef.current;
    micControllerRef.current = null;
    if (mic) {
      try {
        await mic.stop();
      } catch {
        // Ignore stop errors during teardown
      }
    }

    const midi = midiControllerRef.current;
    midiControllerRef.current = null;
    if (midi) {
      try {
        midi.stop();
        midi.dispose();
      } catch {
        // Ignore dispose errors
      }
    }
  }, []);

  const finalizeRecordingAndBuildDraft = useCallback(
    async (sessionSnapshot: LocalPerformanceSessionSnapshot, completionGeneration: number) => {
      if (hasFinalizedRef.current) {
        return;
      }
      hasFinalizedRef.current = true;

      try {
        // Stale session generation check
        if (completionGeneration !== sessionGenerationRef.current) {
          return;
        }

        const finalizedRecording = performanceRecorderRef.current
          ? await performanceRecorderRef.current.finalize()
          : {
              media: { status: 'NOT_RECORDED' as const },
              timebase: { activeSegments: [], nominalMediaDurationMs: 0 },
            };

        const runtime = performanceRuntimeRef.current;
        if (artifact && resolvedTempoPlan && scope && runtime) {
          const resolvedScope = resolvePracticeScope(artifact, scope);
          const draft: CompletedPerformance = {
            localSessionId: sessionSnapshot.localSessionId,
            scoreId: sessionSnapshot.scoreId,
            revisionId: sessionSnapshot.revisionId,
            artifactId: sessionSnapshot.artifactId,
            scope: resolvedScope,
            tempoPlan: resolvedTempoPlan,
            inputSource: sessionSnapshot.inputSource,
            activeElapsedMs: sessionSnapshot.performance.activeElapsedMs,
            evaluation: runtime.completedEvaluation(),
            media: finalizedRecording.media,
            recordingTimebase: finalizedRecording.timebase,
            completedAt: new Date().toISOString(),
          };
          completedPerformanceStore.setPerformance(draft);
        }
      } finally {
        // The enclosing completion transaction owns isFinalizingPerformance.
      }
    },
    [artifact, resolvedTempoPlan, scope]
  );

  const freezePerformanceRecording = useCallback((sessionSnapshot: LocalPerformanceSessionSnapshot) => {
    const performanceEndMs = Math.max(
      0,
      sessionSnapshot.performance.activeElapsedMs - sessionSnapshot.performance.countInMs
    );
    return performanceRecorderRef.current?.freeze(performanceEndMs) ?? Promise.resolve();
  }, []);

  const drainPerformanceInference = useCallback(async (runtime: ContinuousPracticeSession) => {
    const completionCaptureTime = runtime.completionCaptureTime();
    const sessionSnapshot = runtime.snapshotSession();
    if (sessionSnapshot.inputSource === 'MIDI') {
      runtime.advanceAnalysisThrough(completionCaptureTime);
      setPerformanceEvaluation(runtime.evaluationSnapshot);
      return;
    }
    throw new Error('Continuous microphone analysis is unavailable.');
  }, []);

  const finalizeContinuousEvaluation = useCallback(async (runtime: ContinuousPracticeSession) => {
    await drainPerformanceInference(runtime);
    setPerformanceEvaluation(runtime.evaluationSnapshot);
  }, [drainPerformanceInference]);

  const completeContinuousPerformance = useCallback(
    async (requestedReason: LocalPracticeCompletionReason) => {
      if (continuousCompletionRef.current) {
        return continuousCompletionRef.current;
      }
      const runtime = performanceRuntimeRef.current;
      if (!runtime) {
        return;
      }
      const completionGeneration = sessionGenerationRef.current;
      const completionPromise = (async () => {
        setIsFinalizingPerformance(true);
        stopAnimationLoop();
        stopTimer();
        metronomeRef.current?.stop();

        const currentClock = runtime.snapshot();
        if (currentClock.state !== 'ENDED') {
          runtime.end(requestedReason);
        }
        const terminalReason = runtime.sessionCompletionReason ?? requestedReason;
        setCompletionReason(terminalReason);
        setLifecycle('ENDED');

        const frozenSnapshot = runtime.snapshotSession();
        const mediaFinalization = freezePerformanceRecording(frozenSnapshot);
        await finalizeContinuousEvaluation(runtime);
        if (completionGeneration !== sessionGenerationRef.current) {
          return;
        }
        await mediaFinalization;

        const sessionSnapshot = runtime.snapshotSession();
        setLastSnapshot(sessionSnapshot);
        setPerformanceEvaluation(runtime.evaluationSnapshot);
        await finalizeRecordingAndBuildDraft(sessionSnapshot, completionGeneration);
        if (completionGeneration !== sessionGenerationRef.current) {
          return;
        }
        onCompletion?.(sessionSnapshot);
        await teardownInputs();
        if (completionGeneration === sessionGenerationRef.current) {
          setInputState('IDLE');
        }
      })().finally(() => {
        if (completionGeneration === sessionGenerationRef.current) {
          setIsFinalizingPerformance(false);
        }
        if (continuousCompletionRef.current === completionPromise) {
          continuousCompletionRef.current = null;
        }
      });
      continuousCompletionRef.current = completionPromise;
      return completionPromise;
    },
    [
      finalizeContinuousEvaluation,
      finalizeRecordingAndBuildDraft,
      freezePerformanceRecording,
      onCompletion,
      stopAnimationLoop,
      stopTimer,
      teardownInputs,
    ]
  );

  // Handle natural completion
  const handleNaturalCompletion = useCallback(
    async (snapshot: LocalPracticeSessionSnapshot) => {
      stopAnimationLoop();
      stopTimer();
      metronomeRef.current?.stop();
      setCompletionReason('SCOPE_COMPLETED');
      setLastSnapshot(snapshot);
      setLifecycle('ENDED');
      onCompletion?.(snapshot);
      await teardownInputs();
      setInputState('IDLE');
    },
    [onCompletion, stopAnimationLoop, stopTimer, teardownInputs]
  );

  // Step observation handler
  const handleStepObservation = useCallback(
    (observation: StepVerifierObservation) => {
      const runtime = stepRuntimeRef.current;
      if (!runtime || runtime.state !== 'ACTIVE') {
        return;
      }

      const decision = runtime.observe(observation);
      if (decision.kind === 'MATCH') {
        if (runtime.isCompleted) {
          const snapshot = runtime.snapshot();
          void handleNaturalCompletion(snapshot);
        } else {
          setActiveStepGroup(groupForCurrentStep(runtime));
          metronomeRef.current?.setStepContext(runtime.currentOnsetBeat);
        }
      }
    },
    [handleNaturalCompletion]
  );

  // Performance evidence observation handler
  const handlePerformanceEvidence = useCallback(
    (observations: readonly PerformanceEvidenceObservation[]) => {
      const runtime = performanceRuntimeRef.current;
      if (!runtime) {
        return;
      }
      for (const obs of observations) {
        runtime.observeEvidence(obs);
      }
      setPerformanceEvaluation(runtime.evaluationSnapshot);
    },
    []
  );

  // Performance continuous animation loop
  const runPerformanceLoop = useCallback(() => {
    stopAnimationLoop();

    const loop = () => {
      const runtime = performanceRuntimeRef.current;
      if (!runtime) {
        return;
      }

      const clockSnapshot = runtime.snapshot();
      setPerformanceClock(clockSnapshot);
      if (inputSource === 'MIDI' && clockSnapshot.state === 'RUNNING') {
        runtime.advanceAnalysisThrough(runtime.timebase.atSessionMs(clockSnapshot.nowMs));
        setPerformanceEvaluation(runtime.evaluationSnapshot);
      }

      if (
        clockSnapshot.state === 'RUNNING'
      ) {
        performanceRecorderRef.current?.startIfReady(clockSnapshot.performanceTimeMs);
      }

      if (clockSnapshot.state === 'ENDED') {
        void completeContinuousPerformance('SCOPE_COMPLETED');
        return;
      }

      if (clockSnapshot.state === 'COUNT_IN' || clockSnapshot.state === 'RUNNING') {
        animationFrameRef.current = requestAnimationFrame(loop);
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);
  }, [completeContinuousPerformance, inputSource, stopAnimationLoop]);

  // Fatal input error handler
  const handleFatalInputError = useCallback((errorMessage: string) => {
    stopTimer();
    stopAnimationLoop();
    metronomeRef.current?.pause();
    if (mode === 'STEP_BY_STEP') {
      stepRuntimeRef.current?.pause();
    } else {
      const clock = performanceRuntimeRef.current?.pause();
      if (clock) {
        setPerformanceClock(clock);
      }
    }
    setErrorInputSource(inputSource);
    setLifecycle('PAUSED');
    setInputState('ERROR');
    setInputError(errorMessage);
  }, [inputSource, mode, stopAnimationLoop, stopTimer]);

  const handleMidiStateChange = useCallback((state: BrowserMidiState) => {
    if (state.connectedInputCount > 0) {
      if (errorInputSourceRef.current === 'MIDI' && inputErrorRef.current === 'NO_CONNECTED_INPUT') {
        setInputError(null);
        setErrorInputSource(null);
        setInputState(
          lifecycleRef.current === 'PAUSED'
            ? 'IDLE'
            : inputStateRef.current === 'ERROR'
              ? 'IDLE'
              : inputStateRef.current
        );
      }
      return;
    }

    if (lifecycleRef.current !== 'ACTIVE' && lifecycleRef.current !== 'PAUSED') {
      return;
    }

    stopTimer();
    stopAnimationLoop();
    metronomeRef.current?.pause();
    if (mode === 'STEP_BY_STEP') {
      stepRuntimeRef.current?.pause();
    } else {
      const clock = performanceRuntimeRef.current?.pause();
      if (clock) {
        setPerformanceClock(clock);
        setPerformanceEvaluation(performanceRuntimeRef.current?.evaluationSnapshot ?? null);
      }
    }
    setErrorInputSource('MIDI');
    setInputError('NO_CONNECTED_INPUT');
    setInputState('ERROR');
    if (lifecycleRef.current === 'ACTIVE') {
      setLifecycle('PAUSED');
    }
  }, [
    mode,
    stopAnimationLoop,
    stopTimer,
  ]);

  // Internal start session implementation
  const startSession = useCallback(async () => {
    if (!artifact || !resolvedTempoPlan || !scope) {
      throw new Error('Score artifact is not available yet.');
    }
    if (mode === 'CONTINUOUS_PLAY' && inputSource === 'MICROPHONE') {
      throw new Error(CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON);
    }

    setErrorInputSource(null);
    setInputError(null);
    setInputState('STARTING');
    setPerformanceEvaluation(null);

    sessionGenerationRef.current += 1;
    hasFinalizedRef.current = false;
    continuousCompletionRef.current = null;
    performanceRecorderRef.current?.stopAndCleanup();
    performanceRecorderRef.current = new PerformanceRecorder(
      mode === 'CONTINUOUS_PLAY' ? (recordingMode ?? 'OFF') : 'OFF'
    );

    const localSessionId = createLocalSessionId();
    const timebase = new PracticeTimebase({ domainId: localSessionId });
    timebaseRef.current = timebase;

    const resolvedScope = resolvePracticeScope(artifact, scope);
    const scopeStartBeat = resolvedScope?.startBeat ?? 0;
    const scopeEndBeat = scope.kind === 'RANGE'
      ? entryGroupEndBeat(artifact, scope.endGroupId)
      : (resolvedScope?.terminalBeat ?? artifact.scoreEndBeat);

    const metronome = new MetronomeController({
      artifact,
      tempoPlan: resolvedTempoPlan,
      meterSegments: artifact.meterSegments,
      enabled: metronomeEnabled,
      mode: mode === 'STEP_BY_STEP' ? 'STEP' : 'CONTINUOUS',
      scopeStartBeat,
      scopeEndBeat,
    });
    metronomeRef.current = metronome;

    try {
      if (inputSource === 'MICROPHONE') {
        let modelAccess;
        try {
          modelAccess = await modelAssetsApi.getByteDanceNoteModelAccess();
        } catch {
          throw new Error('MODEL_ACCESS_UNAVAILABLE');
        }
        const manifest = createByteDanceManifestFromAccess(modelAccess);

        const micController = new StepMicrophoneCaptureController({
          manifest,
          sessionTimebase: timebase,
          sourceSampleRateHz: 48000,
          captureDomainId: localSessionId,
          evidenceSink: {
            currentStepTarget: () => stepRuntimeRef.current?.currentTarget() ?? null,
            onStepObservation: (obs) => handleStepObservation(obs),
          },
          onFatalError: (fatalError) => {
            handleFatalInputError(fatalError.message);
          },
        });
        micControllerRef.current = micController;
        await micController.start();

        await performanceRecorderRef.current?.prepare({
          inputSource,
          analysisStream: micController.mediaStream,
          cameraStream: cameraMediaStream,
        });
      } else {
        const midiController = new BrowserMidiController({
          timebase,
          getCurrentStepTarget: () => stepRuntimeRef.current?.currentTarget() ?? null,
          onStepObservation: (obs) => handleStepObservation(obs),
          onPerformanceObservation: (obs) => handlePerformanceEvidence([obs]),
          onStateChange: handleMidiStateChange,
        });
        midiControllerRef.current = midiController;
        await midiController.start();

        await performanceRecorderRef.current?.prepare({
          inputSource,
          cameraStream: cameraMediaStream,
        });
      }

      setInputState('RUNNING');

      if (mode === 'STEP_BY_STEP') {
        const runtime = new StepPracticeRuntime({
          artifact,
          scope,
          inputSource,
          localSessionId,
          clock: defaultClock,
          timebase,
          tempoSelection,
          metronomeEnabled,
        });
        stepRuntimeRef.current = runtime;
        setActiveStepGroup(groupForCurrentStep(runtime));
        const initialOnsetBeat = runtime.currentOnsetBeat;
        metronome.setStepContext(initialOnsetBeat);
        metronome.start(initialOnsetBeat);
      } else {
        const runtime = new ContinuousPracticeSession({
          artifact,
          tempoPlan: resolvedTempoPlan,
          scope,
          inputSource,
          localSessionId,
          clock: defaultClock,
          timebase,
          tempoSelection,
          metronomeEnabled,
        });
        performanceRuntimeRef.current = runtime;
        const initialClock = runtime.start();
        setPerformanceClock(initialClock);
        setPerformanceEvaluation(runtime.evaluationSnapshot);
        metronome.start(initialClock);
        runPerformanceLoop();
      }

      setLifecycle('ACTIVE');
      setElapsedSeconds(0);
      setCompletionReason(null);
      setLastSnapshot(null);
      startTimer();
    } catch (err) {
      metronome.stop();
      metronome.destroy();
      metronomeRef.current = null;
      await teardownInputs();
      stepRuntimeRef.current = null;
      performanceRuntimeRef.current = null;
      const message = err instanceof Error ? err.message : String(err);
      setErrorInputSource(inputSource);
      setInputError(message);
      setInputState('ERROR');
      // lifecycle remains READY
    }
  }, [
    artifact,
    cameraMediaStream,
    handleFatalInputError,
    handleMidiStateChange,
    handlePerformanceEvidence,
    handleStepObservation,
    inputSource,
    metronomeEnabled,
    mode,
    recordingMode,
    resolvedTempoPlan,
    runPerformanceLoop,
    scope,
    startTimer,
    teardownInputs,
    tempoSelection,
  ]);

  // Start practice session (requires READY)
  const start = useCallback(async () => {
    if (lifecycle !== 'READY') {
      return;
    }
    try {
      await startSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorInputSource(inputSource);
      setInputError(message);
      setInputState('ERROR');
    }
  }, [inputSource, lifecycle, startSession]);

  // Pause practice session (requires ACTIVE)
  const pause = useCallback(async () => {
    if (lifecycle !== 'ACTIVE') {
      return;
    }
    stopTimer();
    stopAnimationLoop();
    metronomeRef.current?.pause();

    if (mode === 'STEP_BY_STEP') {
      stepRuntimeRef.current?.pause();
      // Stop inputs without teardown for step mode
      if (inputSource === 'MICROPHONE' && micControllerRef.current) {
        try {
          await micControllerRef.current.stop();
        } catch {
          // ignore
        }
      } else if (midiControllerRef.current) {
        try {
          midiControllerRef.current.stop();
        } catch {
          // ignore
        }
      }
    } else {
      const clock = performanceRuntimeRef.current?.pause();
      if (clock) {
        setPerformanceClock(clock);
        setPerformanceEvaluation(performanceRuntimeRef.current?.evaluationSnapshot ?? null);
      }
      if (clock) {
        performanceRecorderRef.current?.pause(clock.performanceTimeMs);
      }
    }
    setLifecycle('PAUSED');
    setInputState('IDLE');
  }, [inputSource, lifecycle, mode, stopAnimationLoop, stopTimer]);

  // Resume practice session (requires PAUSED)
  const resume = useCallback(async () => {
    if (lifecycle !== 'PAUSED') {
      return;
    }

    setErrorInputSource(null);
    setInputError(null);
    setInputState('STARTING');

    try {
      if (mode === 'STEP_BY_STEP') {
        if (inputSource === 'MICROPHONE') {
          if (!micControllerRef.current) {
            throw new Error('Microphone session lost. Please restart practice.');
          }
          await micControllerRef.current.start();
        } else {
          if (!midiControllerRef.current) {
            throw new Error('MIDI session lost. Please restart practice.');
          }
          if (midiControllerRef.current.getState().connectedInputCount === 0) {
            throw new Error('NO_CONNECTED_INPUT');
          }
          await midiControllerRef.current.start();
        }

        setInputState('RUNNING');
        stepRuntimeRef.current?.resume();
        const targetOnsetBeat = stepRuntimeRef.current?.currentOnsetBeat ?? 0;
        metronomeRef.current?.setStepContext(targetOnsetBeat);
        metronomeRef.current?.resume(targetOnsetBeat);
      } else {
        if (
          inputSource === 'MIDI' &&
          midiControllerRef.current?.getState().connectedInputCount === 0
        ) {
          throw new Error('NO_CONNECTED_INPUT');
        }
        setInputState('RUNNING');
        const clock = performanceRuntimeRef.current?.resume();
        if (clock) {
          setPerformanceClock(clock);
          setPerformanceEvaluation(performanceRuntimeRef.current?.evaluationSnapshot ?? null);
          metronomeRef.current?.resume(clock);
        } else {
          metronomeRef.current?.resume(0);
        }
        if (clock) {
          performanceRecorderRef.current?.resume(clock.performanceTimeMs);
        }
        runPerformanceLoop();
      }

      setLifecycle('ACTIVE');
      startTimer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorInputSource(inputSource);
      setInputError(message);
      setInputState('ERROR');
      // lifecycle remains PAUSED
    }
  }, [
    inputSource,
    lifecycle,
    mode,
    runPerformanceLoop,
    startTimer,
  ]);

  // Finish practice session (user stopped)
  const finish = useCallback(async () => {
    let snapshot: LocalPracticeSessionSnapshot | null = null;
    if (mode === 'STEP_BY_STEP') {
      stopTimer();
      stopAnimationLoop();
      metronomeRef.current?.stop();
      const runtime = stepRuntimeRef.current;
      if (runtime) {
        runtime.end('STOPPED_BY_USER');
        snapshot = runtime.snapshot();
      }
    } else {
      await completeContinuousPerformance('STOPPED_BY_USER');
      return;
    }

    setCompletionReason('STOPPED_BY_USER');
    if (snapshot) setLastSnapshot(snapshot);
    setLifecycle('ENDED');

    void teardownInputs().then(() => {
      setInputState('IDLE');
    });
  }, [completeContinuousPerformance, mode, stopAnimationLoop, stopTimer, teardownInputs]);

  // Skip (for STEP mode)
  const skip = useCallback(() => {
    const runtime = stepRuntimeRef.current;
    if (!runtime || runtime.state !== 'ACTIVE') {
      return;
    }
    runtime.skip();
    if (runtime.isCompleted) {
      const snapshot = runtime.snapshot();
      void handleNaturalCompletion(snapshot);
    } else {
      setActiveStepGroup(groupForCurrentStep(runtime));
      metronomeRef.current?.setStepContext(runtime.currentOnsetBeat);
    }
  }, [handleNaturalCompletion]);

  // Reset / restart
  const restart = useCallback(async () => {
    sessionGenerationRef.current += 1;
    hasFinalizedRef.current = false;
    continuousCompletionRef.current = null;
    metronomeRef.current?.stop();
    metronomeRef.current?.destroy();
    metronomeRef.current = null;
    completedPerformanceStore.clearPerformance();
    await teardownInputs();
    stepRuntimeRef.current = null;
    performanceRuntimeRef.current = null;
    timebaseRef.current = null;
    setLifecycle('READY');
    setErrorInputSource(null);
    setInputState('IDLE');
    setInputError(null);
    setElapsedSeconds(0);
    setCompletionReason(null);
    setLastSnapshot(null);
    setActiveStepGroup(null);
    setPerformanceClock(null);
    setPerformanceEvaluation(null);
    await startSession();
  }, [startSession, teardownInputs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      stopAnimationLoop();
      metronomeRef.current?.destroy();
      metronomeRef.current = null;
      void teardownInputs();
    };
  }, [stopAnimationLoop, stopTimer, teardownInputs]);

  const setMetronomeEnabled = useCallback((enabled: boolean) => {
    if (mode === 'STEP_BY_STEP') {
      const runtime = stepRuntimeRef.current;
      if (runtime) {
        runtime.setMetronomeEnabled(enabled);
        if (enabled) {
          metronomeRef.current?.setStepContext(runtime.currentOnsetBeat);
        }
      }
    } else {
      const runtime = performanceRuntimeRef.current;
      if (runtime) {
        runtime.setMetronomeEnabled(enabled);
        if (enabled) {
          metronomeRef.current?.syncContinuous(runtime.snapshot());
        }
      }
    }
    metronomeRef.current?.setEnabled(enabled);
  }, [mode]);

  const effectiveInputError = errorInputSource === inputSource ? inputError : null;
  const effectiveInputState =
    errorInputSource === inputSource ? inputState : inputState === 'ERROR' ? 'IDLE' : inputState;

  return {
    lifecycle,
    inputState: effectiveInputState,
    inputError: effectiveInputError,
    error: effectiveInputError,
    activeStepGroup,
    performanceClock,
    performanceEvaluation,
    elapsedSeconds,
    completionReason,
    lastSnapshot,
    resolvedTempoPlan,
    isFinalizingRecording: isFinalizingPerformance,
    isFinalizingPerformance,
    setMetronomeEnabled,
    start,
    pause,
    resume,
    finish,
    skip,
    restart,
  };
}
