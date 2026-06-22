'use client';

import { LocateFixed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  ScorePreviewControls,
  type ScorePreviewControlsProps,
} from '@/components/score/score-preview-controls';
import { Button } from '@/components/ui/button';

interface ResultsPlaybackDockProps extends Omit<ScorePreviewControlsProps, 'compact'> {
  isFollowSuspended: boolean;
  onReturnToPlaybackPosition: () => void;
}

export function ResultsPlaybackDock({
  isFollowSuspended,
  onReturnToPlaybackPosition,
  ...controls
}: ResultsPlaybackDockProps) {
  const t = useTranslations('common');

  return (
    <div
      data-testid="results-playback-dock"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-2xl backdrop-blur-md">
        {isFollowSuspended ? (
          <div className="mb-2 flex justify-center border-b border-gray-100 pb-2">
            <Button size="sm" variant="outline" onClick={onReturnToPlaybackPosition}>
              <LocateFixed className="mr-2 h-4 w-4" />
              {t('returnToPlaybackPosition')}
            </Button>
          </div>
        ) : null}
        <ScorePreviewControls compact {...controls} />
      </div>
    </div>
  );
}
