// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShareVideoSession } from './share-video-session';

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
import { captureReplayVideoFrame } from './share-video-preview';

const session: ShareVideoSession = {
  sourceId: 'session-1',
  scoreIdentity: { scoreId: 'score-1', revisionId: 'revision-1', artifactId: 'artifact-1' },
  scope: { kind: 'FULL', startBeat: 0, terminalBeat: 16 },
  tempoPlan: {
    selection: { mode: 'SCORE' },
    segments: [{ startBeat: 0, bpm: 96, source: 'MUSICXML' }],
  },
  recordingTimebase: {
    recordingStartPerfTimeMs: 0,
    recordingEndPerfTimeMs: 4000,
    nominalMediaDurationMs: 4000,
    activeSegments: [
      { perfStartMs: 0, perfEndMs: 4000, mediaStartMs: 0, mediaEndMs: 4000 },
    ],
  },
  video: {
    status: 'READY',
    kind: 'VIDEO',
    blob: new Blob(['video'], { type: 'video/webm' }),
    mimeType: 'video/webm',
    durationMs: 4000,
  },
};

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

    const scoreContainer = document.createElement('div');
    const { rerender } = render(
      <ShareVideoPreview
        session={session}
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
        session={session}
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
      sourceVideoFrame: expect.any(HTMLCanvasElement),
      layout: {
        width: 720,
        height: 1280,
      },
    });

    const portraitCallCount = mocks.renderSplitScreenFrameAtTime.mock.calls.length;

    rerender(
      <ShareVideoPreview
        session={session}
        scoreContainer={scoreContainer}
        adapter={{} as never}
        scoreEndBeat={16}
        mediaTimeMs={1250}
        template={{
          kind: 'floating',
          orientation: 'portrait',
          position: 'bottom-left',
          size: 'large',
        }}
        replayVideo={video}
      />
    );

    await waitFor(() => {
      expect(mocks.renderSplitScreenFrameAtTime.mock.calls.length).toBeGreaterThan(
        portraitCallCount
      );
    });
    expect(
      mocks.renderSplitScreenFrameAtTime.mock.calls.at(-1)?.[0]
    ).toMatchObject({
      sourceVideoFrame: expect.any(HTMLCanvasElement),
      layout: {
        width: 720,
        height: 1280,
        videoRect: { x: 0, y: 0, width: 720, height: 1280 },
      },
    });
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('reports the requested media time when async rendering finishes after the source advances', async () => {
    const video = document.createElement('video');
    let sourceAdvanced = false;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => (sourceAdvanced ? 2.5 : 1.05),
    });
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 });
    Object.defineProperty(video, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(video, 'seeking', { configurable: true, value: false });

    const renderGate: { resolve: (() => void) | null } = { resolve: null };
    mocks.renderSplitScreenFrameAtTime.mockImplementationOnce(async (rawOptions: unknown) => {
      const options = rawOptions as { mediaTimeMs: number };
      expect(options.mediaTimeMs).toBe(1050);
      sourceAdvanced = true;
      await new Promise<void>((resolve) => {
        renderGate.resolve = resolve;
      });
    });

    const onFrameCommitted = vi.fn();
    render(
      <ShareVideoPreview
        session={session}
        scoreContainer={document.createElement('div')}
        adapter={{} as never}
        scoreEndBeat={16}
        mediaTimeMs={1000}
        template={{ kind: 'landscape' }}
        replayVideo={video}
        onFrameCommitted={onFrameCommitted}
      />
    );

    await waitFor(() => {
      expect(mocks.renderSplitScreenFrameAtTime).toHaveBeenCalled();
    });
    renderGate.resolve?.();

    await waitFor(() => {
      expect(onFrameCommitted).toHaveBeenCalled();
    });
    expect(onFrameCommitted).toHaveBeenCalledWith(1050);
    expect(onFrameCommitted).not.toHaveBeenCalledWith(2500);
  });

  it('freezes the media time at the same instant as the source frame', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.05 });
    const source = captureReplayVideoFrame(video, { current: null });
    expect(source.mediaTimeMs).toBe(1050);
    expect(source.canvas).toBeInstanceOf(HTMLCanvasElement);
  });
});
