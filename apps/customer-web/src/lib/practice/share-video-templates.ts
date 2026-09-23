import type { Rect } from './split-screen-score-camera';

export type ShareVideoTemplate =
  | { kind: 'landscape' }
  | { kind: 'portrait' }
  | {
      kind: 'floating';
      orientation: 'landscape' | 'portrait';
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    };

export type ShareVideoLayout = {
  width: number;
  height: number;
  scoreRect: Rect;
  videoRect: Rect;
  background: string;
  cardRect?: Rect;
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
    const cardWidth = Math.round(width * 0.46);
    const cardHeight = Math.round(height * 0.42);
    const margin = 20;
    const x = template.position.endsWith('right') ? width - cardWidth - margin : margin;
    const y = template.position.startsWith('bottom') ? height - cardHeight - margin : margin;
    const cardRect = { x, y, width: cardWidth, height: cardHeight };
    return {
      width,
      height,
      background: BACKGROUND,
      scoreRect: {
        x: cardRect.x + 12,
        y: cardRect.y + 12,
        width: cardRect.width - 24,
        height: cardRect.height - 24,
      },
      videoRect,
      cardRect,
    };
  }

  const width = 1280;
  const height = 720;
  const scoreWidth = 704;
  return {
    width,
    height,
    background: BACKGROUND,
    scoreRect: { x: PADDING, y: PADDING, width: scoreWidth, height: height - PADDING * 2 },
    videoRect: {
      x: PADDING + scoreWidth + GAP,
      y: PADDING,
      width: width - PADDING * 2 - scoreWidth - GAP,
      height: height - PADDING * 2,
    },
  };
}

export function getScorePanelBackground(): string {
  return SCORE_BACKGROUND;
}
