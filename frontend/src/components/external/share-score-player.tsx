'use client';

import { ScorePlaybackDock } from '@/components/score-detail/score-playback-dock';
import { ScorePreviewViewport } from '@/components/score/score-preview-viewport';
import { useScorePreviewPlayback } from '@/hooks/score/use-score-preview-playback';

export function ShareScorePlayer({ rawXml }: { rawXml: string }) {
  const playback = useScorePreviewPlayback({
    isOpen: true,
    xmlString: rawXml,
    followViewport: 'window',
    suspendFollowOnManualScroll: false,
  });

  return (
    <>
      <ScorePreviewViewport
        className="min-h-[55vh] rounded-2xl border bg-white p-4 shadow-lg"
        containerRef={playback.containerRef}
        isLoading={playback.isLoading}
        loadError={playback.loadError}
        scoreContainerRef={playback.scoreContainerRef}
      />
      <ScorePlaybackDock
        currentTime={playback.currentTime}
        isLoading={playback.isLoading}
        isLooping={playback.isLooping}
        isPlaying={playback.isPlaying}
        progress={playback.progress}
        totalTime={playback.totalTime}
        onPlayPause={playback.playPause}
        onSeek={playback.seek}
        onSeekEnd={playback.seekEnd}
        onSeekStart={playback.seekStart}
        onStop={playback.stop}
        onToggleLoop={playback.toggleLoop}
      />
    </>
  );
}
