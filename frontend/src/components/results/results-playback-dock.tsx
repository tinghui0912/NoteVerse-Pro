'use client';

import {
  ScorePreviewControls,
  type ScorePreviewControlsProps,
} from '@/components/score/score-preview-controls';

type ResultsPlaybackDockProps = Omit<ScorePreviewControlsProps, 'compact'>;

export function ResultsPlaybackDock(controls: ResultsPlaybackDockProps) {
  return (
    <div
      data-testid="results-playback-dock"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-2xl backdrop-blur-md">
        <ScorePreviewControls compact {...controls} />
      </div>
    </div>
  );
}
