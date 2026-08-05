'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function usePracticeRecording() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const generationRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const replaceAudioUrl = useCallback((nextUrl: string | null) => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
    }
    audioUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    chunksRef.current = [];
    replaceAudioUrl(null);
  }, [replaceAudioUrl]);

  const attach = useCallback(
    (stream: MediaStream) => {
      generationRef.current += 1;
      const generation = generationRef.current;
      chunksRef.current = [];
      replaceAudioUrl(null);

      if (typeof MediaRecorder === 'undefined') {
        recorderRef.current = null;
        return;
      }

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && generation === generationRef.current) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (generation !== generationRef.current) {
          return;
        }
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];
        replaceAudioUrl(URL.createObjectURL(blob));
      };
    },
    [replaceAudioUrl]
  );

  const start = useCallback(() => {
    if (recorderRef.current?.state === 'inactive') {
      chunksRef.current = [];
      recorderRef.current.start();
    }
  }, []);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
    }
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(
    () => () => {
      generationRef.current += 1;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    },
    []
  );

  return { audioUrl, attach, pause, reset, resume, start, stop };
}
