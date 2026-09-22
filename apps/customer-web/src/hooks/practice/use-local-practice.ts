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
  type PerformanceReviewDraftVideo,
  type RecordingTimebaseMapping,
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
  cameraRecordingEnabled?: boolean;
  cameraMediaStream?: MediaStream | null;
  onCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
};

const defaultClock: LocalClock = {
  nowMs: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

const defaultSessionStore = new InMemoryPracticeSessionStore();

function preferredVideoRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function createContinuousVideoStream(
  cameraStream: MediaStream | null,
  audioStream?: MediaStream | null
): MediaStream | null {
  const videoTracks = cameraStream?.getVideoTracks() ?? [];
  const audioTracks = audioStream?.getAudioTracks() ?? cameraStream?.getAudioTracks() ?? [];
  if (videoTracks.length === 0 || audioTracks.length === 0) {
    return null;
  }
  return new MediaStream([videoTracks[0], audioTracks[0]]);
}

export function useLocalPractice({
  artifact,
  mode,
  inputSource,
  scope,
  tempoSelection = { mode: 'SCORE' },
  metronomeEnabled = false,
  cameraRecordingEnabled = false,
  cameraMediaStream = null,
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
  const recordingMediaKindRef = useRef<'AUDIO' | 'VIDEO'>('AUDIO');
  const recordingUnavailableReasonRef = useRef<string | null>(null);
  const recordingStateRef = useRef<
    'NOT_STARTED' | 'RECORDING' | 'PAUSED' | 'FINALIZING' | 'READY' | 'UNAVAILABLE'
  >('NOT_STARTED');
  const sessionGenerationRef = useRef<number>(0);
  const hasFinalizedRef = useRef<boolean>(false);

  const installRecorderHandlers = useCallback(
    (recorder: MediaRecorder, stream: MediaStream, mediaKind: 'AUDIO' | 'VIDEO') => {
      const tracks = stream.getTracks();
      const deadTrack = tracks.find((track) => track.readyState !== 'live');
      if (deadTrack) {
        recordingUnavailableReasonRef.current =
          mediaKind === 'VIDEO' && deadTrack.kind === 'video'
            ? 'VIDEO_TRACK_NOT_LIVE'
            : 'AUDIO_TRACK_NOT_LIVE';
        recordingStateRef.current = 'UNAVAILABLE';
        return;
      }
      recordingMediaKindRef.current = mediaKind;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        recordingUnavailableReasonRef.current = 'MEDIA_RECORDER_ERROR';
        recordingStateRef.current = 'UNAVAILABLE';
      };
      for (const track of tracks) {
        track.addEventListener(
          'ended',
          () => {
            if (
              recordingStateRef.current === 'RECORDING' ||
              recordingStateRef.current === 'PAUSED'
            ) {
              recordingUnavailableReasonRef.current =
                mediaKind === 'VIDEO' && track.kind === 'video'
                  ? 'VIDEO_TRACK_ENDED'
                  : 'AUDIO_TRACK_ENDED';
              recordingStateRef.current = 'UNAVAILABLE';
            }
          },
          { once: true }
        );
      }
      mediaRecorderRef.current = recorder;
    },
    []
  );

  const recordingTimebaseRef = useRef<RecordingTimebaseMapping>({
    recordingStartPerfTimeMs: 0,
    recordingEndPerfTimeMs: 0,
    activeSegments: [],
    nominalMediaDurationMs: 0,
  });
  const currentSegmentStartPerfMsRef = useRef<number | null>(null);
  const currentSegmentStartMediaMsRef = useRef<number>(0);
  const cumulativeMediaMsRef = useRef<number>(0);

  const resolvedTempoPlan: ResolvedPracticeTempoPlan | null = useMemo(
    () => (artifact ? resolvePracticeTempoPlan(artifact, tempoSelection) : null),
    [
      artifact,
      tempoSelection.mode,
      tempoSelection.mode === 'CUSTOM_FIXED_BPM' ? tempoSelection.bpm : null,
    ]
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
      if (hasFinalizedRef.current) {
        return;
      }
      hasFinalizedRef.current = true;
      const sessionGen = sessionGenerationRef.current;

      setIsFinalizingRecording(true);
      try {
        if (currentSegmentStartPerfMsRef.current !== null) {
          const perfEndMs = Math.max(
            currentSegmentStartPerfMsRef.current,
            sessionSnapshot.performance.activeElapsedMs - sessionSnapshot.performance.countInMs
          );
          const segmentDuration = Math.max(0, perfEndMs - currentSegmentStartPerfMsRef.current);
          const mediaEndMs = currentSegmentStartMediaMsRef.current + segmentDuration;
          recordingTimebaseRef.current.activeSegments.push({
            perfStartMs: currentSegmentStartPerfMsRef.current,
            perfEndMs,
            mediaStartMs: currentSegmentStartMediaMsRef.current,
            mediaEndMs,
          });
          cumulativeMediaMsRef.current = mediaEndMs;
          currentSegmentStartPerfMsRef.current = null;
          recordingTimebaseRef.current.recordingEndPerfTimeMs = perfEndMs;
        } else if (recordingTimebaseRef.current.activeSegments.length > 0) {
          const lastSeg =
            recordingTimebaseRef.current.activeSegments[
              recordingTimebaseRef.current.activeSegments.length - 1
            ];
          recordingTimebaseRef.current.recordingEndPerfTimeMs = lastSeg.perfEndMs;
        }
        recordingTimebaseRef.current.nominalMediaDurationMs = cumulativeMediaMsRef.current;

        const recorder = mediaRecorderRef.current;
        recordingStateRef.current = 'FINALIZING';

        if (recorder && recorder.state !== 'inactive') {
          await Promise.race([
            new Promise<void>((resolve) => {
              recorder.onstop = () => resolve();
              try {
                if (typeof recorder.requestData === 'function') {
                  recorder.requestData();
                }
                recorder.stop();
              } catch {
                resolve();
              }
            }),
            new Promise<void>((resolve) => setTimeout(resolve, 1500)),
          ]);
        }

        // Stale session generation check
        if (sessionGen !== sessionGenerationRef.current) {
          return;
        }

        const totalBytes = recordingChunksRef.current.reduce((acc, chunk) => acc + (chunk?.size ?? 0), 0);
        let audio: PerformanceReviewDraftAudio;
        let video: PerformanceReviewDraftVideo | undefined;

        if (
          totalBytes === 0 ||
          recordingUnavailableReasonRef.current !== null ||
          (recordingStateRef.current as string) === 'UNAVAILABLE'
        ) {
          recordingStateRef.current = 'UNAVAILABLE';
          const unavailableReason =
            recordingUnavailableReasonRef.current ??
            (totalBytes === 0 ? 'EMPTY_RECORDING_BLOB' : 'RECORDING_NOT_AVAILABLE');
          if (recordingMediaKindRef.current === 'VIDEO') {
            audio = {
              status: 'UNAVAILABLE',
              reason: 'VIDEO_RECORDING_LOCAL_ONLY',
            };
            video = {
              status: 'UNAVAILABLE',
              reason: unavailableReason,
            };
          } else {
            audio = {
              status: 'UNAVAILABLE',
              reason: unavailableReason,
            };
          }
        } else {
          recordingStateRef.current = 'READY';
          const fallbackMimeType =
            recordingMediaKindRef.current === 'VIDEO' ? 'video/webm' : 'audio/webm';
          const mimeType = recorder?.mimeType || fallbackMimeType;
          const blob = new Blob(recordingChunksRef.current, { type: mimeType });
          if (recordingMediaKindRef.current === 'VIDEO') {
            audio = {
              status: 'UNAVAILABLE',
              reason: 'VIDEO_RECORDING_LOCAL_ONLY',
            };
            video = {
              status: 'READY',
              blob,
              mimeType,
              durationMs: Math.max(0, Math.round(recordingTimebaseRef.current.nominalMediaDurationMs)),
            };
          } else {
            audio = {
              status: 'READY',
              blob,
              mimeType,
              durationMs: Math.max(0, Math.round(recordingTimebaseRef.current.nominalMediaDurationMs)),
            };
          }
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
            video,
            recordingTimebase: structuredClone(recordingTimebaseRef.current),
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
        recordingStateRef.current === 'NOT_STARTED' &&
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === 'inactive'
      ) {
        const perfTimeMs = clockSnapshot.performanceTimeMs;
        recordingTimebaseRef.current.recordingStartPerfTimeMs = perfTimeMs;
        currentSegmentStartPerfMsRef.current = perfTimeMs;
        currentSegmentStartMediaMsRef.current = 0;
        cumulativeMediaMsRef.current = 0;
        try {
          mediaRecorderRef.current.start(250);
          recordingStateRef.current = 'RECORDING';
        } catch (err) {
          recordingUnavailableReasonRef.current =
            err instanceof Error ? err.message : 'RECORDING_START_FAILED';
          recordingStateRef.current = 'UNAVAILABLE';
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

    sessionGenerationRef.current += 1;
    hasFinalizedRef.current = false;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingUnavailableReasonRef.current = null;
    recordingStateRef.current = 'NOT_STARTED';
    recordingMediaKindRef.current = 'AUDIO';
    recordingTimebaseRef.current = {
      recordingStartPerfTimeMs: 0,
      recordingEndPerfTimeMs: 0,
      activeSegments: [],
      nominalMediaDurationMs: 0,
    };
    currentSegmentStartPerfMsRef.current = null;
    currentSegmentStartMediaMsRef.current = 0;
    cumulativeMediaMsRef.current = 0;

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
          const recorderStream =
            cameraRecordingEnabled
              ? createContinuousVideoStream(cameraMediaStream, micStream)
              : micStream;
          if (recorderStream && typeof MediaRecorder !== 'undefined') {
            try {
              const recorderOptions =
                cameraRecordingEnabled && preferredVideoRecorderMimeType()
                  ? { mimeType: preferredVideoRecorderMimeType() }
                  : undefined;
              const recorder = new MediaRecorder(recorderStream, recorderOptions);
              installRecorderHandlers(recorder, recorderStream, cameraRecordingEnabled ? 'VIDEO' : 'AUDIO');
            } catch (recErr) {
              recordingUnavailableReasonRef.current =
                recErr instanceof Error ? recErr.message : 'RECORDER_INIT_FAILED';
            }
          } else if (!recorderStream) {
            recordingUnavailableReasonRef.current = cameraRecordingEnabled
              ? 'CAMERA_AUDIO_VIDEO_STREAM_UNAVAILABLE'
              : 'MIC_STREAM_UNAVAILABLE';
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
            if (cameraRecordingEnabled) {
              const videoRecorderStream = createContinuousVideoStream(cameraMediaStream);
              if (!videoRecorderStream) {
                recordingUnavailableReasonRef.current = 'CAMERA_AUDIO_VIDEO_STREAM_UNAVAILABLE';
              } else if (typeof MediaRecorder !== 'undefined') {
                const recorderOptions = preferredVideoRecorderMimeType()
                  ? { mimeType: preferredVideoRecorderMimeType() }
                  : undefined;
                const recorder = new MediaRecorder(videoRecorderStream, recorderOptions);
                installRecorderHandlers(recorder, videoRecorderStream, 'VIDEO');
              } else {
                recordingUnavailableReasonRef.current = 'MEDIA_RECORDER_UNSUPPORTED';
              }
            } else {
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
                  installRecorderHandlers(recorder, audioStream, 'AUDIO');
                } else {
                  recordingUnavailableReasonRef.current = 'MEDIA_RECORDER_UNSUPPORTED';
                }
              } else {
                recordingUnavailableReasonRef.current = 'MEDIA_DEVICES_UNAVAILABLE';
              }
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
    cameraMediaStream,
    cameraRecordingEnabled,
    handleFatalInputError,
    handlePerformanceEvidence,
    handleStepObservation,
    installRecorderHandlers,
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
        if (currentSegmentStartPerfMsRef.current !== null) {
          const perfEndMs = Math.max(
            currentSegmentStartPerfMsRef.current,
            clock ? clock.performanceTimeMs : currentSegmentStartPerfMsRef.current
          );
          const segmentDuration = Math.max(0, perfEndMs - currentSegmentStartPerfMsRef.current);
          const mediaEndMs = currentSegmentStartMediaMsRef.current + segmentDuration;
          recordingTimebaseRef.current.activeSegments.push({
            perfStartMs: currentSegmentStartPerfMsRef.current,
            perfEndMs,
            mediaStartMs: currentSegmentStartMediaMsRef.current,
            mediaEndMs,
          });
          cumulativeMediaMsRef.current = mediaEndMs;
          currentSegmentStartPerfMsRef.current = null;
        }
        try {
          mediaRecorderRef.current.pause();
        } catch {
          // ignore
        }
        recordingStateRef.current = 'PAUSED';
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
        const clock = performanceRuntimeRef.current?.resume();
        if (clock) {
          setPerformanceClock(clock);
          metronomeRef.current?.resume(clock);
        } else {
          metronomeRef.current?.resume(0);
        }
        if (mediaRecorderRef.current?.state === 'paused') {
          try {
            mediaRecorderRef.current.resume();
            recordingStateRef.current = 'RECORDING';
            currentSegmentStartPerfMsRef.current = clock ? clock.performanceTimeMs : 0;
            currentSegmentStartMediaMsRef.current = cumulativeMediaMsRef.current;
          } catch {
            recordingUnavailableReasonRef.current = 'RECORDER_RESUME_FAILED';
            recordingStateRef.current = 'UNAVAILABLE';
          }
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
    sessionGenerationRef.current += 1;
    hasFinalizedRef.current = false;
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
