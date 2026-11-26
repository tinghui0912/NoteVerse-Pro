'use client';

import { Loader2, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { reportUnexpectedClientError } from '@/lib/observability';
import { cn } from '@/lib/utils';

interface ScoreCoverPlaybackButtonProps {
  loadPlayback?: () => Promise<{ playback_url: string; expires_in: number }>;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}

export function ScoreCoverPlaybackButton({
  loadPlayback,
  className,
  disabled = false,
  loading = false,
}: ScoreCoverPlaybackButtonProps) {
  const t = useTranslations('score');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const busy = audioBusy;
  const [failed, setFailed] = useState(false);
  const expiry = useRef(0);
  const mounted = useRef(false);
  const unavailable = disabled || !loadPlayback;

  const togglePlayback = async () => {
    if (unavailable || loading || !loadPlayback) return;
    if (audioPlaying && audioRef.current) { audioRef.current.pause(); return; }
    setAudioBusy(true);
    setFailed(false);
    try {
      let audio = audioRef.current;
      if (!audio || Date.now() >= expiry.current) {
        audio?.pause();
        const access = await loadPlayback();
        if (!mounted.current) return;
        audio = new Audio(access.playback_url);
        expiry.current = Date.now() + Math.max(0, access.expires_in - 5) * 1000;
        audio.preload = 'metadata';
        audio.addEventListener('ended', () => setAudioPlaying(false));
        audio.addEventListener('pause', () => setAudioPlaying(false));
        audio.addEventListener('play', () => setAudioPlaying(true));
        audio.addEventListener('error', () => { expiry.current = 0; setFailed(true); setAudioPlaying(false); });
        audioRef.current = audio;
      }
      await audio.play();
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'score_cover_playback',
        action: 'play_audio_asset',
      });
      setFailed(true);
      audioRef.current = null;
      setAudioPlaying(false);
    } finally {
      setAudioBusy(false);
    }
  };

  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    audioRef.current?.pause();
    audioRef.current = null;
  }; }, []);

  return (
    <>
      {failed ? <span role="alert">{t('playbackRefreshHint')}</span> : null}
      <button
        type="button"
        aria-label={loading ? t('playbackPreparing') : unavailable ? t('playbackUnavailable') : audioPlaying ? t('pauseScore') : t('playScore')}
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
