'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PCM_CHANNELS,
  convertFloat32ToPcm16,
  downsampleTo16k,
  isAudioWorkletSupported,
  normalizeWorkletSamples,
} from '@/lib/practice/audio-stream';

export function usePracticeAudioStream(onPcmFrame: (frame: ArrayBuffer) => void) {
  const onPcmFrameRef = useRef(onPcmFrame);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const streamingRef = useRef(false);
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isSupported, setIsSupported] = useState(isAudioWorkletSupported);

  useEffect(() => {
    onPcmFrameRef.current = onPcmFrame;
  }, [onPcmFrame]);

  const setStreaming = useCallback((streaming: boolean) => {
    streamingRef.current = streaming;
  }, []);

  const teardown = useCallback(() => {
    streamingRef.current = false;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    muteGainRef.current?.disconnect();
    muteGainRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const setup = useCallback(async () => {
    teardown();
    if (!isAudioWorkletSupported()) {
      setIsSupported(false);
      throw new Error('AudioWorklet is not supported in this browser.');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: PCM_CHANNELS,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      setHasMicPermission(true);
    } catch (error) {
      setHasMicPermission(false);
      throw error;
    }
    streamRef.current = stream;

    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      teardown();
      throw new Error('AudioContext is not supported in this browser.');
    }

    try {
      const audioContext = new AudioContextConstructor();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;
      muteGainRef.current = muteGain;
      await audioContext.audioWorklet.addModule('/audio-worklets/practice-pcm-processor.js');
      const workletNode = new AudioWorkletNode(audioContext, 'practice-pcm-processor');
      workletNodeRef.current = workletNode;
      workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!streamingRef.current) {
          return;
        }
        const samples = normalizeWorkletSamples(event.data);
        if (samples?.length) {
          onPcmFrameRef.current(
            convertFloat32ToPcm16(downsampleTo16k(samples, audioContext.sampleRate))
          );
        }
      };
      sourceNode.connect(workletNode);
      workletNode.connect(muteGain);
      muteGain.connect(audioContext.destination);
      return stream;
    } catch (error) {
      teardown();
      throw error;
    }
  }, [teardown]);

  useEffect(() => {
    return teardown;
  }, [teardown]);

  return { hasMicPermission, isSupported, setStreaming, setup, teardown };
}
