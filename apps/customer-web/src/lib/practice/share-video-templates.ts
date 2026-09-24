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
  cardRect?: Rect;
  scoreBackground?: string;
  scoreImageAlign?: 'center' | 'top' | 'bottom';
};

const PADDING = 24;
const GAP = 24;
const BACKGROUND = '#0f172a';
const SCORE_BACKGROUND = '#ffffff';
const FLOATING_CARD_MARGIN = 20;
const FLOATING_CARD_PADDING = 16;
const FLOATING_CARD_SIZES = {
  landscape: {
    small: { width: 0.34, height: 0.3 },
    medium: { width: 0.46, height: 0.42 },
    large: { width: 0.58, height: 0.52 },
  },
  portrait: {
    small: { width: 0.48, height: 0.24 },
    medium: { width: 0.6, height: 0.34 },
    large: { width: 0.72, height: 0.46 },
  },
} as const;

export function getShareVideoLayout(template: ShareVideoTemplate): ShareVideoLayout {
  if (template.kind === 'portrait') {
    const width = 720;
    const height = 1280;
    const scoreHeight = 660;
    return {
      width,
      height,
      background: BACKGROUND,
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
    const preset = FLOATING_CARD_SIZES[template.orientation][template.size];
    const maxCardWidth = width - FLOATING_CARD_MARGIN * 2;
    const maxCardHeight = height - FLOATING_CARD_MARGIN * 2;
    const cardWidth = Math.min(maxCardWidth, Math.round(width * preset.width));
    const cardHeight = Math.min(maxCardHeight, Math.round(height * preset.height));
    const x = template.position === 'top' || template.position === 'bottom'
      ? Math.round((width - cardWidth) / 2)
      : template.position.endsWith('right')
        ? width - cardWidth - FLOATING_CARD_MARGIN
        : FLOATING_CARD_MARGIN;
    const y = template.position.startsWith('bottom')
      ? height - cardHeight - FLOATING_CARD_MARGIN
      : FLOATING_CARD_MARGIN;
    const cardRect = { x, y, width: cardWidth, height: cardHeight };
    return {
      width,
      height,
      background: BACKGROUND,
      scoreRect: {
        x: cardRect.x + FLOATING_CARD_PADDING,
        y: cardRect.y + FLOATING_CARD_PADDING,
        width: cardRect.width - FLOATING_CARD_PADDING * 2,
        height: cardRect.height - FLOATING_CARD_PADDING * 2,
      },
      videoRect,
      cardRect,
      scoreBackground: undefined,
      scoreImageAlign: template.position.startsWith('bottom')
        ? 'bottom'
        : 'top',
    };
  }

  const width = 1280;
  const height = 720;
  const scoreWidth = 704;
  return {
    width,
    height,
    background: BACKGROUND,
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
