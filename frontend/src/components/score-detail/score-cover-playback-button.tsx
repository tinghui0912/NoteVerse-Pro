'use client';

import { Loader2, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useScorePreviewPlayback } from '@/hooks/score/use-score-preview-playback';
import { cn } from '@/lib/utils';

interface ScoreCoverPlaybackButtonProps {
  audioSrc?: string;
  loadXml?: () => Promise<string | null>;
  className?: string;
}

export function ScoreCoverPlaybackButton({ audioSrc, loadXml, className }: ScoreCoverPlaybackButtonProps) {
  const t = useTranslations('score');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [xml, setXml] = useState<string | null>(null);
  const [loadingXml, setLoadingXml] = useState(false);
  const [playWhenReady, setPlayWhenReady] = useState(false);
  const playback = useScorePreviewPlayback({
    isOpen: Boolean(xml),
    xmlString: xml,
    followViewport: 'container',
    suspendFollowOnManualScroll: false,
  });
  const isPlaying = audioSrc ? audioPlaying : playback.isPlaying;
  const busy = audioBusy || loadingXml || Boolean(xml && playback.isLoading);

  const togglePlayback = async () => {
    if (audioSrc) {
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
      return;
    }

    if (!loadXml) return;
    if (!xml) {
      setLoadingXml(true);
      try {
        const nextXml = await loadXml();
        if (nextXml) {
          setPlayWhenReady(true);
          setXml(nextXml);
        }
      } finally {
        setLoadingXml(false);
      }
      return;
    }
    await playback.playPause();
  };

  useEffect(() => {
    if (!playWhenReady || playback.isLoading || !xml) return;
    setPlayWhenReady(false);
    void playback.playPause();
  }, [playWhenReady, playback, xml]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label={isPlaying ? t('pauseScore') : t('playScore')}
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-black/60 text-white shadow-lg backdrop-blur transition hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-70',
          className
        )}
        disabled={busy}
        onClick={() => void togglePlayback()}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-5 w-5 fill-current" />
        ) : (
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        )}
      </button>
      <div
        ref={playback.containerRef}
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] top-0 h-px w-[320px] overflow-hidden opacity-0"
      >
        <div ref={playback.scoreContainerRef} />
      </div>
    </>
  );
}
