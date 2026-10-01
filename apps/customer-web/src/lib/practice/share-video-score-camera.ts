import type { SvgRect } from './playhead-cursor';

export type Rect = { x: number; y: number; width: number; height: number };

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
