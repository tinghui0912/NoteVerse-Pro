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
    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const layout = getShareVideoLayout({
        kind: 'floating',
        orientation: 'landscape',
        position,
      });
      expect(layout.cardRect).toBeDefined();
      const card = layout.cardRect!;
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(layout.width);
      expect(card.y + card.height).toBeLessThanOrEqual(layout.height);
    }
  });
});
