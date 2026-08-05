'use client';

import {
  ScorePreviewControls,
  type ScorePreviewControlsProps,
} from '@/components/score-preview/score-preview-controls';

type EditorBottomPlayerProps = Omit<ScorePreviewControlsProps, 'compact'>;

export function EditorBottomPlayer(props: EditorBottomPlayerProps) {
  return (
    <div className="sticky bottom-4 z-20 rounded-2xl border bg-white/95 p-3 shadow-lg backdrop-blur">
      <ScorePreviewControls compact {...props} />
    </div>
  );
}
