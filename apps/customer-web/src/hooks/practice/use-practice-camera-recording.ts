'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/kernel/session';
import type { PracticeRecordingMode } from '@/lib/practice/performance-recorder';

type CameraRecordingMessages = {
  continuousOnly: string;
  unsupported: string;
  preparing: string;
  ready: string;
  permissionDenied: string;
  unavailable: string;
  audioMissing: string;
  videoMissing: string;
};

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function usePracticeCameraRecording({ practiceMode, inputSource, messages }: {
  practiceMode: PracticeMode;
  inputSource: PracticeInputSource;
  messages: CameraRecordingMessages;
}) {
  const [recordingMode, setRecordingMode] = useState<PracticeRecordingMode>('OFF');
  const [cameraPreviewStream, setCameraPreviewStream] = useState<MediaStream | null>(null);
  const [cameraStatusMessage, setCameraStatusMessage] = useState<string | null>(null);
  const [isPreparingCamera, setIsPreparingCamera] = useState(false);
  const cameraRequestGenerationRef = useRef(0);

  const releaseCameraPreview = useCallback(() => {
    cameraRequestGenerationRef.current += 1;
    setCameraPreviewStream((current) => {
      stopMediaStream(current);
      return null;
    });
    setRecordingMode('OFF');
    setIsPreparingCamera(false);
  }, []);

  const changeRecordingMode = useCallback(
    async (nextMode: PracticeRecordingMode) => {
      if (nextMode !== 'VIDEO') {
        releaseCameraPreview();
        setRecordingMode(nextMode);
        setCameraStatusMessage(null);
        return;
      }
      if (practiceMode !== 'CONTINUOUS_PLAY') {
        setCameraStatusMessage(messages.continuousOnly);
        return;
      }
      const mediaDevices = globalThis.navigator?.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        setCameraStatusMessage(messages.unsupported);
        return;
      }

      setIsPreparingCamera(true);
      setCameraStatusMessage(messages.preparing);
      const requestGeneration = cameraRequestGenerationRef.current + 1;
      cameraRequestGenerationRef.current = requestGeneration;
      try {
        const stream = await mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
          },
          audio:
            inputSource === 'MIDI'
              ? {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                }
              : false,
        });
        const isStillCurrent =
          cameraRequestGenerationRef.current === requestGeneration &&
          practiceMode === 'CONTINUOUS_PLAY';
        if (!isStillCurrent) {
          stopMediaStream(stream);
          return;
        }
        const hasVideo = stream.getVideoTracks().some((track) => track.readyState === 'live');
        const hasAudio =
          inputSource === 'MICROPHONE' ||
          stream.getAudioTracks().some((track) => track.readyState === 'live');
        if (!hasVideo || !hasAudio) {
          stopMediaStream(stream);
          setCameraStatusMessage(
            hasVideo ? messages.audioMissing : messages.videoMissing
          );
          return;
        }
        setCameraPreviewStream((current) => {
          stopMediaStream(current);
          return stream;
        });
        setRecordingMode('VIDEO');
        setCameraStatusMessage(messages.ready);
      } catch (error) {
        if (cameraRequestGenerationRef.current !== requestGeneration) {
          return;
        }
        const name = error instanceof DOMException ? error.name : '';
        setCameraStatusMessage(
          name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? messages.permissionDenied
            : messages.unavailable
        );
        setRecordingMode('OFF');
      } finally {
        if (cameraRequestGenerationRef.current === requestGeneration) {
          setIsPreparingCamera(false);
        }
      }
    },
    [inputSource, practiceMode, releaseCameraPreview, messages]
  );

  useEffect(() => {
    if (practiceMode !== 'STEP_BY_STEP') {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      releaseCameraPreview();
      setCameraStatusMessage(null);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [practiceMode, releaseCameraPreview]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      releaseCameraPreview();
      setCameraStatusMessage(null);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [inputSource, releaseCameraPreview]);

  useEffect(() => {
    return () => {
      cameraRequestGenerationRef.current += 1;
      stopMediaStream(cameraPreviewStream);
    };
  }, [cameraPreviewStream]);

  return { recordingMode, cameraPreviewStream, cameraStatusMessage, isPreparingCamera,
    changeRecordingMode, releaseCameraPreview };
}
