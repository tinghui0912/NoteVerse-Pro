'use client';

import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ScorePreviewControls } from './score-preview-controls';
import { useScorePreviewPlayback } from '@/hooks/score/use-score-preview-playback';
import { cn } from '@/lib/utils';

interface ScorePreviewPanelProps {
  active?: boolean;
  className?: string;
  controlsClassName?: string;
  viewportClassName?: string;
  xmlString: string | null;
}

export function ScorePreviewPanel({
  active = true,
  className,
  controlsClassName,
  viewportClassName,
  xmlString,
}: ScorePreviewPanelProps) {
  const t = useTranslations('common');
  const {
    containerRef,
    currentTime,
    isLoading,
    isLooping,
    isPlaying,
    loadError,
    playPause,
    progress,
    scoreContainerRef,
    seek,
    seekEnd,
    seekStart,
    stop,
    toggleLoop,
    totalTime,
  } = useScorePreviewPlayback({ isOpen: active, xmlString });

  return (
    <div className={cn('flex min-h-0 flex-col gap-4', className)}>
      <style jsx global>{`
        .score-preview-scroll-area {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .score-preview-scroll-area::-webkit-scrollbar {
          display: none;
        }
        .verovio-preview-page {
          position: relative;
          margin: 0 auto 1.5rem;
          overflow: hidden;
          border: 1px solid #e7e5e4;
          border-radius: 0.75rem;
          background: white;
        }
        .verovio-preview-page svg {
          display: block;
          width: 100% !important;
          height: auto;
        }
        .verovio-preview-page .score-playback-cursor {
          position: absolute;
          z-index: 2;
          width: 12px;
          min-height: 1px;
          border-left: 2px solid #f97316;
          border-radius: 2px;
          background: rgb(249 115 22 / 24%);
          box-shadow: 0 0 0 1px rgb(255 255 255 / 55%);
          pointer-events: none;
          transform: translateX(-50%);
          transition: left 80ms linear, top 120ms ease, height 120ms ease;
        }
      `}</style>

      <div
        ref={containerRef}
        className={cn(
          'score-preview-scroll-area relative min-h-[40vh] w-full flex-1 overflow-y-auto overflow-x-hidden rounded-lg bg-white',
          viewportClassName
        )}
      >
        {isLoading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/80 text-muted-foreground backdrop-blur-sm">
            <LoaderCircle className="h-8 w-8 animate-spin" />
            <p>{t('loadingScoreData')}</p>
          </div>
        ) : null}
        {loadError ? (
          <div role="alert" className="absolute inset-0 z-10 flex items-center justify-center bg-white p-6 text-center text-destructive">
            <p>{loadError}</p>
          </div>
        ) : null}
        <div ref={scoreContainerRef} className="h-full w-full" />
      </div>

      <div className={controlsClassName}>
        <ScorePreviewControls
          currentTime={currentTime}
          isLoading={isLoading}
          isLooping={isLooping}
          isPlaying={isPlaying}
          progress={progress}
          totalTime={totalTime}
          onPlayPause={playPause}
          onSeek={seek}
          onSeekEnd={seekEnd}
          onSeekStart={seekStart}
          onStop={stop}
          onToggleLoop={toggleLoop}
        />
      </div>
    </div>
  );
}
