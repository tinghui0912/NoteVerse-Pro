// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PerformanceReviewDraft } from './performance-review-draft';

const mocks = vi.hoisted(() => ({
  prepareScorePageCache: vi.fn(async () => new Map()),
  renderSplitScreenFrameAtTime: vi.fn(async (_options: unknown) => undefined),
}));

vi.mock('./split-screen-score-model', () => ({
  findStablePageNumber: vi.fn(() => 1),
  prepareScorePageCache: mocks.prepareScorePageCache,
}));

vi.mock('./split-screen-frame-renderer', () => ({
  renderSplitScreenFrameAtTime: mocks.renderSplitScreenFrameAtTime,
}));

vi.mock('./split-screen-playback-position', () => ({
  resolveSplitScreenScoreFrame: vi.fn(() => null),
}));

import { ShareVideoPreview } from './share-video-preview';

describe('ShareVideoPreview', () => {
  beforeEach(() => {
    mocks.prepareScorePageCache.mockClear();
    mocks.renderSplitScreenFrameAtTime.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  it('rerenders a paused current frame when the template changes without controlling replay media', async () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.25 });
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 });
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(video, 'seeking', { configurable: true, value: false });
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(video, 'load').mockImplementation(() => {});

    const draft = {
      video: {
        status: 'READY',
        blob: new Blob(['video'], { type: 'video/webm' }),
        durationMs: 4000,
      },
    } as unknown as PerformanceReviewDraft;
    const scoreContainer = document.createElement('div');
    const { rerender } = render(
      <ShareVideoPreview
        draft={draft}
        scoreContainer={scoreContainer}
        adapter={{} as never}
        scoreEndBeat={16}
        mediaTimeMs={1250}
        template={{ kind: 'landscape' }}
        replayVideo={video}
      />
    );

    await waitFor(() => {
      expect(mocks.renderSplitScreenFrameAtTime).toHaveBeenCalled();
    });
    const firstCallCount = mocks.renderSplitScreenFrameAtTime.mock.calls.length;

    rerender(
      <ShareVideoPreview
        draft={draft}
        scoreContainer={scoreContainer}
        adapter={{} as never}
        scoreEndBeat={16}
        mediaTimeMs={1250}
        template={{ kind: 'portrait' }}
        replayVideo={video}
      />
    );

    await waitFor(() => {
      expect(mocks.renderSplitScreenFrameAtTime.mock.calls.length).toBeGreaterThan(
        firstCallCount
      );
    });
    expect(
      mocks.renderSplitScreenFrameAtTime.mock.calls.at(-1)?.[0]
    ).toMatchObject({
      mediaTimeMs: 1250,
      sourceVideoFrame: video,
      layout: {
        width: 720,
        height: 1280,
      },
    });
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});
