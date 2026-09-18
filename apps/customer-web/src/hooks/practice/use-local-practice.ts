'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExpectedPracticeGroup,
  PracticeInputSource,
  PracticeMode,
  PracticeScope,
  PracticeScoreArtifact,
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
  PerformancePracticeRuntime,
  type PerformanceClockSnapshot,
} from '@/lib/practice/local-core/performance-runtime';
import {
  createLocalSessionId,
  InMemoryPracticeSessionStore,
  type LocalPracticeCompletionReason,
  type LocalPracticeLifecycle,
  type LocalPracticeInputState,
  type LocalPracticeSessionSnapshot,
} from '@/lib/practice/local-core/session';
import type {
  PerformanceEvidenceObservation,
  StepVerifierObservation,
} from '@/lib/practice/local-core/evidence';
import {
  BrowserMicrophoneCaptureController,
} from '@/lib/practice/acoustic-inference/live-capture';
import {
  createProductionByteDanceManifest,
} from '@/lib/practice/acoustic-inference/bytedance-contract';
import {
  BrowserMidiController,
} from '@/lib/practice/midi/browser-midi-controller';

export type { LocalPracticeLifecycle, LocalPracticeInputState };

export type UseLocalPracticeOptions = {
  artifact: PracticeScoreArtifact | null | undefined;
  mode: PracticeMode;
  inputSource: PracticeInputSource;
  scope?: PracticeScope | null;
  speedRatio?: number;
  onCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
};

const defaultClock: LocalClock = {
  nowMs: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

const defaultSessionStore = new InMemoryPracticeSessionStore();

export function useLocalPractice({
  artifact,
  mode,
  inputSource,
  scope,
  speedRatio = 1,
  onCompletion,
}: UseLocalPracticeOptions) {
  const [lifecycle, setLifecycle] = useState<LocalPracticeLifecycle>('READY');
  const [inputState, setInputState] = useState<LocalPracticeInputState>('IDLE');
  const [inputError, setInputError] = useState<string | null>(null);
  const [activeStepGroup, setActiveStepGroup] = useState<ExpectedPracticeGroup | null>(null);
  const [performanceClock, setPerformanceClock] = useState<PerformanceClockSnapshot | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [completionReason, setCompletionReason] = useState<LocalPracticeCompletionReason | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<LocalPracticeSessionSnapshot | null>(null);

  const stepRuntimeRef = useRef<StepPracticeRuntime | null>(null);
  const performanceRuntimeRef = useRef<PerformancePracticeRuntime | null>(null);
  const micControllerRef = useRef<BrowserMicrophoneCaptureController | null>(null);
  const midiControllerRef = useRef<BrowserMidiController | null>(null);
  const timebaseRef = useRef<PracticeTimebase | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Handle natural completion
  const handleNaturalCompletion = useCallback(
    async (snapshot: LocalPracticeSessionSnapshot) => {
      stopAnimationLoop();
      stopTimer();
      setCompletionReason('SCOPE_COMPLETED');
      setLastSnapshot(snapshot);
      defaultSessionStore.save(snapshot);
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
        }
      }
    },
    [handleNaturalCompletion]
  );

  // Performance evidence observation handler
  const handlePerformanceEvidence = useCallback(
    (observations: readonly PerformanceEvidenceObservation[]) => {
      const runtime = performanceRuntimeRef.current;
      if (!runtime || runtime.snapshot().state !== 'RUNNING') {
        return;
      }
      for (const obs of observations) {
        runtime.observeEvidence(obs);
      }
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

      if (clockSnapshot.state === 'ENDED') {
        const sessionSnapshot = runtime.snapshotSession();
        void handleNaturalCompletion(sessionSnapshot);
        return;
      }

      if (clockSnapshot.state === 'COUNT_IN' || clockSnapshot.state === 'RUNNING') {
        animationFrameRef.current = requestAnimationFrame(loop);
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);
  }, [handleNaturalCompletion, stopAnimationLoop]);

  // Fatal input error handler
  const handleFatalInputError = useCallback((errorMessage: string) => {
    stopTimer();
    stopAnimationLoop();
    if (mode === 'STEP_BY_STEP') {
      stepRuntimeRef.current?.pause();
    } else {
      const clock = performanceRuntimeRef.current?.pause();
      if (clock) {
        setPerformanceClock(clock);
      }
    }
    setLifecycle('PAUSED');
    setInputState('ERROR');
    setInputError(errorMessage);
  }, [mode, stopAnimationLoop, stopTimer]);

  // Internal start session implementation
  const startSession = useCallback(async () => {
    if (!artifact) {
      throw new Error('Score artifact is not available yet.');
    }

    setInputError(null);
    setInputState('STARTING');

    const localSessionId = createLocalSessionId();
    const timebase = new PracticeTimebase({ domainId: localSessionId });
    timebaseRef.current = timebase;

    try {
      if (inputSource === 'MICROPHONE') {
        const manifest = createProductionByteDanceManifest();
        const micController = new BrowserMicrophoneCaptureController({
          manifest,
          sessionTimebase: timebase,
          sourceSampleRateHz: 48000,
          captureDomainId: localSessionId,
          evidenceSink: {
            currentStepTarget: () => stepRuntimeRef.current?.currentTarget() ?? null,
            onStepObservation: (obs) => handleStepObservation(obs),
            onPerformanceEvidence: (evidences) => handlePerformanceEvidence(evidences),
          },
          onFatalError: (fatalError) => {
            handleFatalInputError(fatalError.message);
          },
        });
        micControllerRef.current = micController;
        await micController.start();
      } else {
        const midiController = new BrowserMidiController({
          timebase,
          getCurrentStepTarget: () => stepRuntimeRef.current?.currentTarget() ?? null,
          onStepObservation: (obs) => handleStepObservation(obs),
          onPerformanceObservation: (obs) => handlePerformanceEvidence([obs]),
        });
        midiControllerRef.current = midiController;
        await midiController.start();
      }

      setInputState('RUNNING');

      if (mode === 'STEP_BY_STEP') {
        const runtime = new StepPracticeRuntime({
          artifact,
          scope: scope ?? undefined,
          inputSource,
          localSessionId,
          clock: defaultClock,
          timebase,
        });
        stepRuntimeRef.current = runtime;
        setActiveStepGroup(groupForCurrentStep(runtime));
      } else {
        const runtime = new PerformancePracticeRuntime({
          artifact,
          scope: scope ?? undefined,
          inputSource,
          speedRatio,
          localSessionId,
          clock: defaultClock,
          timebase,
        });
        performanceRuntimeRef.current = runtime;
        const initialClock = runtime.start();
        setPerformanceClock(initialClock);
        runPerformanceLoop();
      }

      setLifecycle('ACTIVE');
      setElapsedSeconds(0);
      setCompletionReason(null);
      setLastSnapshot(null);
      startTimer();
    } catch (err) {
      await teardownInputs();
      stepRuntimeRef.current = null;
      performanceRuntimeRef.current = null;
      const message = err instanceof Error ? err.message : String(err);
      setInputError(message);
      setInputState('ERROR');
      // lifecycle remains READY
    }
  }, [
    artifact,
    handleFatalInputError,
    handlePerformanceEvidence,
    handleStepObservation,
    inputSource,
    mode,
    runPerformanceLoop,
    scope,
    speedRatio,
    startTimer,
    teardownInputs,
  ]);

  // Start practice session (requires READY)
  const start = useCallback(async () => {
    if (lifecycle !== 'READY') {
      return;
    }
    await startSession();
  }, [lifecycle, startSession]);

  // Pause practice session (requires ACTIVE)
  const pause = useCallback(async () => {
    if (lifecycle !== 'ACTIVE') {
      return;
    }
    stopTimer();
    stopAnimationLoop();

    if (mode === 'STEP_BY_STEP') {
      stepRuntimeRef.current?.pause();
    } else {
      const clock = performanceRuntimeRef.current?.pause();
      if (clock) {
        setPerformanceClock(clock);
      }
    }
    setLifecycle('PAUSED');

    // Stop inputs without teardown
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
    setInputState('IDLE');
  }, [inputSource, lifecycle, mode, stopAnimationLoop, stopTimer]);

  // Resume practice session (requires PAUSED)
  const resume = useCallback(async () => {
    if (lifecycle !== 'PAUSED') {
      return;
    }

    setInputError(null);
    setInputState('STARTING');

    try {
      if (inputSource === 'MICROPHONE') {
        if (!micControllerRef.current && timebaseRef.current) {
          const manifest = createProductionByteDanceManifest();
          micControllerRef.current = new BrowserMicrophoneCaptureController({
            manifest,
            sessionTimebase: timebaseRef.current,
            sourceSampleRateHz: 48000,
            captureDomainId: timebaseRef.current.domainId,
            evidenceSink: {
              currentStepTarget: () => stepRuntimeRef.current?.currentTarget() ?? null,
              onStepObservation: (obs) => handleStepObservation(obs),
              onPerformanceEvidence: (evidences) => handlePerformanceEvidence(evidences),
            },
            onFatalError: (fatalError) => {
              handleFatalInputError(fatalError.message);
            },
          });
        }
        if (micControllerRef.current) {
          await micControllerRef.current.start();
        }
      } else {
        if (!midiControllerRef.current && timebaseRef.current) {
          midiControllerRef.current = new BrowserMidiController({
            timebase: timebaseRef.current,
            getCurrentStepTarget: () => stepRuntimeRef.current?.currentTarget() ?? null,
            onStepObservation: (obs) => handleStepObservation(obs),
            onPerformanceObservation: (obs) => handlePerformanceEvidence([obs]),
          });
        }
        if (midiControllerRef.current) {
          await midiControllerRef.current.start();
        }
      }

      setInputState('RUNNING');

      if (mode === 'STEP_BY_STEP') {
        stepRuntimeRef.current?.resume();
      } else {
        const clock = performanceRuntimeRef.current?.resume();
        if (clock) {
          setPerformanceClock(clock);
        }
        runPerformanceLoop();
      }

      setLifecycle('ACTIVE');
      startTimer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInputError(message);
      setInputState('ERROR');
      // lifecycle remains PAUSED
    }
  }, [
    handleFatalInputError,
    handlePerformanceEvidence,
    handleStepObservation,
    inputSource,
    lifecycle,
    mode,
    runPerformanceLoop,
    startTimer,
  ]);

  // Finish practice session (user stopped)
  const finish = useCallback(async () => {
    stopTimer();
    stopAnimationLoop();

    let snapshot: LocalPracticeSessionSnapshot | null = null;
    if (mode === 'STEP_BY_STEP') {
      const runtime = stepRuntimeRef.current;
      if (runtime) {
        runtime.end('STOPPED_BY_USER');
        snapshot = runtime.snapshot();
      }
    } else {
      const runtime = performanceRuntimeRef.current;
      if (runtime) {
        runtime.end('STOPPED_BY_USER');
        snapshot = runtime.snapshotSession();
      }
    }

    setCompletionReason('STOPPED_BY_USER');
    if (snapshot) {
      setLastSnapshot(snapshot);
      defaultSessionStore.save(snapshot);
    }
    setLifecycle('ENDED');

    void teardownInputs().then(() => {
      setInputState('IDLE');
    });
  }, [mode, stopAnimationLoop, stopTimer, teardownInputs]);

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
    }
  }, [handleNaturalCompletion]);

  // Reset / restart
  const restart = useCallback(async () => {
    await teardownInputs();
    stepRuntimeRef.current = null;
    performanceRuntimeRef.current = null;
    timebaseRef.current = null;
    setLifecycle('READY');
    setInputState('IDLE');
    setInputError(null);
    setElapsedSeconds(0);
    setCompletionReason(null);
    setLastSnapshot(null);
    setActiveStepGroup(null);
    setPerformanceClock(null);
    await startSession();
  }, [startSession, teardownInputs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      stopAnimationLoop();
      void teardownInputs();
    };
  }, [stopAnimationLoop, stopTimer, teardownInputs]);

  return {
    lifecycle,
    inputState,
    inputError,
    error: inputError,
    activeStepGroup,
    performanceClock,
    elapsedSeconds,
    completionReason,
    lastSnapshot,
    start,
    pause,
    resume,
    finish,
    skip,
    restart,
  };
}
