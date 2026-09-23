'use client';

import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type {
  PerformanceReplayMidiEvent,
  PlayablePerformanceReplay,
} from '@/lib/practice/performance-replay';

type PerformanceReplayPlayerProps = {
  replay: PlayablePerformanceReplay;
  onReplayTimeChange?: (replayTimeMs: number | null, actualDurationMs?: number | null) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onReplaySeekCommitted?: (replayTimeMs: number) => void;
  onVideoElementChange?: (video: HTMLVideoElement | null) => void;
  autoStart?: boolean;
  actions?: ReactNode;
};

export function PerformanceReplayPlayer({
  replay,
  onReplayTimeChange,
  onPlaybackStateChange,
  onReplaySeekCommitted,
  onVideoElementChange,
  autoStart = false,
  actions,
}: PerformanceReplayPlayerProps) {
  if (replay.kind === 'AUDIO_RECORDING') {
    return (
      <AudioPerformanceReplayPlayer
        replay={replay}
        onReplayTimeChange={onReplayTimeChange}
        onPlaybackStateChange={onPlaybackStateChange}
        onReplaySeekCommitted={onReplaySeekCommitted}
        autoStart={autoStart}
        actions={actions}
      />
    );
  }
  if (replay.kind === 'VIDEO_RECORDING') {
    return (
      <VideoPerformanceReplayPlayer
        replay={replay}
        onReplayTimeChange={onReplayTimeChange}
        onPlaybackStateChange={onPlaybackStateChange}
        onReplaySeekCommitted={onReplaySeekCommitted}
        onVideoElementChange={onVideoElementChange}
        autoStart={autoStart}
        actions={actions}
      />
    );
  }
  return (
    <MidiPerformanceReplayPlayer
      replay={replay}
      onReplayTimeChange={onReplayTimeChange}
      onPlaybackStateChange={onPlaybackStateChange}
      onReplaySeekCommitted={onReplaySeekCommitted}
      autoStart={autoStart}
      actions={actions}
    />
  );
}

type AudioPerformanceReplay = Extract<PlayablePerformanceReplay, { kind: 'AUDIO_RECORDING' }>;
type VideoPerformanceReplay = Extract<PlayablePerformanceReplay, { kind: 'VIDEO_RECORDING' }>;
type MidiPerformanceReplay = Extract<PlayablePerformanceReplay, { kind: 'MIDI_EVENTS' }>;

function AudioPerformanceReplayPlayer({
  replay,
  onReplayTimeChange,
  onPlaybackStateChange,
  onReplaySeekCommitted,
  autoStart,
  actions,
}: {
  replay: AudioPerformanceReplay;
  onReplayTimeChange?: (replayTimeMs: number | null, actualDurationMs?: number | null) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onReplaySeekCommitted?: (replayTimeMs: number) => void;
  autoStart: boolean;
  actions?: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSource = replay.url ?? replay.blob;
  const autoStartedSourceRef = useRef<Blob | string | null>(null);
  const pendingAutoPlaySourceRef = useRef<Blob | string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [prevMediaSource, setPrevMediaSource] = useState(mediaSource);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [actualDurationMs, setActualDurationMs] = useState<number | null>(null);
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const onReplayTimeChangeRef = useRef(onReplayTimeChange);
  useEffect(() => {
    onReplayTimeChangeRef.current = onReplayTimeChange;
  }, [onReplayTimeChange]);

  if (prevMediaSource !== mediaSource) {
    setPrevMediaSource(mediaSource);
    setHasPlaybackError(false);
    setActualDurationMs(null);
  }

  const effectiveDurationMs = actualDurationMs ?? replay.durationMs;

  const publishTime = useCallback(
    (timeMs: number) => {
      const boundedTimeMs = boundReplayTime(timeMs, effectiveDurationMs);
      setCurrentMs(boundedTimeMs);
      if (actualDurationMs !== null) {
        onReplayTimeChange?.(boundedTimeMs, actualDurationMs);
      } else {
        onReplayTimeChange?.(boundedTimeMs);
      }
    },
    [actualDurationMs, effectiveDurationMs, onReplayTimeChange]
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
        animationFrameRef.current = window.requestAnimationFrame(reportPlaybackTime);
        return;
      }
      animationFrameRef.current = null;
    };

    animationFrameRef.current = window.requestAnimationFrame(reportPlaybackTime);
  }, [publishTime, stopRenderTicker]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }
    const audioUrl = replay.url ? replay.url : (replay.blob ? URL.createObjectURL(replay.blob) : '');
    if (!audioUrl) return undefined;

    audio.src = audioUrl;
    audio.load();
    return () => {
      stopRenderTicker();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (!replay.url && audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      onReplayTimeChangeRef.current?.(null);
    };
  }, [replay.blob, replay.url, stopRenderTicker]);

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
      const boundedTimeMs = boundReplayTime(nextTimeMs, effectiveDurationMs);
      if (audio) {
        audio.currentTime = boundedTimeMs / 1000;
      }
      publishTime(boundedTimeMs);
    },
    [effectiveDurationMs, publishTime]
  );

  return (
    <ReplayChrome
      currentMs={currentMs}
      durationMs={effectiveDurationMs}
      isPlaying={isPlaying}
      onTogglePlayback={togglePlayback}
      onSeek={seek}
      onSeekCommitted={onReplaySeekCommitted}
      actions={actions}
      hasPlaybackError={hasPlaybackError}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const dur = event.currentTarget.duration;
          if (Number.isFinite(dur) && dur > 0) {
            setActualDurationMs(dur * 1000);
          }
        }}
        onPlay={() => {
          setIsPlaying(true);
          onPlaybackStateChange?.(true);
          startRenderTicker();
        }}
        onPause={(event) => {
          stopRenderTicker();
          setIsPlaying(false);
          publishTime(event.currentTarget.currentTime * 1000);
          onPlaybackStateChange?.(false);
        }}
        onError={() => {
          stopRenderTicker();
          setIsPlaying(false);
          setHasPlaybackError(true);
        }}
        onSeeked={(event) => publishTime(event.currentTarget.currentTime * 1000)}
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
          publishTime(effectiveDurationMs);
          onPlaybackStateChange?.(false);
        }}
      />
    </ReplayChrome>
  );
}

function VideoPerformanceReplayPlayer({
  replay,
  onReplayTimeChange,
  onPlaybackStateChange,
  onReplaySeekCommitted,
  onVideoElementChange,
  autoStart,
  actions,
}: {
  replay: VideoPerformanceReplay;
  onReplayTimeChange?: (replayTimeMs: number | null, actualDurationMs?: number | null) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onReplaySeekCommitted?: (replayTimeMs: number) => void;
  onVideoElementChange?: (video: HTMLVideoElement | null) => void;
  autoStart: boolean;
  actions?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaSource = replay.url ?? replay.blob;
  const autoStartedSourceRef = useRef<Blob | string | null>(null);
  const pendingAutoPlaySourceRef = useRef<Blob | string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [prevMediaSource, setPrevMediaSource] = useState(mediaSource);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [actualDurationMs, setActualDurationMs] = useState<number | null>(null);
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const onReplayTimeChangeRef = useRef(onReplayTimeChange);
  useEffect(() => {
    onReplayTimeChangeRef.current = onReplayTimeChange;
  }, [onReplayTimeChange]);
  const handleVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element;
      onVideoElementChange?.(element);
    },
    [onVideoElementChange]
  );

  if (prevMediaSource !== mediaSource) {
    setPrevMediaSource(mediaSource);
    setHasPlaybackError(false);
    setActualDurationMs(null);
  }

  const effectiveDurationMs = actualDurationMs ?? replay.durationMs;

  const publishTime = useCallback(
    (timeMs: number) => {
      const boundedTimeMs = boundReplayTime(timeMs, effectiveDurationMs);
      setCurrentMs(boundedTimeMs);
      if (actualDurationMs !== null) {
        onReplayTimeChange?.(boundedTimeMs, actualDurationMs);
      } else {
        onReplayTimeChange?.(boundedTimeMs);
      }
    },
    [actualDurationMs, effectiveDurationMs, onReplayTimeChange]
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
        animationFrameRef.current = window.requestAnimationFrame(reportPlaybackTime);
        return;
      }
      animationFrameRef.current = null;
    };

    animationFrameRef.current = window.requestAnimationFrame(reportPlaybackTime);
  }, [publishTime, stopRenderTicker]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return undefined;
    }
    const videoUrl = replay.url ? replay.url : (replay.blob ? URL.createObjectURL(replay.blob) : '');
    if (!videoUrl) return undefined;

    video.src = videoUrl;
    video.load();
    return () => {
      stopRenderTicker();
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (!replay.url && videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      onReplayTimeChangeRef.current?.(null);
    };
  }, [replay.blob, replay.url, stopRenderTicker]);

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
      const boundedTimeMs = boundReplayTime(nextTimeMs, effectiveDurationMs);
      if (video) {
        video.currentTime = boundedTimeMs / 1000;
      }
      publishTime(boundedTimeMs);
    },
    [effectiveDurationMs, publishTime]
  );

  return (
    <ReplayChrome
      currentMs={currentMs}
      durationMs={effectiveDurationMs}
      isPlaying={isPlaying}
      onTogglePlayback={togglePlayback}
      onSeek={seek}
      onSeekCommitted={onReplaySeekCommitted}
      actions={actions}
      hasPlaybackError={hasPlaybackError}
    >
      <video
        ref={handleVideoRef}
        preload="metadata"
        playsInline
        className="aspect-video w-full rounded-md bg-black object-contain"
        onLoadedMetadata={(event) => {
          const dur = event.currentTarget.duration;
          if (Number.isFinite(dur) && dur > 0) {
            setActualDurationMs(dur * 1000);
          }
        }}
        onPlay={() => {
          setIsPlaying(true);
          onPlaybackStateChange?.(true);
          startRenderTicker();
        }}
        onPause={(event) => {
          stopRenderTicker();
          setIsPlaying(false);
          publishTime(event.currentTarget.currentTime * 1000);
          onPlaybackStateChange?.(false);
        }}
        onError={() => {
          stopRenderTicker();
          setIsPlaying(false);
          setHasPlaybackError(true);
        }}
        onSeeked={(event) => publishTime(event.currentTarget.currentTime * 1000)}
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
          publishTime(effectiveDurationMs);
          onPlaybackStateChange?.(false);
        }}
      />
    </ReplayChrome>
  );
}

function MidiPerformanceReplayPlayer({
  replay,
  onReplayTimeChange,
  onPlaybackStateChange,
  onReplaySeekCommitted,
  autoStart,
  actions,
}: {
  replay: MidiPerformanceReplay;
  onReplayTimeChange?: (replayTimeMs: number | null) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onReplaySeekCommitted?: (replayTimeMs: number) => void;
  autoStart: boolean;
  actions?: ReactNode;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const activeNotesRef = useRef(new Map<number, OscillatorNode[]>());
  const playbackStartedAtMsRef = useRef(0);
  const playbackOffsetMsRef = useRef(0);
  const autoStartedReplayRef = useRef<MidiPerformanceReplay | null>(null);

  const stopScheduledPlayback = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutsRef.current = [];
    activeNotesRef.current.forEach((oscillators) => {
      oscillators.forEach((oscillator) => {
        try {
          oscillator.stop();
        } catch {
          // The oscillator may already have been stopped by a matching note-off event.
        }
      });
    });
    activeNotesRef.current.clear();
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const publishTime = useCallback(
    (timeMs: number) => {
      const boundedTimeMs = boundReplayTime(timeMs, replay.durationMs);
      setCurrentMs(boundedTimeMs);
      onReplayTimeChange?.(boundedTimeMs);
      return boundedTimeMs;
    },
    [onReplayTimeChange, replay.durationMs]
  );

  const pause = useCallback(() => {
    const pausedAtMs = currentMs;
    stopScheduledPlayback();
    playbackOffsetMsRef.current = pausedAtMs;
    setIsPlaying(false);
    onPlaybackStateChange?.(false);
  }, [currentMs, onPlaybackStateChange, stopScheduledPlayback]);

  const scheduleFrom = useCallback(
    (offsetMs: number) => {
      if (typeof AudioContext === 'undefined' || replay.events.length === 0) {
        return;
      }
      stopScheduledPlayback();
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      playbackOffsetMsRef.current = boundReplayTime(offsetMs, replay.durationMs);
      playbackStartedAtMsRef.current = performance.now();
      setIsPlaying(true);
      onPlaybackStateChange?.(true);
      publishTime(playbackOffsetMsRef.current);

      const reportPlaybackTime = () => {
        const elapsedMs = performance.now() - playbackStartedAtMsRef.current;
        const nextTimeMs = publishTime(playbackOffsetMsRef.current + elapsedMs);
        if (nextTimeMs < replay.durationMs) {
          animationFrameRef.current = window.requestAnimationFrame(reportPlaybackTime);
        }
      };
      animationFrameRef.current = window.requestAnimationFrame(reportPlaybackTime);

      replay.events
        .filter((event) => event.timestamp_ms >= playbackOffsetMsRef.current)
        .forEach((event) => {
          const timeoutId = window.setTimeout(() => {
            playMidiEvent(audioContext, activeNotesRef.current, event);
          }, event.timestamp_ms - playbackOffsetMsRef.current);
          timeoutsRef.current.push(timeoutId);
        });

      const finishTimeoutId = window.setTimeout(() => {
        stopScheduledPlayback();
        setIsPlaying(false);
        onPlaybackStateChange?.(false);
        playbackOffsetMsRef.current = replay.durationMs;
        publishTime(replay.durationMs);
      }, replay.durationMs - playbackOffsetMsRef.current + 50);
      timeoutsRef.current.push(finishTimeoutId);
    },
    [onPlaybackStateChange, publishTime, replay.durationMs, replay.events, stopScheduledPlayback]
  );

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      pause();
      return;
    }
    scheduleFrom(currentMs >= replay.durationMs ? 0 : currentMs);
  }, [currentMs, isPlaying, pause, replay.durationMs, scheduleFrom]);

  const seek = useCallback(
    (nextTimeMs: number) => {
      const boundedTimeMs = publishTime(nextTimeMs);
      playbackOffsetMsRef.current = boundedTimeMs;
      if (isPlaying) {
        scheduleFrom(boundedTimeMs);
      }
    },
    [isPlaying, publishTime, scheduleFrom]
  );

  useEffect(() => {
    if (!autoStart || autoStartedReplayRef.current === replay) {
      return undefined;
    }
    autoStartedReplayRef.current = replay;
    const timeoutId = window.setTimeout(() => scheduleFrom(0), 0);
    return () => window.clearTimeout(timeoutId);
  }, [autoStart, replay, scheduleFrom]);

  useEffect(() => {
    return () => {
      stopScheduledPlayback();
      onReplayTimeChange?.(null);
    };
  }, [onReplayTimeChange, stopScheduledPlayback]);

  return (
    <ReplayChrome
      currentMs={currentMs}
      durationMs={replay.durationMs}
      isPlaying={isPlaying}
      onTogglePlayback={togglePlayback}
      onSeek={seek}
      onSeekCommitted={onReplaySeekCommitted}
      actions={actions}
    />
  );
}

function ReplayChrome({
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
  const durationLabel = formatReplayTime(durationMs);
  const currentLabel = formatReplayTime(currentMs);
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
          value={Math.round(boundReplayTime(currentMs, durationMs))}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
          onPointerUp={(event) => onSeekCommitted?.(Number(event.currentTarget.value))}
          onTouchEnd={(event) => onSeekCommitted?.(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
              onSeekCommitted?.(Number(event.currentTarget.value));
            }
          }}
          className="h-2 w-full accent-orange-500"
          aria-label={t('replaySeek')}
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
          {isPlaying ? t('pauseReplay') : t('playReplay')}
        </Button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}

function playMidiEvent(
  audioContext: AudioContext,
  activeNotes: Map<number, OscillatorNode[]>,
  event: PerformanceReplayMidiEvent
) {
  if (event.event_type === 'note_on') {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = midiNoteFrequency(event.note_number);
    gain.gain.value = Math.max(0.05, Math.min(0.35, event.velocity / 360));
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    const oscillators = activeNotes.get(event.note_number) ?? [];
    oscillators.push(oscillator);
    activeNotes.set(event.note_number, oscillators);
    return;
  }

  const oscillators = activeNotes.get(event.note_number);
  const oscillator = oscillators?.shift();
  if (!oscillator) {
    return;
  }
  oscillator.stop(audioContext.currentTime + 0.03);
  if (!oscillators || oscillators.length === 0) {
    activeNotes.delete(event.note_number);
  }
}

function midiNoteFrequency(noteNumber: number) {
  return 440 * 2 ** ((noteNumber - 69) / 12);
}

function boundReplayTime(timeMs: number, durationMs: number) {
  return Math.min(Math.max(Number.isFinite(timeMs) ? timeMs : 0, 0), Math.max(0, durationMs));
}

function formatReplayTime(timeMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
