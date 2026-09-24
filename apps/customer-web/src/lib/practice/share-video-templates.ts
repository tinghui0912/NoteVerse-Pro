import type { Rect } from './split-screen-score-camera';

export type ShareVideoTemplate =
  | { kind: 'landscape' }
  | { kind: 'portrait' }
  | {
      kind: 'floating';
      orientation: 'landscape' | 'portrait';
      position:
        | 'top'
        | 'bottom'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right';
      size: 'small' | 'medium' | 'large';
    };

export type ShareVideoLayout = {
  width: number;
  height: number;
  scoreRect: Rect;
  videoRect: Rect;
  background: string;
  scoreMode: 'page' | 'floating';
  floatingPosition?: 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  floatingSize?: 'small' | 'medium' | 'large';
  scoreBackground?: string;
  scoreImageAlign?: 'center' | 'top' | 'bottom';
};

const PADDING = 24;
const GAP = 24;
const BACKGROUND = '#0f172a';
const SCORE_BACKGROUND = '#ffffff';

export function getShareVideoLayout(template: ShareVideoTemplate): ShareVideoLayout {
  if (template.kind === 'portrait') {
    const width = 720;
    const height = 1280;
    const scoreHeight = 660;
    return {
      width,
      height,
      background: BACKGROUND,
      scoreMode: 'page',
      scoreBackground: SCORE_BACKGROUND,
      scoreRect: { x: PADDING, y: PADDING, width: width - PADDING * 2, height: scoreHeight },
      videoRect: {
        x: PADDING,
        y: PADDING + scoreHeight + GAP,
        width: width - PADDING * 2,
        height: height - PADDING - (PADDING + scoreHeight + GAP),
      },
    };
  }

  if (template.kind === 'floating') {
    const width = template.orientation === 'portrait' ? 720 : 1280;
    const height = template.orientation === 'portrait' ? 1280 : 720;
    const videoRect = { x: 0, y: 0, width, height };
    return {
      width,
      height,
      background: BACKGROUND,
      scoreMode: 'floating',
      // Floating score geometry is resolved per frame from the actual contained
      // video rectangle and the frozen system content bounds.
      scoreRect: { x: 0, y: 0, width: 0, height: 0 },
      videoRect,
      floatingPosition: template.position,
      floatingSize: template.size,
      scoreBackground: undefined,
    };
  }

  const width = 1280;
  const height = 720;
  const scoreWidth = 704;
  return {
    width,
    height,
    background: BACKGROUND,
    scoreMode: 'page',
    scoreBackground: SCORE_BACKGROUND,
    scoreRect: { x: PADDING, y: PADDING, width: scoreWidth, height: height - PADDING * 2 },
    videoRect: {
      x: PADDING + scoreWidth + GAP,
      y: PADDING,
      width: width - PADDING * 2 - scoreWidth - GAP,
      height: height - PADDING * 2,
    },
    scoreImageAlign: 'center',
  };
}

export function getScorePanelBackground(): string {
  return SCORE_BACKGROUND;
}
