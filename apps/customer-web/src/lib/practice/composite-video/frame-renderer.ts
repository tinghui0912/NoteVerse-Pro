import type { SvgRect } from "@/lib/practice/score-view/playhead-cursor";
import {
  getEventScoreImage,
  resolveExportPlaybackGeometry,
  type ScorePageCache,
  type SvgViewBox,
} from "./score-model";
import { svgRectToCanvasRect, type Rect } from "./score-camera";
import type { CompositeVideoLayout } from "./templates";

type CompositeVideoFramePosition = {
  eventId?: string;
  pageNumber: number;
  noteIds: string[];
  scoreTick: number;
  perfTimeMs: number;
};

export type CompositeVideoPlaybackTimeline = {
  resolve(mediaTimeMs: number): CompositeVideoFramePosition | null;
};

export type CompositeVideoFrameDiagnostics = {
  position: CompositeVideoFramePosition;
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
  videoDrawRect: Rect | null;
};

export async function renderCompositeVideoFrameAtTime({
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
  playbackTimeline: CompositeVideoPlaybackTimeline;
  sourceVideoFrame?: CanvasImageSource;
  outputCanvas: HTMLCanvasElement;
  layout: CompositeVideoLayout;
  context?: CanvasRenderingContext2D;
}): Promise<CompositeVideoFrameDiagnostics> {
  const position = playbackTimeline.resolve(mediaTimeMs);
  if (!position) {
    throw new Error("composite_video_failed:playback_position_unavailable");
  }
  const page = scoreModel.get(position.pageNumber);
  if (!page) {
    throw new Error("composite_video_failed:playback_page_unavailable");
  }
  const playback = resolveExportPlaybackGeometry(page, position.noteIds);
  if (!playback) {
    throw new Error(
      "composite_video_failed:playback_event_geometry_unavailable",
    );
  }
  const ctx = context ?? outputCanvas.getContext("2d");
  if (!ctx) throw new Error("composite_video_failed:canvas_context");

  const image = await getEventScoreImage(
    page,
    position.noteIds,
    playback.anchorNote.noteId,
  );
  const viewport = page.viewBox;
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  if (layout.kind === "SCORE_AND_VIDEO" && !sourceVideoFrame)
    throw new Error("composite_video_failed:source_video_required");
  if (layout.kind === "SCORE_ONLY" && sourceVideoFrame)
    throw new Error("composite_video_failed:unexpected_video_frame");
  const videoDrawRect =
    layout.kind === "SCORE_AND_VIDEO"
      ? drawSourceVideoContain(
          ctx,
          sourceVideoFrame!,
          layout.videoRect,
          layout.background,
        )
      : null;
  const scoreRect = layout.scoreRect;
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
    "center",
  );
  const cursorBox = svgRectToCanvasRect(
    playback.anchorNote.noteBox,
    viewport,
    imageRect,
  );

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

function drawStableScoreImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  viewBox: SvgViewBox,
  viewport: SvgRect,
  scoreRect: Rect,
  drawImage: boolean,
  align: "center" | "top" | "bottom" = "center",
): Rect {
  const scale = Math.min(
    scoreRect.width / viewport.width,
    scoreRect.height / viewport.height,
  );
  const drawWidth = viewport.width * scale;
  const drawHeight = viewport.height * scale;
  const dx = scoreRect.x + (scoreRect.width - drawWidth) / 2;
  const dy =
    align === "top"
      ? scoreRect.y
      : align === "bottom"
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

function drawSourceVideoContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: Rect,
  background: string,
): Rect {
  ctx.fillStyle = background;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  const sourceWidth =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : Number("width" in source ? source.width : 0);
  const sourceHeight =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : Number("height" in source ? source.height : 0);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("composite_video_failed:video_decode");
  }
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = rect.x + (rect.width - width) / 2;
  const y = rect.y + (rect.height - height) / 2;
  ctx.drawImage(source, x, y, width, height);
  return { x, y, width, height };
}
