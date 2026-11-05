// @vitest-environment jsdom

import { render as renderComponent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NextIntlClientProvider } from 'next-intl';
import englishPractice from '@/../messages/en/practice.json';
import chinesePractice from '@/../messages/zh/practice.json';

const render = (ui: React.ReactNode) => renderComponent(ui, {
  wrapper: ({ children }) => <NextIntlClientProvider locale="en" messages={{ practice: englishPractice }}>{children}</NextIntlClientProvider>,
});

import type { VideoExportSession } from './session';

const mocks = vi.hoisted(() => ({
  prepareScorePageCache: vi.fn(async () => new Map()),
  renderVideoExportFrameAtTime: vi.fn(async (_options: unknown) => undefined),
}));

vi.mock('./score-model', () => ({
  findStablePageNumber: vi.fn(() => 1),
  prepareScorePageCache: mocks.prepareScorePageCache,
}));

vi.mock('./frame-renderer', () => ({
  renderVideoExportFrameAtTime: mocks.renderVideoExportFrameAtTime,
}));

vi.mock('./playback-position', () => ({
  resolveVideoExportPlaybackPosition: vi.fn(() => null),
}));

import { VideoExportPreview } from './preview';
import { captureReplayVideoFrame } from './preview';

const session: VideoExportSession = {
  sessionId: 'session-1', sourceId: 'source-1',
  scoreIdentity: { scoreId: 'score-1', revisionId: 'revision-1', artifactId: 'artifact-1' },
  scope: { kind: 'FULL', startTick: 0, terminalTick: 16 },
  tempoPlan: {
    selection: { mode: 'SCORE' },
    segments: [{ startTick: 0, bpm: 96, source: 'MUSICXML' }],
  },
  recordingTimebase: {
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

describe('VideoExportPreview', () => {
  beforeEach(() => {
    mocks.prepareScorePageCache.mockClear();
    mocks.renderVideoExportFrameAtTime.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  it.each([['en', englishPractice], ['zh', chinesePractice]] as const)('uses %s messages for the preview controls', async (locale, messages) => {
    const { getByText, getByLabelText, container } = renderComponent(
      <NextIntlClientProvider locale={locale} messages={{ practice: messages }}>
        <VideoExportPreview session={session} scoreContainer={document.createElement('div')}
          adapter={{} as never} scoreEndTick={16} ticksPerQuarter={1} mediaTimeMs={0}
          config={{ orientation: 'landscape', presentation: { kind: 'split' } }} replayVideo={null} />
      </NextIntlClientProvider>
    );
    await waitFor(() => expect(getByText(messages.videoExportPreviewSyncDesc)).toBeVisible());
    expect(getByLabelText(messages.videoExportPreviewCanvasLabel)).toBeInTheDocument();
    expect(getByText(messages.videoExportPreviewSavePng)).toBeVisible();
    if (locale === 'en') expect(container.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it.each([['en', englishPractice], ['zh', chinesePractice]] as const)('uses %s messages for preview failure and retry', async (locale, messages) => {
    mocks.prepareScorePageCache.mockRejectedValueOnce(null);
    const { getByText, getByRole, container } = renderComponent(
      <NextIntlClientProvider locale={locale} messages={{ practice: messages }}>
        <VideoExportPreview session={session} scoreContainer={document.createElement('div')}
          adapter={{} as never} scoreEndTick={16} ticksPerQuarter={1} mediaTimeMs={0}
          config={{ orientation: 'landscape', presentation: { kind: 'split' } }} replayVideo={null} />
      </NextIntlClientProvider>
    );
    await waitFor(() => expect(getByText(messages.videoExportPreviewScoreFailed)).toBeVisible());
    expect(getByRole('button', { name: messages.videoExportPreviewRetry })).toBeVisible();
    if (locale === 'en') expect(container.textContent).not.toMatch(/[\u4e00-\u9fff]/);
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
      <VideoExportPreview
        session={session}
        scoreContainer={scoreContainer}
        adapter={{} as never}
        scoreEndTick={16} ticksPerQuarter={1}
        mediaTimeMs={1250}
        config={{ orientation: 'landscape', presentation: { kind: 'split' } }}
        replayVideo={video}
      />
    );

    await waitFor(() => {
      expect(mocks.renderVideoExportFrameAtTime).toHaveBeenCalled();
    });
    const firstCallCount = mocks.renderVideoExportFrameAtTime.mock.calls.length;

    rerender(
      <VideoExportPreview
        session={session}
        scoreContainer={scoreContainer}
        adapter={{} as never}
        scoreEndTick={16} ticksPerQuarter={1}
        mediaTimeMs={1250}
        config={{ orientation: 'portrait', presentation: { kind: 'split' } }}
        replayVideo={video}
      />
    );

    await waitFor(() => {
      expect(mocks.renderVideoExportFrameAtTime.mock.calls.length).toBeGreaterThan(
        firstCallCount
      );
    });
    expect(
      mocks.renderVideoExportFrameAtTime.mock.calls.at(-1)?.[0]
    ).toMatchObject({
      mediaTimeMs: 1250,
      sourceVideoFrame: expect.any(HTMLCanvasElement),
      layout: {
        width: 720,
        height: 1280,
      },
    });

    const portraitCallCount = mocks.renderVideoExportFrameAtTime.mock.calls.length;

    rerender(
      <VideoExportPreview
        session={session}
        scoreContainer={scoreContainer}
        adapter={{} as never}
        scoreEndTick={16} ticksPerQuarter={1}
        mediaTimeMs={1250}
        config={{
          orientation: 'portrait',
          presentation: { kind: 'floating', position: 'bottom', size: 'large' },
        }}
        replayVideo={video}
      />
    );

    await waitFor(() => {
      expect(mocks.renderVideoExportFrameAtTime.mock.calls.length).toBeGreaterThan(
        portraitCallCount
      );
    });
    expect(
      mocks.renderVideoExportFrameAtTime.mock.calls.at(-1)?.[0]
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
    mocks.renderVideoExportFrameAtTime.mockImplementationOnce(async (rawOptions: unknown) => {
      const options = rawOptions as { mediaTimeMs: number };
      expect(options.mediaTimeMs).toBe(1050);
      sourceAdvanced = true;
      await new Promise<void>((resolve) => {
        renderGate.resolve = resolve;
      });
    });

    const onFrameCommitted = vi.fn();
    render(
      <VideoExportPreview
        session={session}
        scoreContainer={document.createElement('div')}
        adapter={{} as never}
        scoreEndTick={16} ticksPerQuarter={1}
        mediaTimeMs={1000}
        config={{ orientation: 'landscape', presentation: { kind: 'split' } }}
        replayVideo={video}
        onFrameCommitted={onFrameCommitted}
      />
    );

    await waitFor(() => {
      expect(mocks.renderVideoExportFrameAtTime).toHaveBeenCalled();
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
