'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPerformanceReplayTimebase,
  type PlayablePerformanceReplay,
  type PerformanceReplayTimebase,
} from '@/lib/practice/performance-replay';

export function usePracticeRecording() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const generationRef = useRef(0);
  const recorderErroredRef = useRef(false);
  const activeSegmentStartedAtMsRef = useRef<number | null>(null);
  const accumulatedActiveMsRef = useRef(0);
  const timebaseRef = useRef<PerformanceReplayTimebase>(
    createPerformanceReplayTimebase(1)
  );
  const [audioReplay, setAudioReplay] =
    useState<Extract<PlayablePerformanceReplay, { kind: 'AUDIO_RECORDING' }> | null>(null);
  const [finalizationStatus, setFinalizationStatus] = useState<
    'idle' | 'recording' | 'finalizing' | 'ready' | 'failed'
  >('idle');

  const finishActiveSegment = useCallback(() => {
    const segmentStartedAtMs = activeSegmentStartedAtMsRef.current;
    if (segmentStartedAtMs !== null) {
      accumulatedActiveMsRef.current += Math.max(0, performance.now() - segmentStartedAtMs);
      activeSegmentStartedAtMsRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    activeSegmentStartedAtMsRef.current = null;
    accumulatedActiveMsRef.current = 0;
    chunksRef.current = [];
    recorderErroredRef.current = false;
    setAudioReplay(null);
    setFinalizationStatus('idle');
  }, []);

  const attach = useCallback(
    (stream: MediaStream) => {
      generationRef.current += 1;
      const generation = generationRef.current;
      chunksRef.current = [];
      activeSegmentStartedAtMsRef.current = null;
      accumulatedActiveMsRef.current = 0;
      recorderErroredRef.current = false;
      setAudioReplay(null);
      setFinalizationStatus('idle');

      if (typeof MediaRecorder === 'undefined') {
        recorderRef.current = null;
        setFinalizationStatus('failed');
        return;
      }

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && generation === generationRef.current) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        if (generation === generationRef.current) {
          recorderErroredRef.current = true;
          setFinalizationStatus('failed');
        }
      };
      recorder.onstop = () => {
        if (generation !== generationRef.current) {
          return;
        }
        finishActiveSegment();
        if (recorderErroredRef.current) {
          chunksRef.current = [];
          setFinalizationStatus('failed');
          return;
        }
        const contentType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: contentType });
        chunksRef.current = [];
        const durationMs = Math.max(0, Math.round(accumulatedActiveMsRef.current));
        setAudioReplay({
          kind: 'AUDIO_RECORDING',
          blob,
          contentType,
          byteSize: blob.size,
          durationMs,
          timebase: timebaseRef.current,
        });
        setFinalizationStatus('ready');
      };
    },
    [finishActiveSegment]
  );

  const start = useCallback((timebase = createPerformanceReplayTimebase(1)) => {
    if (recorderRef.current?.state === 'inactive') {
      chunksRef.current = [];
      accumulatedActiveMsRef.current = 0;
      recorderErroredRef.current = false;
      timebaseRef.current = timebase;
      activeSegmentStartedAtMsRef.current = performance.now();
      setFinalizationStatus('recording');
      recorderRef.current.start(250);
    }
  }, []);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      finishActiveSegment();
      recorderRef.current.pause();
    }
  }, [finishActiveSegment]);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      activeSegmentStartedAtMsRef.current = performance.now();
      recorderRef.current.resume();
    }
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      finishActiveSegment();
      setFinalizationStatus('finalizing');
      recorderRef.current.requestData();
      recorderRef.current.stop();
    }
  }, [finishActiveSegment]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    },
    []
  );

  return { audioReplay, attach, finalizationStatus, pause, reset, resume, start, stop };
}
