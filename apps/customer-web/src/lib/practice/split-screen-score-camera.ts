import type { SvgRect } from './playhead-cursor';
import type { ExportPlaybackGeometry, SvgViewBox } from './split-screen-score-model';

export type Rect = { x: number; y: number; width: number; height: number };

export function scoreViewportForSystem(system: ExportPlaybackGeometry['system']): SvgRect {
  return { ...system.viewport };
}

export function svgRectToCanvasRect(rect: SvgRect, viewport: SvgRect, imageRect: Rect): Rect {
  const scaleX = imageRect.width / viewport.width;
  const scaleY = imageRect.height / viewport.height;
  return {
    x: imageRect.x + (rect.x - viewport.x) * scaleX,
    y: imageRect.y + (rect.y - viewport.y) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

export function cursorRectForPlayback(
  geometry: ExportPlaybackGeometry,
  viewport: SvgRect,
  imageRect: Rect,
  paddingPx = 5
): Rect {
  const anchor = geometry.anchorNote.anchor.x;
  const leftBoundary = geometry.previousAnchorX === null
    ? geometry.activeColumn.x
    : (geometry.previousAnchorX + anchor) / 2;
  const rightBoundary = geometry.nextAnchorX === null
    ? geometry.activeColumn.x + geometry.activeColumn.width
    : (anchor + geometry.nextAnchorX) / 2;
  const column = {
    x: Math.min(leftBoundary, geometry.activeColumn.x),
    y: geometry.anchorNote.staffBox.y,
    width: Math.max(
      1,
      Math.max(rightBoundary, geometry.activeColumn.x + geometry.activeColumn.width) -
        Math.min(leftBoundary, geometry.activeColumn.x)
    ),
    height: geometry.anchorNote.staffBox.height,
  };
  const mapped = svgRectToCanvasRect(column, viewport, imageRect);
  const x = Math.max(imageRect.x, mapped.x - paddingPx);
  const y = Math.max(imageRect.y, mapped.y - paddingPx);
  const right = Math.min(imageRect.x + imageRect.width, mapped.x + mapped.width + paddingPx);
  const bottom = Math.min(imageRect.y + imageRect.height, mapped.y + mapped.height + paddingPx);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function scoreImageRect(
  _viewBox: SvgViewBox,
  viewport: SvgRect,
  scoreRect: Rect
): Rect {
  const scale = Math.min(scoreRect.width / viewport.width, scoreRect.height / viewport.height);
  return {
    x: scoreRect.x + (scoreRect.width - viewport.width * scale) / 2,
    y: scoreRect.y + (scoreRect.height - viewport.height * scale) / 2,
    width: viewport.width * scale,
    height: viewport.height * scale,
  };
}

export function rectsIntersect(first: Rect, second: Rect) {
  return first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
}

export function rectContains(outer: Rect, inner: Rect) {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}
