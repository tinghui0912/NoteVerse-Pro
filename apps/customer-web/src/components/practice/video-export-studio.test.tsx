// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialVideoExportOrientation } from './video-export-studio';

describe('initialVideoExportOrientation', () => {
  it('defaults to landscape until media dimensions are available', () => {
    expect(initialVideoExportOrientation(null)).toBe('landscape');
    expect(
      initialVideoExportOrientation({ videoWidth: 0, videoHeight: 0 }),
    ).toBe('landscape');
  });

  it('selects landscape for a horizontal recording', () => {
    expect(
      initialVideoExportOrientation({ videoWidth: 1920, videoHeight: 1080 }),
    ).toBe('landscape');
  });

  it('selects portrait for a vertical recording', () => {
    expect(
      initialVideoExportOrientation({ videoWidth: 1080, videoHeight: 1920 }),
    ).toBe('portrait');
  });
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { VideoExportStudio } from './video-export-studio';
import { exportVideo } from '@/lib/practice/video-export/export';
import { downloadLocalMedia } from '@/lib/practice/media/download-local-media';
import { createLocalMediaAsset } from '@/lib/practice/media/local-media-asset';
import { createVideoExportSessionFromSavedTake } from '@/lib/practice/video-export/saved-take-adapter';
import {
  take,
  artifact,
} from '@/lib/practice/video-export/__fixtures__/saved-take';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/practice/video-export/preview', () => ({
  VideoExportPreview: () => null,
}));
vi.mock('@/lib/practice/video-export/export', () => ({
  exportVideo: vi.fn(),
  getVideoExportReadiness: () => ({ ok: true, mimeType: 'video/webm' }),
}));
vi.mock('@/lib/practice/media/download-local-media', () => ({
  downloadLocalMedia: vi.fn(),
}));

function studio() {
  const sourceRemoved = vi.fn(async () => {}),
    outputRemoved = vi.fn(async () => {});
  const source = createLocalMediaAsset(new Blob(['source']), sourceRemoved);
  const output = createLocalMediaAsset(
    new Blob(['derivative'], { type: 'video/webm' }),
    outputRemoved,
  );
  const adapted = createVideoExportSessionFromSavedTake(take, source, {
    binding: {
      scoreId: 'score-1',
      revisionId: 'revision-1',
      bundleId: take.manifest.practice_binding.bundle_id,
    },
    artifact,
  });
  if (adapted.status !== 'supported') throw new Error('Expected video');
  vi.mocked(exportVideo).mockResolvedValue({
    media: output,
    mimeType: 'video/webm',
    durationMs: 4000,
  });
  const exporting = vi.fn();
  const view = render(
    <VideoExportStudio
      session={adapted.session}
      scoreContainer={document.createElement('div')}
      adapter={{} as never}
      scoreEndTick={16}
      ticksPerQuarter={1}
      isScoreIdentityConfirmed
      xmlContent="<score />"
      mediaTimeMs={0}
      isReplayPlaying={false}
      replayVideo={null}
      open
      onOpenChange={vi.fn()}
      onExportingChange={exporting}
    />,
  );
  const start = () =>
    fireEvent.click(screen.getByTestId('generate-video-export'));
  return {
    view,
    start,
    source,
    output,
    sourceRemoved,
    outputRemoved,
    exporting,
  };
}
beforeEach(() => {
  vi.mocked(exportVideo).mockReset();
  vi.mocked(downloadLocalMedia).mockReset();
  vi.mocked(downloadLocalMedia).mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('downloads the output handle and retires its owner independently from the source lease', async () => {
  const f = studio();
  let finish!: () => void;
  vi.mocked(downloadLocalMedia).mockImplementation(async (media) => {
    const lease = media.retain();
    try {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    } finally {
      await lease.release();
    }
  });
  f.start();
  await waitFor(() => expect(downloadLocalMedia).toHaveBeenCalledOnce());
  expect(downloadLocalMedia).toHaveBeenCalledWith(
    f.output,
    expect.stringMatching(/^performance-score-video-.*\.webm$/),
  );
  await f.source.release();
  expect(f.sourceRemoved).not.toHaveBeenCalled();
  expect(f.outputRemoved).not.toHaveBeenCalled();
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(f.outputRemoved).toHaveBeenCalledOnce());
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
  expect(screen.getByTestId('video-export-success')).toBeDefined();
});
it('releases the result owner even if the download click fails', async () => {
  const f = studio();
  vi.mocked(downloadLocalMedia).mockRejectedValueOnce(
    new Error('click failed'),
  );
  f.start();
  await waitFor(() => expect(f.outputRemoved).toHaveBeenCalledOnce());
  expect(screen.getByTestId('video-export-error')).toBeDefined();
  await f.source.release();
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
});
it.each(['cancel', 'unmount'] as const)(
  '%s aborts active output, holds source until cleanup and rejects late output publication',
  async (action) => {
    const f = studio();
    let finish!: (value: Awaited<ReturnType<typeof exportVideo>>) => void;
    vi.mocked(exportVideo).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.start();
    await waitFor(() => expect(exportVideo).toHaveBeenCalledOnce());
    const signal = vi.mocked(exportVideo).mock.calls[0][0].signal!;
    await f.source.release();
    expect(f.sourceRemoved).not.toHaveBeenCalled();
    if (action === 'cancel')
      fireEvent.click(screen.getByText('cancelExportScoreVideo'));
    else f.view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ media: f.output, mimeType: 'video/webm', durationMs: 4000 });
    });
    await waitFor(() => expect(f.outputRemoved).toHaveBeenCalledOnce());
    expect(f.sourceRemoved).toHaveBeenCalledOnce();
    expect(downloadLocalMedia).not.toHaveBeenCalled();
  },
);
it('releases its input lease if the export-status listener throws before output creation', async () => {
  const f = studio();
  f.exporting.mockImplementationOnce(() => {
    throw new Error('status failed');
  });
  f.start();
  await waitFor(() =>
    expect(screen.getByTestId('video-export-error')).toBeDefined(),
  );
  expect(exportVideo).not.toHaveBeenCalled();
  await f.source.release();
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
  await f.output.release();
});
