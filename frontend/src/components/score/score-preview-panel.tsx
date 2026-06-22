'use client';

import { ScorePreviewControls } from './score-preview-controls';
import { ScorePreviewViewport } from './score-preview-viewport';
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
      <ScorePreviewViewport
        className={viewportClassName}
        containerRef={containerRef}
        isLoading={isLoading}
        loadError={loadError}
        scoreContainerRef={scoreContainerRef}
      />

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
