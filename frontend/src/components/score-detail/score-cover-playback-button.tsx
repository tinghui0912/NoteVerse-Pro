'use client';

import { Loader2, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface ScoreCoverPlaybackButtonProps {
  audioSrc: string;
  className?: string;
}

export function ScoreCoverPlaybackButton({ audioSrc, className }: ScoreCoverPlaybackButtonProps) {
  const t = useTranslations('score');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const busy = audioBusy;

  const togglePlayback = async () => {
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(audioSrc);
      audio.preload = 'metadata';
      audio.addEventListener('ended', () => setAudioPlaying(false));
      audio.addEventListener('pause', () => setAudioPlaying(false));
      audio.addEventListener('play', () => setAudioPlaying(true));
      audioRef.current = audio;
    }
    if (audioPlaying) {
      audio.pause();
      return;
    }
    setAudioBusy(true);
    try {
      await audio.play();
    } catch {
      audioRef.current = null;
      setAudioPlaying(false);
    } finally {
      setAudioBusy(false);
    }
  };

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label={audioPlaying ? t('pauseScore') : t('playScore')}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-black/60 text-white shadow-lg backdrop-blur transition hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-70',
          className
        )}
        disabled={busy}
        onClick={() => void togglePlayback()}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : audioPlaying ? (
          <Pause className="h-5 w-5 fill-current" />
        ) : (
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        )}
      </button>
    </>
  );
}
