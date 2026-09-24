import { describe, expect, it } from 'vitest';

import { getShareVideoLayout } from './share-video-templates';

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

  it('keeps floating cards inside the canvas at every corner', () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      for (const size of ['small', 'medium', 'large'] as const) {
        for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
          const layout = getShareVideoLayout({
            kind: 'floating',
            orientation,
            position,
            size,
          });
          expect(layout.cardRect).toBeDefined();
          const card = layout.cardRect!;
          expect(layout.videoRect).toEqual({
            x: 0,
            y: 0,
            width: layout.width,
            height: layout.height,
          });
          expect(card.x).toBeGreaterThanOrEqual(0);
          expect(card.y).toBeGreaterThanOrEqual(0);
          expect(card.x + card.width).toBeLessThanOrEqual(layout.width);
          expect(card.y + card.height).toBeLessThanOrEqual(layout.height);
          expect(layout.scoreRect.x).toBeGreaterThan(card.x);
          expect(layout.scoreRect.y).toBeGreaterThan(card.y);
          expect(layout.scoreRect.x + layout.scoreRect.width).toBeLessThan(card.x + card.width);
          expect(layout.scoreRect.y + layout.scoreRect.height).toBeLessThan(card.y + card.height);
        }
      }
    }
  });

  it('uses explicit floating sizes without changing export resolution', () => {
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
    expect(large.cardRect!.width).toBeGreaterThan(small.cardRect!.width);
    expect(large.cardRect!.height).toBeGreaterThan(small.cardRect!.height);
  });

  it('centers the transparent floating score at the top or bottom', () => {
    for (const position of ['top', 'bottom'] as const) {
      const layout = getShareVideoLayout({
        kind: 'floating',
        orientation: 'landscape',
        position,
        size: 'medium',
      });
      const card = layout.cardRect!;
      expect(Math.abs(card.x - (layout.width - card.width) / 2)).toBeLessThanOrEqual(0.5);
      expect(layout.scoreBackground).toBeUndefined();
      expect(layout.scoreRect.x).toBeGreaterThan(card.x);
    }
  });
});
