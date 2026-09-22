import type { SvgRect } from './playhead-cursor';
import type { SvgViewBox } from './split-screen-score-model';
import type { Rect } from './split-screen-score-camera';

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
  source: HTMLVideoElement,
  rect: Rect,
  background: string
): Rect {
  ctx.fillStyle = background;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (source.videoWidth <= 0 || source.videoHeight <= 0) {
    return rect;
  }
  const scale = Math.min(rect.width / source.videoWidth, rect.height / source.videoHeight);
  const width = source.videoWidth * scale;
  const height = source.videoHeight * scale;
  const x = rect.x + (rect.width - width) / 2;
  const y = rect.y + (rect.height - height) / 2;
  ctx.drawImage(source, x, y, width, height);
  return { x, y, width, height };
}
