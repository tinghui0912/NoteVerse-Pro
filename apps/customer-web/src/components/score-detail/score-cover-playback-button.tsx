'use client';

import { Loader2, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { reportUnexpectedClientError } from '@/lib/observability';
import { cn } from '@/lib/utils';

interface ScoreCoverPlaybackButtonProps {
  audioSrc?: string | null;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}

export function ScoreCoverPlaybackButton({
  audioSrc,
  className,
  disabled = false,
  loading = false,
}: ScoreCoverPlaybackButtonProps) {
  const t = useTranslations('score');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const busy = audioBusy;
  const unavailable = disabled || !audioSrc;

  const togglePlayback = async () => {
    if (unavailable || loading || !audioSrc) return;
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
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'score_cover_playback',
        action: 'play_audio_asset',
      });
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
        aria-label={loading ? t('playbackPreparing') : audioPlaying ? t('pauseScore') : t('playScore')}
        title={loading ? t('playbackPreparing') : unavailable ? t('playbackUnavailable') : undefined}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-black/60 text-white shadow-lg backdrop-blur transition hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-70',
          className
        )}
        disabled={busy || loading || unavailable}
        onClick={() => void togglePlayback()}
      >
        {busy || loading ? (
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
