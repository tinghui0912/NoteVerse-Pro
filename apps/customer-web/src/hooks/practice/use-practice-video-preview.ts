'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/kernel/session';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';

type PreviewMessages = {
  preparing: string; ready: string;
  permissionDenied: string; unavailable: string; audioMissing: string; videoMissing: string;
};
export function usePracticeVideoPreview({ practiceMode, inputSource, recordingMode, messages, onFailure }: {
  practiceMode: PracticeMode; inputSource: PracticeInputSource; recordingMode: PracticeRecordingMode | null;
  messages: PreviewMessages; onFailure?: (reason: string) => void;
}) {
  const [cameraPreviewStream, setStream] = useState<MediaStream | null>(null);
  const [cameraStatusMessage, setStatus] = useState<string | null>(null);
  const [isPreparingCamera, setPreparing] = useState(false);
  const generation = useRef(0), owned = useRef<MediaStream | null>(null);
  const disposeOwned = useCallback(() => {
    generation.current++;
    owned.current?.getTracks().forEach(track => track.stop()); owned.current = null;
  }, []);
  const releaseCameraPreview = useCallback(() => {
    disposeOwned();
    setStream(null); setPreparing(false); setStatus(null);
  }, [disposeOwned]);
  const preparePreview = useCallback(async () => {
    if (owned.current) return owned.current;
    if (practiceMode !== 'CONTINUOUS_PLAY' || recordingMode !== 'VIDEO') return null;
    const epoch = ++generation.current;
    setPreparing(true); setStatus(messages.preparing);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' },
        audio: inputSource === 'MIDI' ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false });
      if (epoch !== generation.current) { stream.getTracks().forEach(track => track.stop()); return null; }
      if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('CAMERA_VIDEO_MISSING');
      if (inputSource === 'MIDI' && !stream.getAudioTracks().some(track => track.readyState === 'live')) throw new Error('CAMERA_AUDIO_MISSING');
      owned.current = stream; setStream(stream); setStatus(messages.ready);
      return stream;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (epoch !== generation.current) return null;
      const reason = error instanceof DOMException && error.name === 'NotAllowedError' ? 'CAMERA_PERMISSION_DENIED'
        : error instanceof Error ? error.message : 'CAMERA_UNAVAILABLE';
      setStatus(reason === 'CAMERA_PERMISSION_DENIED' ? messages.permissionDenied
        : reason === 'CAMERA_AUDIO_MISSING' ? messages.audioMissing : reason === 'CAMERA_VIDEO_MISSING' ? messages.videoMissing : messages.unavailable);
      onFailure?.(reason);
      return null;
    } finally { if (epoch === generation.current) setPreparing(false); }
  }, [practiceMode, recordingMode, inputSource, messages, onFailure]);
  useEffect(() => {
    const epoch = generation.current;
    queueMicrotask(() => { if (epoch === generation.current) releaseCameraPreview(); });
    return disposeOwned;
  }, [practiceMode, inputSource, recordingMode, releaseCameraPreview, disposeOwned]);
  const getCameraMediaStream = useCallback(() => owned.current, []);
  return { cameraPreviewStream, cameraStatusMessage, isPreparingCamera, preparePreview, releaseCameraPreview, getCameraMediaStream };
}
