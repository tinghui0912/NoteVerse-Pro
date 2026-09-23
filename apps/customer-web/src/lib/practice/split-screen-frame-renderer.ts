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
  cardRect?: Rect;
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
};

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

  const image = await getEventScoreImage(page, position.noteIds);
  const viewport = page.viewBox;
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  drawSourceVideoContain(ctx, sourceVideoFrame, layout.videoRect, layout.background);
  if (layout.cardRect) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      layout.cardRect.x,
      layout.cardRect.y,
      layout.cardRect.width,
      layout.cardRect.height
    );
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(layout.scoreRect.x, layout.scoreRect.y, layout.scoreRect.width, layout.scoreRect.height);
  const imageRect = drawStableScoreImage(ctx, image, page.viewBox, viewport, layout.scoreRect, true);
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
  };
}

export function drawStableScoreImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  viewBox: SvgViewBox,
  viewport: SvgRect,
  scoreRect: Rect,
  drawImage: boolean
): Rect {
  const scale = Math.min(scoreRect.width / viewport.width, scoreRect.height / viewport.height);
  const drawWidth = viewport.width * scale;
  const drawHeight = viewport.height * scale;
  const dx = scoreRect.x + (scoreRect.width - drawWidth) / 2;
  const dy = scoreRect.y + (scoreRect.height - drawHeight) / 2;
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
