import type { SvgRect } from './playhead-cursor';
import {
  getEventScoreImage,
  resolveExportPlaybackGeometry,
  type ScorePageCache,
  type SvgViewBox,
} from './split-screen-score-model';
import { svgRectToCanvasRect, type Rect } from './split-screen-score-camera';

export type SplitScreenFramePosition = {
  eventId?: string;
  pageNumber: number;
  noteIds: string[];
  musicalBeat: number;
  perfTimeMs: number;
};

export type SplitScreenPlaybackTimeline = {
  resolve(mediaTimeMs: number): SplitScreenFramePosition | null;
};

export type SplitScreenOutputLayout = {
  scoreRect: Rect;
  videoRect: Rect;
  background: string;
  scoreMode?: 'page' | 'floating';
  floatingPosition?: 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  floatingSize?: 'small' | 'medium' | 'large';
  scoreBackground?: string;
  scoreImageAlign?: 'center' | 'top' | 'bottom';
};

export type SplitScreenFrameDiagnostics = {
  position: SplitScreenFramePosition;
  pageNumber: number;
  systemId: string;
  staffId: string;
  measureId: string;
  anchorNoteId: string;
  viewport: SvgRect;
  anchorBox: SvgRect;
  cursorBox: Rect;
  scoreRect: Rect;
  imageRect: Rect;
  videoDrawRect: Rect;
};

const FLOATING_SCORE_WIDTH_FACTORS = {
  small: 0.72,
  medium: 0.86,
  large: 0.94,
} as const;

const FLOATING_SAFE_MARGIN = 20;
const FLOATING_VIDEO_GAP = 16;
const FLOATING_MAX_HEIGHT_RATIO = 0.42;

export async function renderSplitScreenFrameAtTime({
  mediaTimeMs,
  scoreModel,
  playbackTimeline,
  sourceVideoFrame,
  outputCanvas,
  layout,
  context,
}: {
  mediaTimeMs: number;
  scoreModel: ScorePageCache;
  playbackTimeline: SplitScreenPlaybackTimeline;
  sourceVideoFrame: CanvasImageSource;
  outputCanvas: HTMLCanvasElement;
  layout: SplitScreenOutputLayout;
  context?: CanvasRenderingContext2D;
}): Promise<SplitScreenFrameDiagnostics> {
  const position = playbackTimeline.resolve(mediaTimeMs);
  if (!position) {
    throw new Error('split_screen_export_failed:playback_position_unavailable');
  }
  const page = scoreModel.get(position.pageNumber);
  if (!page) {
    throw new Error('split_screen_export_failed:playback_page_unavailable');
  }
  const playback = resolveExportPlaybackGeometry(page, position.noteIds);
  if (!playback) {
    throw new Error('split_screen_export_failed:playback_event_geometry_unavailable');
  }
  const ctx = context ?? outputCanvas.getContext('2d');
  if (!ctx) throw new Error('split_screen_export_failed:canvas_context');

  const image = await getEventScoreImage(
    page,
    position.noteIds,
    playback.anchorNote.noteId
  );
  const viewport = layout.scoreMode === 'floating'
    ? playback.system.contentBounds
    : page.viewBox;
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  const videoDrawRect = drawSourceVideoContain(ctx, sourceVideoFrame, layout.videoRect, layout.background);
  const scoreRect = layout.scoreMode === 'floating'
    ? resolveFloatingScoreRect({
        width: outputCanvas.width,
        height: outputCanvas.height,
        floatingPosition: layout.floatingPosition,
        floatingSize: layout.floatingSize,
      }, videoDrawRect, viewport)
    : layout.scoreRect;
  if (layout.scoreBackground) {
    ctx.fillStyle = layout.scoreBackground;
    ctx.fillRect(scoreRect.x, scoreRect.y, scoreRect.width, scoreRect.height);
  }
  const imageRect = drawStableScoreImage(
    ctx,
    image,
    page.viewBox,
    viewport,
    scoreRect,
    true,
    layout.scoreImageAlign
  );
  const cursorBox = svgRectToCanvasRect(playback.anchorNote.noteBox, viewport, imageRect);

  return {
    position,
    pageNumber: page.pageNumber,
    systemId: playback.system.systemId,
    staffId: playback.anchorNote.staffId,
    measureId: playback.anchorNote.measureId,
    anchorNoteId: playback.anchorNote.noteId,
    viewport,
    anchorBox: playback.anchorNote.noteBox,
    cursorBox,
    scoreRect,
    imageRect,
    videoDrawRect,
  };
}

export function resolveFloatingScoreRect(
  layout: {
    width: number;
    height: number;
    floatingPosition?: SplitScreenOutputLayout['floatingPosition'];
    floatingSize?: SplitScreenOutputLayout['floatingSize'];
  },
  videoDrawRect: Rect,
  viewport: SvgRect
): Rect {
  const aspectRatio = viewport.width / viewport.height;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error('split_screen_export_failed:floating_score_aspect_ratio');
  }

  const sizeFactor = FLOATING_SCORE_WIDTH_FACTORS[layout.floatingSize ?? 'medium'];
  const maxWidth = Math.min(
    videoDrawRect.width * sizeFactor,
    layout.width - FLOATING_SAFE_MARGIN * 2
  );
  const maxHeight = layout.height * FLOATING_MAX_HEIGHT_RATIO;
  const width = Math.max(1, Math.min(maxWidth, maxHeight * aspectRatio));
  const height = width / aspectRatio;
  const centeredX = videoDrawRect.x + (videoDrawRect.width - width) / 2;
  const x = layout.floatingPosition?.endsWith('right')
    ? layout.width - FLOATING_SAFE_MARGIN - width
    : layout.floatingPosition?.endsWith('left')
      ? FLOATING_SAFE_MARGIN
      : centeredX;
  const topY = Math.max(
    FLOATING_SAFE_MARGIN,
    videoDrawRect.y - FLOATING_VIDEO_GAP - height
  );
  const bottomY = Math.min(
    layout.height - FLOATING_SAFE_MARGIN - height,
    videoDrawRect.y + videoDrawRect.height + FLOATING_VIDEO_GAP
  );
  const y = layout.floatingPosition?.startsWith('bottom')
    ? bottomY
    : topY;

  return {
    x: clamp(x, FLOATING_SAFE_MARGIN, layout.width - FLOATING_SAFE_MARGIN - width),
    y: clamp(y, FLOATING_SAFE_MARGIN, layout.height - FLOATING_SAFE_MARGIN - height),
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function drawStableScoreImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  viewBox: SvgViewBox,
  viewport: SvgRect,
  scoreRect: Rect,
  drawImage: boolean,
  align: 'center' | 'top' | 'bottom' = 'center'
): Rect {
  const scale = Math.min(scoreRect.width / viewport.width, scoreRect.height / viewport.height);
  const drawWidth = viewport.width * scale;
  const drawHeight = viewport.height * scale;
  const dx = scoreRect.x + (scoreRect.width - drawWidth) / 2;
  const dy = align === 'top'
    ? scoreRect.y
    : align === 'bottom'
      ? scoreRect.y + scoreRect.height - drawHeight
      : scoreRect.y + (scoreRect.height - drawHeight) / 2;
  const imageScaleX = image.naturalWidth / viewBox.width;
  const imageScaleY = image.naturalHeight / viewBox.height;
  const sx = (viewport.x - viewBox.x) * imageScaleX;
  const sy = (viewport.y - viewBox.y) * imageScaleY;
  const sw = viewport.width * imageScaleX;
  const sh = viewport.height * imageScaleY;
  if (drawImage) {
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, drawWidth, drawHeight);
  }
  return { x: dx, y: dy, width: drawWidth, height: drawHeight };
}

export function drawSourceVideoContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: Rect,
  background: string
): Rect {
  ctx.fillStyle = background;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  const sourceWidth = source instanceof HTMLVideoElement
    ? source.videoWidth
    : source instanceof HTMLImageElement
      ? source.naturalWidth
      : Number('width' in source ? source.width : 0);
  const sourceHeight = source instanceof HTMLVideoElement
    ? source.videoHeight
    : source instanceof HTMLImageElement
      ? source.naturalHeight
      : Number('height' in source ? source.height : 0);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return rect;
  }
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = rect.x + (rect.width - width) / 2;
  const y = rect.y + (rect.height - height) / 2;
  ctx.drawImage(source, x, y, width, height);
  return { x, y, width, height };
}
