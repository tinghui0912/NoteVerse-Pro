'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  type LocalPerformanceSessionSnapshot,
} from '@/lib/practice/local-core/session';
import {
  PracticeTempoTimeline,
  resolvePracticeTempoPlan,
  type PracticeTempoSelection,
  type ResolvedPracticeTempoPlan,
} from '@/lib/practice/local-core/practice-tempo';
import { MetronomeController } from '@/lib/practice/metronome/metronome-controller';
import type {
  PerformanceEvidenceObservation,
  StepVerifierObservation,
} from '@/lib/practice/local-core/evidence';
import {
  BrowserMicrophoneCaptureController,
} from '@/lib/practice/acoustic-inference/live-capture';
import {
  createByteDanceManifestFromAccess,
} from '@/lib/practice/acoustic-inference/bytedance-contract';
import { modelAssetsApi } from '@/lib/api';
import {
  BrowserMidiController,
} from '@/lib/practice/midi/browser-midi-controller';
import {
  performanceReviewDraftStore,
  type PerformanceReviewDraft,
  type PerformanceReviewDraftAudio,
} from '@/lib/practice/performance-review-draft';

export type { LocalPracticeLifecycle, LocalPracticeInputState };

export type PracticeSetup = {
  mode: PracticeMode;
  inputSource: PracticeInputSource;
  scope?: PracticeScope | null;
  tempoSelection: PracticeTempoSelection;
  metronomeEnabled: boolean;
};

export type UseLocalPracticeOptions = {
  artifact: PracticeScoreArtifact | null | undefined;
  mode: PracticeMode;
  inputSource: PracticeInputSource;
  scope?: PracticeScope | null;
  tempoSelection?: PracticeTempoSelection;
  metronomeEnabled?: boolean;
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
  tempoSelection = { mode: 'SCORE' },
  metronomeEnabled = false,
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
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);

  const stepRuntimeRef = useRef<StepPracticeRuntime | null>(null);
  const performanceRuntimeRef = useRef<PerformancePracticeRuntime | null>(null);
  const metronomeRef = useRef<MetronomeController | null>(null);
  const micControllerRef = useRef<BrowserMicrophoneCaptureController | null>(null);
  const midiControllerRef = useRef<BrowserMidiController | null>(null);
  const timebaseRef = useRef<PracticeTimebase | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const midiRecordingStreamRef = useRef<MediaStream | null>(null);
  const activeRecordingStartedAtMsRef = useRef<number | null>(null);
  const accumulatedActiveRecordingMsRef = useRef<number>(0);
  const hasStartedRecordingRef = useRef<boolean>(false);
  const recordingUnavailableReasonRef = useRef<string | null>(null);

  const resolvedTempoPlan: ResolvedPracticeTempoPlan | null = artifact
    ? resolvePracticeTempoPlan(artifact, tempoSelection)
    : null;

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

  const [errorInputSource, setErrorInputSource] = useState<PracticeInputSource | null>(null);

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
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore stop errors
      }
    }

    const midiStream = midiRecordingStreamRef.current;
    midiRecordingStreamRef.current = null;
    if (midiStream) {
      for (const track of midiStream.getTracks()) {
        track.stop();
      }
    }

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
    async (sessionSnapshot: LocalPerformanceSessionSnapshot) => {
      setIsFinalizingRecording(true);
      try {
        if (activeRecordingStartedAtMsRef.current !== null) {
          accumulatedActiveRecordingMsRef.current += Math.max(
            0,
            performance.now() - activeRecordingStartedAtMsRef.current
          );
          activeRecordingStartedAtMsRef.current = null;
        }

        const recorder = mediaRecorderRef.current;
        let audio: PerformanceReviewDraftAudio;

        if (recorder && recorder.state !== 'inactive') {
          audio = await new Promise<PerformanceReviewDraftAudio>((resolve) => {
            recorder.onstop = () => {
              const mimeType = recorder.mimeType || 'audio/webm';
              const blob = new Blob(recordingChunksRef.current, { type: mimeType });
              resolve({
                status: 'READY',
                blob,
                mimeType,
                durationMs: Math.max(0, Math.round(accumulatedActiveRecordingMsRef.current)),
              });
            };
            recorder.onerror = () => {
              resolve({
                status: 'UNAVAILABLE',
                reason: 'MEDIA_RECORDER_ERROR',
              });
            };
            try {
              recorder.requestData();
              recorder.stop();
            } catch {
              resolve({
                status: 'UNAVAILABLE',
                reason: 'RECORDER_STOP_FAILED',
              });
            }
          });
        } else if (recordingChunksRef.current.length > 0) {
          const mimeType = recorder?.mimeType || 'audio/webm';
          const blob = new Blob(recordingChunksRef.current, { type: mimeType });
          audio = {
            status: 'READY',
            blob,
            mimeType,
            durationMs: Math.max(0, Math.round(accumulatedActiveRecordingMsRef.current)),
          };
        } else {
          audio = {
            status: 'UNAVAILABLE',
            reason: recordingUnavailableReasonRef.current ?? 'RECORDING_NOT_AVAILABLE',
          };
        }

        if (artifact && resolvedTempoPlan) {
          const resolvedScope = resolvePracticeScope(artifact, scope ?? {});
          const timeline = new PracticeTempoTimeline(resolvedTempoPlan, artifact.scoreEndBeat);
          const scopeStartMs = timeline.beatToTimeMs(resolvedScope.startBeat);
          const scopeTerminalMs = timeline.beatToTimeMs(resolvedScope.terminalBeat);
          const nominalDurationMs = Math.max(0, scopeTerminalMs - scopeStartMs);

          const draft: PerformanceReviewDraft = {
            localSessionId: sessionSnapshot.localSessionId,
            scoreId: sessionSnapshot.scoreId,
            revisionId: sessionSnapshot.revisionId,
            artifactId: sessionSnapshot.artifactId,
            scope: resolvedScope,
            tempoPlan: resolvedTempoPlan,
            performanceSnapshot: sessionSnapshot,
            audio,
            replayTiming: {
              scopeStartBeat: resolvedScope.startBeat,
              scopeStartMs,
              nominalDurationMs,
            },
            completedAt: new Date().toISOString(),
          };
          performanceReviewDraftStore.setDraft(draft);
        }
      } finally {
        setIsFinalizingRecording(false);
      }
    },
    [artifact, resolvedTempoPlan, scope]
  );

  // Handle natural completion
  const handleNaturalCompletion = useCallback(
    async (snapshot: LocalPracticeSessionSnapshot) => {
      stopAnimationLoop();
      stopTimer();
      metronomeRef.current?.stop();
      setCompletionReason('SCOPE_COMPLETED');
      setLastSnapshot(snapshot);
      defaultSessionStore.save(snapshot);
      setLifecycle('ENDED');
      if (mode === 'CONTINUOUS_PLAY') {
        await finalizeRecordingAndBuildDraft(snapshot as LocalPerformanceSessionSnapshot);
      }
      onCompletion?.(snapshot);
      await teardownInputs();
      setInputState('IDLE');
    },
    [finalizeRecordingAndBuildDraft, mode, onCompletion, stopAnimationLoop, stopTimer, teardownInputs]
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

      if (
        clockSnapshot.state === 'RUNNING' &&
        !hasStartedRecordingRef.current &&
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === 'inactive'
      ) {
        hasStartedRecordingRef.current = true;
        activeRecordingStartedAtMsRef.current = performance.now();
        try {
          mediaRecorderRef.current.start(250);
        } catch (err) {
          recordingUnavailableReasonRef.current =
            err instanceof Error ? err.message : 'RECORDING_START_FAILED';
        }
      }

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

  // Internal start session implementation
  const startSession = useCallback(async () => {
    if (!artifact || !resolvedTempoPlan) {
      throw new Error('Score artifact is not available yet.');
    }

    setErrorInputSource(null);
    setInputError(null);
    setInputState('STARTING');

    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    activeRecordingStartedAtMsRef.current = null;
    accumulatedActiveRecordingMsRef.current = 0;
    hasStartedRecordingRef.current = false;
    recordingUnavailableReasonRef.current = null;

    const localSessionId = createLocalSessionId();
    const timebase = new PracticeTimebase({ domainId: localSessionId });
    timebaseRef.current = timebase;

    const resolvedScope = artifact ? resolvePracticeScope(artifact, scope ?? {}) : null;
    const scopeStartBeat = resolvedScope?.startBeat ?? 0;
    const scopeEndBeat = scope?.endGroupId
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

        if (mode === 'CONTINUOUS_PLAY') {
          const micStream = micController.mediaStream;
          if (micStream && typeof MediaRecorder !== 'undefined') {
            try {
              const recorder = new MediaRecorder(micStream);
              recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                  recordingChunksRef.current.push(event.data);
                }
              };
              mediaRecorderRef.current = recorder;
            } catch (recErr) {
              recordingUnavailableReasonRef.current =
                recErr instanceof Error ? recErr.message : 'RECORDER_INIT_FAILED';
            }
          } else if (!micStream) {
            recordingUnavailableReasonRef.current = 'MIC_STREAM_UNAVAILABLE';
          } else {
            recordingUnavailableReasonRef.current = 'MEDIA_RECORDER_UNSUPPORTED';
          }
        }
      } else {
        const midiController = new BrowserMidiController({
          timebase,
          getCurrentStepTarget: () => stepRuntimeRef.current?.currentTarget() ?? null,
          onStepObservation: (obs) => handleStepObservation(obs),
          onPerformanceObservation: (obs) => handlePerformanceEvidence([obs]),
        });
        midiControllerRef.current = midiController;
        await midiController.start();

        if (mode === 'CONTINUOUS_PLAY') {
          try {
            const mediaDevices = globalThis.navigator?.mediaDevices;
            if (mediaDevices?.getUserMedia) {
              const audioStream = await mediaDevices.getUserMedia({
                audio: {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                },
              });
              midiRecordingStreamRef.current = audioStream;
              if (typeof MediaRecorder !== 'undefined') {
                const recorder = new MediaRecorder(audioStream);
                recorder.ondataavailable = (event) => {
                  if (event.data && event.data.size > 0) {
                    recordingChunksRef.current.push(event.data);
                  }
                };
                mediaRecorderRef.current = recorder;
              } else {
                recordingUnavailableReasonRef.current = 'MEDIA_RECORDER_UNSUPPORTED';
              }
            } else {
              recordingUnavailableReasonRef.current = 'MEDIA_DEVICES_UNAVAILABLE';
            }
          } catch (permErr) {
            recordingUnavailableReasonRef.current =
              permErr instanceof Error ? permErr.name : 'PERMISSION_DENIED';
          }
        }
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
          tempoSelection,
          metronomeEnabled,
        });
        stepRuntimeRef.current = runtime;
        setActiveStepGroup(groupForCurrentStep(runtime));
        const initialOnsetBeat = runtime.currentOnsetBeat;
        metronome.setStepContext(initialOnsetBeat);
        metronome.start(initialOnsetBeat);
      } else {
        const runtime = new PerformancePracticeRuntime({
          artifact,
          tempoPlan: resolvedTempoPlan,
          scope: scope ?? undefined,
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
    handleFatalInputError,
    handlePerformanceEvidence,
    handleStepObservation,
    inputSource,
    metronomeEnabled,
    mode,
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
      }
      if (mediaRecorderRef.current?.state === 'recording') {
        if (activeRecordingStartedAtMsRef.current !== null) {
          accumulatedActiveRecordingMsRef.current += Math.max(
            0,
            performance.now() - activeRecordingStartedAtMsRef.current
          );
          activeRecordingStartedAtMsRef.current = null;
        }
        mediaRecorderRef.current.pause();
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
          await midiControllerRef.current.start();
        }

        setInputState('RUNNING');
        stepRuntimeRef.current?.resume();
        const targetOnsetBeat = stepRuntimeRef.current?.currentOnsetBeat ?? 0;
        metronomeRef.current?.setStepContext(targetOnsetBeat);
        metronomeRef.current?.resume(targetOnsetBeat);
      } else {
        setInputState('RUNNING');
        if (mediaRecorderRef.current?.state === 'paused') {
          activeRecordingStartedAtMsRef.current = performance.now();
          mediaRecorderRef.current.resume();
        }
        const clock = performanceRuntimeRef.current?.resume();
        if (clock) {
          setPerformanceClock(clock);
          metronomeRef.current?.resume(clock);
        } else {
          metronomeRef.current?.resume(0);
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
    stopTimer();
    stopAnimationLoop();
    metronomeRef.current?.stop();

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

    if (mode === 'CONTINUOUS_PLAY' && snapshot) {
      await finalizeRecordingAndBuildDraft(snapshot as LocalPerformanceSessionSnapshot);
    }

    void teardownInputs().then(() => {
      setInputState('IDLE');
    });
  }, [finalizeRecordingAndBuildDraft, mode, stopAnimationLoop, stopTimer, teardownInputs]);

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
    metronomeRef.current?.stop();
    metronomeRef.current?.destroy();
    metronomeRef.current = null;
    performanceReviewDraftStore.clearDraft();
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
    elapsedSeconds,
    completionReason,
    lastSnapshot,
    resolvedTempoPlan,
    isFinalizingRecording,
    setMetronomeEnabled,
    start,
    pause,
    resume,
    finish,
    skip,
    restart,
  };
}
