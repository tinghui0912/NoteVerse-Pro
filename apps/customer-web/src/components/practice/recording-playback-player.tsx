'use client';
import { microsecondsToMilliseconds } from '@/lib/practice/recording/recording-timebase';
import { releaseLocalMediaAsset } from '@/lib/practice/media/local-media-asset';

import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { RecordingPlaybackSource } from '@/lib/practice/recording/recording-playback';

type RecordingPlaybackPlayerProps = {
  source: RecordingPlaybackSource;
  onMediaTimeChange?: (
    mediaTimeMs: number | null,
    actualDurationMs?: number | null,
  ) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onMediaSeekCommitted?: (mediaTimeMs: number) => void;
  onVideoElementChange?: (video: HTMLVideoElement | null) => void;
  autoStart?: boolean;
  actions?: ReactNode;
};

export function RecordingPlaybackPlayer({
  source,
  onMediaTimeChange,
  onPlaybackStateChange,
  onMediaSeekCommitted,
  onVideoElementChange,
  autoStart = false,
  actions,
}: RecordingPlaybackPlayerProps) {
  if (source.kind === 'AUDIO') {
    return (
      <AudioRecordingPlaybackPlayer
        source={source}
        onMediaTimeChange={onMediaTimeChange}
        onPlaybackStateChange={onPlaybackStateChange}
        onMediaSeekCommitted={onMediaSeekCommitted}
        autoStart={autoStart}
        actions={actions}
      />
    );
  }
  if (source.kind === 'VIDEO') {
    return (
      <VideoRecordingPlaybackPlayer
        source={source}
        onMediaTimeChange={onMediaTimeChange}
        onPlaybackStateChange={onPlaybackStateChange}
        onMediaSeekCommitted={onMediaSeekCommitted}
        onVideoElementChange={onVideoElementChange}
        autoStart={autoStart}
        actions={actions}
      />
    );
  }
  return null;
}

type AudioRecordingPlaybackSource = Extract<
  RecordingPlaybackSource,
  { kind: 'AUDIO' }
>;
type VideoRecordingPlaybackSource = Extract<
  RecordingPlaybackSource,
  { kind: 'VIDEO' }
>;

function AudioRecordingPlaybackPlayer({
  source,
  onMediaTimeChange,
  onPlaybackStateChange,
  onMediaSeekCommitted,
  autoStart,
  actions,
}: {
  source: AudioRecordingPlaybackSource;
  onMediaTimeChange?: (
    mediaTimeMs: number | null,
    actualDurationMs?: number | null,
  ) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onMediaSeekCommitted?: (mediaTimeMs: number) => void;
  autoStart: boolean;
  actions?: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSource = source.url ?? source.media?.blob;
  const autoStartedSourceRef = useRef<Blob | string | null>(null);
  const pendingAutoPlaySourceRef = useRef<Blob | string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [prevMediaSource, setPrevMediaSource] = useState(mediaSource);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [actualDurationMs, setActualDurationMs] = useState<number | null>(null);
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const onMediaTimeChangeRef = useRef(onMediaTimeChange);
  useEffect(() => {
    onMediaTimeChangeRef.current = onMediaTimeChange;
  }, [onMediaTimeChange]);

  if (prevMediaSource !== mediaSource) {
    setPrevMediaSource(mediaSource);
    setHasPlaybackError(false);
    setActualDurationMs(null);
  }

  const effectiveDurationMs =
    actualDurationMs ??
    (source.recordingTimebase
      ? microsecondsToMilliseconds(
          source.recordingTimebase.nominalMediaDurationUs,
        )
      : 0);

  const publishTime = useCallback(
    (timeMs: number, durationOverrideMs?: number | null) => {
      const durationMs = durationOverrideMs ?? effectiveDurationMs;
      const boundedTimeMs = boundMediaTime(timeMs, durationMs);
      setCurrentMs(boundedTimeMs);
      if (
        durationOverrideMs !== undefined &&
        durationOverrideMs !== actualDurationMs
      ) {
        setActualDurationMs(durationOverrideMs);
      }
      const reportedDurationMs = durationOverrideMs ?? actualDurationMs;
      if (reportedDurationMs !== null) {
        onMediaTimeChange?.(boundedTimeMs, reportedDurationMs);
      } else {
        onMediaTimeChange?.(boundedTimeMs);
      }
    },
    [actualDurationMs, effectiveDurationMs, onMediaTimeChange],
  );

  const updateActualDuration = useCallback((audio: HTMLAudioElement) => {
    const durationMs = finiteMediaDurationMs(audio);
    if (durationMs === null) {
      return null;
    }
    setActualDurationMs(durationMs);
    return durationMs;
  }, []);

  const publishElementTime = useCallback(
    (audio: HTMLAudioElement) => {
      const durationMs = updateActualDuration(audio) ?? actualDurationMs;
      publishTime(audio.currentTime * 1000, durationMs);
    },
    [actualDurationMs, publishTime, updateActualDuration],
  );

  const stopRenderTicker = useCallback(() => {
    if (animationFrameRef.current === null) {
      return;
    }
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const startRenderTicker = useCallback(() => {
    stopRenderTicker();

    const reportPlaybackTime = () => {
      const audio = audioRef.current;
      if (!audio) {
        animationFrameRef.current = null;
        return;
      }
      publishTime(audio.currentTime * 1000);
      if (!audio.paused && !audio.ended) {
        animationFrameRef.current =
          window.requestAnimationFrame(reportPlaybackTime);
        return;
      }
      animationFrameRef.current = null;
    };

    animationFrameRef.current =
      window.requestAnimationFrame(reportPlaybackTime);
  }, [publishTime, stopRenderTicker]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }
    const lease = source.media?.retain();
    const audioUrl = source.url
      ? source.url
      : lease
        ? URL.createObjectURL(lease.blob)
        : '';
    if (!audioUrl) return undefined;

    audio.src = audioUrl;
    audio.load();
    return () => {
      stopRenderTicker();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (!source.url && audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (lease) void releaseLocalMediaAsset(lease);
      onMediaTimeChangeRef.current?.(null);
    };
  }, [source.media, source.url, stopRenderTicker]);

  const startAudioPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return false;
    }
    void audio.play().catch(() => {
      stopRenderTicker();
      setIsPlaying(false);
      setHasPlaybackError(true);
    });
    return true;
  }, [stopRenderTicker]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!autoStart || !audio || autoStartedSourceRef.current === mediaSource) {
      return;
    }
    autoStartedSourceRef.current = mediaSource ?? null;
    pendingAutoPlaySourceRef.current = mediaSource ?? null;
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      pendingAutoPlaySourceRef.current = null;
      startAudioPlayback();
    }
  }, [autoStart, mediaSource, startAudioPlayback]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => {
        stopRenderTicker();
        setIsPlaying(false);
        setHasPlaybackError(true);
      });
      return;
    }
    audio.pause();
  }, [stopRenderTicker]);

  const seek = useCallback(
    (nextTimeMs: number) => {
      const audio = audioRef.current;
      const boundedTimeMs = boundMediaTime(nextTimeMs, effectiveDurationMs);
      if (audio) {
        audio.currentTime = boundedTimeMs / 1000;
      }
      publishTime(boundedTimeMs);
    },
    [effectiveDurationMs, publishTime],
  );

  return (
    <RecordingPlaybackChrome
      currentMs={currentMs}
      durationMs={effectiveDurationMs}
      isPlaying={isPlaying}
      onTogglePlayback={togglePlayback}
      onSeek={seek}
      onSeekCommitted={onMediaSeekCommitted}
      actions={actions}
      hasPlaybackError={hasPlaybackError}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          updateActualDuration(event.currentTarget);
        }}
        onDurationChange={(event) => {
          updateActualDuration(event.currentTarget);
        }}
        onPlay={() => {
          setIsPlaying(true);
          onPlaybackStateChange?.(true);
          startRenderTicker();
        }}
        onPause={(event) => {
          stopRenderTicker();
          setIsPlaying(false);
          publishElementTime(event.currentTarget);
          onPlaybackStateChange?.(false);
        }}
        onError={() => {
          stopRenderTicker();
          setIsPlaying(false);
          setHasPlaybackError(true);
        }}
        onSeeked={(event) => publishElementTime(event.currentTarget)}
        onCanPlay={() => {
          if (pendingAutoPlaySourceRef.current !== mediaSource) {
            return;
          }
          pendingAutoPlaySourceRef.current = null;
          startAudioPlayback();
        }}
        onEnded={() => {
          stopRenderTicker();
          setIsPlaying(false);
          const audio = audioRef.current;
          if (audio) {
            publishElementTime(audio);
          } else {
            publishTime(effectiveDurationMs);
          }
          onPlaybackStateChange?.(false);
        }}
      />
    </RecordingPlaybackChrome>
  );
}

function VideoRecordingPlaybackPlayer({
  source,
  onMediaTimeChange,
  onPlaybackStateChange,
  onMediaSeekCommitted,
  onVideoElementChange,
  autoStart,
  actions,
}: {
  source: VideoRecordingPlaybackSource;
  onMediaTimeChange?: (
    mediaTimeMs: number | null,
    actualDurationMs?: number | null,
  ) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onMediaSeekCommitted?: (mediaTimeMs: number) => void;
  onVideoElementChange?: (video: HTMLVideoElement | null) => void;
  autoStart: boolean;
  actions?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaSource = source.url ?? source.media?.blob;
  const autoStartedSourceRef = useRef<Blob | string | null>(null);
  const pendingAutoPlaySourceRef = useRef<Blob | string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [prevMediaSource, setPrevMediaSource] = useState(mediaSource);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [actualDurationMs, setActualDurationMs] = useState<number | null>(null);
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const onMediaTimeChangeRef = useRef(onMediaTimeChange);
  useEffect(() => {
    onMediaTimeChangeRef.current = onMediaTimeChange;
  }, [onMediaTimeChange]);
  const handleVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element;
      onVideoElementChange?.(element);
    },
    [onVideoElementChange],
  );

  if (prevMediaSource !== mediaSource) {
    setPrevMediaSource(mediaSource);
    setHasPlaybackError(false);
    setActualDurationMs(null);
  }

  const effectiveDurationMs =
    actualDurationMs ??
    (source.recordingTimebase
      ? microsecondsToMilliseconds(
          source.recordingTimebase.nominalMediaDurationUs,
        )
      : 0);

  const publishTime = useCallback(
    (timeMs: number, durationOverrideMs?: number | null) => {
      const durationMs = durationOverrideMs ?? effectiveDurationMs;
      const boundedTimeMs = boundMediaTime(timeMs, durationMs);
      setCurrentMs(boundedTimeMs);
      if (
        durationOverrideMs !== undefined &&
        durationOverrideMs !== actualDurationMs
      ) {
        setActualDurationMs(durationOverrideMs);
      }
      const reportedDurationMs = durationOverrideMs ?? actualDurationMs;
      if (reportedDurationMs !== null) {
        onMediaTimeChange?.(boundedTimeMs, reportedDurationMs);
      } else {
        onMediaTimeChange?.(boundedTimeMs);
      }
    },
    [actualDurationMs, effectiveDurationMs, onMediaTimeChange],
  );

  const updateActualDuration = useCallback((video: HTMLVideoElement) => {
    const durationMs = finiteMediaDurationMs(video);
    if (durationMs === null) {
      return null;
    }
    setActualDurationMs(durationMs);
    return durationMs;
  }, []);

  const publishElementTime = useCallback(
    (video: HTMLVideoElement) => {
      const durationMs = updateActualDuration(video) ?? actualDurationMs;
      publishTime(video.currentTime * 1000, durationMs);
    },
    [actualDurationMs, publishTime, updateActualDuration],
  );

  const stopRenderTicker = useCallback(() => {
    if (animationFrameRef.current === null) {
      return;
    }
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const startRenderTicker = useCallback(() => {
    stopRenderTicker();

    const reportPlaybackTime = () => {
      const video = videoRef.current;
      if (!video) {
        animationFrameRef.current = null;
        return;
      }
      publishTime(video.currentTime * 1000);
      if (!video.paused && !video.ended) {
        animationFrameRef.current =
          window.requestAnimationFrame(reportPlaybackTime);
        return;
      }
      animationFrameRef.current = null;
    };

    animationFrameRef.current =
      window.requestAnimationFrame(reportPlaybackTime);
  }, [publishTime, stopRenderTicker]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return undefined;
    }
    const lease = source.media?.retain();
    const videoUrl = source.url
      ? source.url
      : lease
        ? URL.createObjectURL(lease.blob)
        : '';
    if (!videoUrl) return undefined;

    video.src = videoUrl;
    video.load();
    return () => {
      stopRenderTicker();
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (!source.url && videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      if (lease) void releaseLocalMediaAsset(lease);
      onMediaTimeChangeRef.current?.(null);
    };
  }, [source.media, source.url, stopRenderTicker]);

  const startVideoPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return false;
    }
    void video.play().catch(() => {
      stopRenderTicker();
      setIsPlaying(false);
      setHasPlaybackError(true);
    });
    return true;
  }, [stopRenderTicker]);

  useEffect(() => {
    const video = videoRef.current;
    if (!autoStart || !video || autoStartedSourceRef.current === mediaSource) {
      return;
    }
    autoStartedSourceRef.current = mediaSource ?? null;
    pendingAutoPlaySourceRef.current = mediaSource ?? null;
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      pendingAutoPlaySourceRef.current = null;
      startVideoPlayback();
    }
  }, [autoStart, mediaSource, startVideoPlayback]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play().catch(() => {
        stopRenderTicker();
        setIsPlaying(false);
        setHasPlaybackError(true);
      });
      return;
    }
    video.pause();
  }, [stopRenderTicker]);

  const seek = useCallback(
    (nextTimeMs: number) => {
      const video = videoRef.current;
      const boundedTimeMs = boundMediaTime(nextTimeMs, effectiveDurationMs);
      if (video) {
        video.currentTime = boundedTimeMs / 1000;
      }
      publishTime(boundedTimeMs);
    },
    [effectiveDurationMs, publishTime],
  );

  return (
    <RecordingPlaybackChrome
      currentMs={currentMs}
      durationMs={effectiveDurationMs}
      isPlaying={isPlaying}
      onTogglePlayback={togglePlayback}
      onSeek={seek}
      onSeekCommitted={onMediaSeekCommitted}
      actions={actions}
      hasPlaybackError={hasPlaybackError}
    >
      <video
        ref={handleVideoRef}
        preload="metadata"
        playsInline
        className="aspect-video w-full rounded-md bg-black object-contain"
        onLoadedMetadata={(event) => {
          updateActualDuration(event.currentTarget);
        }}
        onDurationChange={(event) => {
          updateActualDuration(event.currentTarget);
        }}
        onPlay={() => {
          setIsPlaying(true);
          onPlaybackStateChange?.(true);
          startRenderTicker();
        }}
        onPause={(event) => {
          stopRenderTicker();
          setIsPlaying(false);
          publishElementTime(event.currentTarget);
          onPlaybackStateChange?.(false);
        }}
        onError={() => {
          stopRenderTicker();
          setIsPlaying(false);
          setHasPlaybackError(true);
        }}
        onSeeked={(event) => publishElementTime(event.currentTarget)}
        onCanPlay={() => {
          if (pendingAutoPlaySourceRef.current !== mediaSource) {
            return;
          }
          pendingAutoPlaySourceRef.current = null;
          startVideoPlayback();
        }}
        onEnded={() => {
          stopRenderTicker();
          setIsPlaying(false);
          const video = videoRef.current;
          if (video) {
            publishElementTime(video);
          } else {
            publishTime(effectiveDurationMs);
          }
          onPlaybackStateChange?.(false);
        }}
      />
    </RecordingPlaybackChrome>
  );
}

function RecordingPlaybackChrome({
  children,
  currentMs,
  durationMs,
  isPlaying,
  onTogglePlayback,
  onSeek,
  onSeekCommitted,
  actions,
  hasPlaybackError = false,
}: {
  children?: ReactNode;
  currentMs: number;
  durationMs: number;
  isPlaying: boolean;
  onTogglePlayback: () => void;
  onSeek: (timeMs: number) => void;
  onSeekCommitted?: (timeMs: number) => void;
  actions?: ReactNode;
  hasPlaybackError?: boolean;
}) {
  const t = useTranslations('practice');
  const durationLabel = formatMediaTime(durationMs);
  const currentLabel = formatMediaTime(currentMs);
  return (
    <div className="space-y-3">
      {children}
      {hasPlaybackError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
          <span>{t('audioPlaybackFailed')}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-sm tabular-nums text-slate-600">
        <span>{currentLabel}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, Math.round(durationMs))}
          step={50}
          value={Math.round(boundMediaTime(currentMs, durationMs))}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
          onPointerUp={(event) =>
            onSeekCommitted?.(Number(event.currentTarget.value))
          }
          onTouchEnd={(event) =>
            onSeekCommitted?.(Number(event.currentTarget.value))
          }
          onKeyUp={(event) => {
            if (
              event.key.startsWith('Arrow') ||
              event.key === 'Home' ||
              event.key === 'End'
            ) {
              onSeekCommitted?.(Number(event.currentTarget.value));
            }
          }}
          className="h-2 w-full accent-orange-500"
          aria-label={t('recordingSeek')}
          disabled={hasPlaybackError || durationMs <= 0}
        />
        <span>{durationLabel}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 w-24"
          onClick={onTogglePlayback}
          disabled={hasPlaybackError || durationMs <= 0}
        >
          {isPlaying ? (
            <Pause className="mr-2 h-4 w-4" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {isPlaying ? t('pauseRecording') : t('playRecording')}
        </Button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}

function boundMediaTime(timeMs: number, durationMs: number) {
  return Math.min(
    Math.max(Number.isFinite(timeMs) ? timeMs : 0, 0),
    Math.max(0, durationMs),
  );
}

function finiteMediaDurationMs(media: HTMLMediaElement) {
  return Number.isFinite(media.duration) && media.duration > 0
    ? media.duration * 1000
    : null;
}

function formatMediaTime(timeMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
