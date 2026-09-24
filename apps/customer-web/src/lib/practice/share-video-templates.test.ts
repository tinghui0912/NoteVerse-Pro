import { describe, expect, it } from 'vitest';

import { getShareVideoLayout } from './share-video-templates';
import { resolveFloatingScoreRect } from './split-screen-frame-renderer';

describe('share video templates', () => {
  it('keeps landscape output at 16:9 with separate full-frame panels', () => {
    const layout = getShareVideoLayout({ kind: 'landscape' });
    expect([layout.width, layout.height]).toEqual([1280, 720]);
    expect(layout.scoreRect.x + layout.scoreRect.width).toBeLessThan(layout.videoRect.x);
    expect(layout.videoRect.width).toBeGreaterThan(0);
  });

  it('keeps portrait output at 9:16 with stacked panels', () => {
    const layout = getShareVideoLayout({ kind: 'portrait' });
    expect([layout.width, layout.height]).toEqual([720, 1280]);
    expect(layout.scoreRect.y + layout.scoreRect.height).toBeLessThan(layout.videoRect.y);
  });

  it('leaves floating score geometry to the frame renderer instead of a fixed card', () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      for (const size of ['small', 'medium', 'large'] as const) {
        for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
          const layout = getShareVideoLayout({
            kind: 'floating',
            orientation,
            position,
            size,
          });
          expect(layout.scoreMode).toBe('floating');
          expect(layout.videoRect).toEqual({
            x: 0,
            y: 0,
            width: layout.width,
            height: layout.height,
          });
          expect(layout.scoreRect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
        }
      }
    }
  });

  it('uses the actual contained video width for floating score size', () => {
    const small = getShareVideoLayout({
      kind: 'floating',
      orientation: 'landscape',
      position: 'top-right',
      size: 'small',
    });
    const large = getShareVideoLayout({
      kind: 'floating',
      orientation: 'landscape',
      position: 'top-right',
      size: 'large',
    });
    expect([small.width, small.height]).toEqual([1280, 720]);
    expect([large.width, large.height]).toEqual([1280, 720]);
    const viewport = { x: 0, y: 0, width: 1000, height: 200 };
    const videoDrawRect = { x: 0, y: 0, width: 1280, height: 720 };
    const smallRect = resolveFloatingScoreRect(small, videoDrawRect, viewport);
    const largeRect = resolveFloatingScoreRect(large, videoDrawRect, viewport);
    expect(largeRect.width).toBeGreaterThan(smallRect.width);
    expect(largeRect.width / videoDrawRect.width).toBeGreaterThan(0.9);
    expect(largeRect.height / largeRect.width).toBeCloseTo(viewport.height / viewport.width);
  });

  it('anchors floating score to the actual contained video at the top or bottom', () => {
    const videoDrawRect = { x: 0, y: 437.5, width: 720, height: 405 };
    const viewport = { x: 0, y: 0, width: 1000, height: 200 };
    for (const position of ['top', 'bottom'] as const) {
      const layout = getShareVideoLayout({
        kind: 'floating',
        orientation: 'portrait',
        position,
        size: 'medium',
      });
      const scoreRect = resolveFloatingScoreRect(layout, videoDrawRect, viewport);
      expect(layout.scoreBackground).toBeUndefined();
      expect(Math.abs(scoreRect.x - (videoDrawRect.x + (videoDrawRect.width - scoreRect.width) / 2))).toBeLessThanOrEqual(0.5);
      if (position === 'top') {
        expect(scoreRect.y + scoreRect.height).toBeLessThan(videoDrawRect.y);
      } else {
        expect(scoreRect.y).toBeGreaterThan(videoDrawRect.y + videoDrawRect.height);
      }
    }
  });
});
