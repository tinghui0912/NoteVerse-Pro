import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';
import { createLocalMediaAsset } from '@/lib/practice/media/local-media-asset';
// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import practiceMessages from '../../../messages/en/practice.json';
import { RecordingPlaybackPlayer } from './recording-playback-player';

describe('RecordingPlaybackPlayer', () => {
  it.each(['AUDIO', 'VIDEO'] as const)(
    'keeps %s backing bytes alive until the media element URL is revoked',
    async (kind) => {
      const order: string[] = [],
        media = createLocalMediaAsset(new Blob(['raw']), async () => {
          order.push('remove');
        });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
        order.push('revoke');
      });
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
        () => {},
      );
      const view = render(
        <NextIntlClientProvider
          locale="en"
          messages={{ practice: practiceMessages }}
        >
          <RecordingPlaybackPlayer
            source={{
              kind,
              media,
              recordingTimebase: {
                nominalMediaDurationUs: 100000,
                activeSegments: [
                  {
                    performanceStartUs: 0,
                    performanceEndUs: 100000,
                    mediaStartUs: 0,
                    mediaEndUs: 100000,
                  },
                ],
              },
            }}
          />
        </NextIntlClientProvider>,
      );
      await media.release();
      expect(order).toEqual([]);
      view.unmount();
      await Promise.resolve();
      expect(order).toEqual(['revoke', 'remove']);
    },
  );
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders audio playback controls with seek', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 100000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 100000,
                  mediaStartUs: 0,
                  mediaEndUs: 100000,
                },
              ],
            },
          }}
          onMediaTimeChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(
      screen.getByRole('slider', { name: 'Recording position' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('0:00')).toHaveLength(2);
  });

  it('keeps secondary actions in the playback control row', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 100000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 100000,
                  mediaStartUs: 0,
                  mediaEndUs: 100000,
                },
              ],
            },
          }}
          actions={<button type="button">Delete</button>}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('binds audio playback blob URLs after mount and revokes them on unmount', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:audio-replay');
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    const { unmount } = render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onMediaTimeChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    const audio = document.querySelector('audio');
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(audio).toHaveAttribute('src', 'blob:audio-replay');

    unmount();

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:audio-replay');
  });

  it('returns audio playback controls to play state when the audio element errors', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onMediaTimeChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const audio = document.querySelector('audio');
    expect(audio).not.toBeNull();
    fireEvent.play(audio as HTMLAudioElement);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.error(audio as HTMLAudioElement);

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByText('Audio playback unavailable')).toBeInTheDocument();
  });

  it('updates effective duration and passes actualDurationMs when onLoadedMetadata fires', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const onMediaTimeChange = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onMediaTimeChange={onMediaTimeChange}
        />
      </NextIntlClientProvider>,
    );

    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 2.5,
    });
    fireEvent.loadedMetadata(audio);

    expect(screen.getByText('0:02')).toBeInTheDocument();

    const slider = screen.getByRole('slider', { name: 'Recording position' });
    fireEvent.change(slider, { target: { value: '1500' } });
    expect(onMediaTimeChange).toHaveBeenCalledWith(1500, 2500);
  });

  it('updates audio duration when WebM metadata becomes finite after durationchange', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const onMediaTimeChange = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onMediaTimeChange={onMediaTimeChange}
        />
      </NextIntlClientProvider>,
    );

    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: Number.POSITIVE_INFINITY,
    });
    fireEvent.loadedMetadata(audio);
    expect(screen.getAllByText('0:01')).toHaveLength(1);

    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 4.2,
    });
    fireEvent.durationChange(audio);
    expect(screen.getByText('0:04')).toBeInTheDocument();

    const slider = screen.getByRole('slider', { name: 'Recording position' });
    fireEvent.change(slider, { target: { value: '3500' } });
    expect(onMediaTimeChange).toHaveBeenCalledWith(3500, 4200);
  });

  it('publishes ended audio time from the real media element duration', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const onMediaTimeChange = vi.fn();
    const onPlaybackStateChange = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onMediaTimeChange={onMediaTimeChange}
          onPlaybackStateChange={onPlaybackStateChange}
        />
      </NextIntlClientProvider>,
    );

    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 4.2,
    });
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      value: 4.2,
    });
    fireEvent.ended(audio);

    expect(onMediaTimeChange).toHaveBeenCalledWith(4200, 4200);
    expect(onPlaybackStateChange).toHaveBeenCalledWith(false);
  });

  it('samples audio currentTime with requestAnimationFrame during recording playback', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const onMediaTimeChange = vi.fn();
    let renderFrame: FrameRequestCallback | null = null;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      renderFrame = callback;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'AUDIO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onMediaTimeChange={onMediaTimeChange}
        />
      </NextIntlClientProvider>,
    );

    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.play(audio);
    audio.currentTime = 0.25;
    act(() => {
      renderFrame?.(performance.now());
    });

    expect(onMediaTimeChange).toHaveBeenCalledWith(250);
  });

  it('exposes the owned video element without creating a second playback source', () => {
    const blob = new Blob(['video'], { type: 'video/webm' });
    const onVideoElementChange = vi.fn();
    const onPlaybackStateChange = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const { unmount } = render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <RecordingPlaybackPlayer
          source={{
            kind: 'VIDEO',
            media: localMediaAssetFixture(blob),
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onVideoElementChange={onVideoElementChange}
          onPlaybackStateChange={onPlaybackStateChange}
        />
      </NextIntlClientProvider>,
    );

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(onVideoElementChange).toHaveBeenLastCalledWith(video);
    expect(document.querySelectorAll('video')).toHaveLength(1);

    fireEvent.play(video as HTMLVideoElement);
    fireEvent.pause(video as HTMLVideoElement);
    expect(onPlaybackStateChange).toHaveBeenNthCalledWith(1, true);
    expect(onPlaybackStateChange).toHaveBeenNthCalledWith(2, false);

    unmount();
    expect(onVideoElementChange).toHaveBeenLastCalledWith(null);
  });

  it('does not reload video when the parent rerenders from the first play event', () => {
    const blob = new Blob(['video'], { type: 'video/webm' });
    const media = localMediaAssetFixture(blob);
    const load = vi
      .spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    function Harness() {
      const [playing, setPlaying] = useState(false);
      const onMediaTimeChange = () => {
        void playing;
      };
      return (
        <RecordingPlaybackPlayer
          source={{
            kind: 'VIDEO',
            media,
            recordingTimebase: {
              nominalMediaDurationUs: 1000000,
              activeSegments: [
                {
                  performanceStartUs: 0,
                  performanceEndUs: 1000000,
                  mediaStartUs: 0,
                  mediaEndUs: 1000000,
                },
              ],
            },
          }}
          onMediaTimeChange={onMediaTimeChange}
          onPlaybackStateChange={setPlaying}
        />
      );
    }

    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ practice: practiceMessages }}
      >
        <Harness />
      </NextIntlClientProvider>,
    );

    const video = document.querySelector('video') as HTMLVideoElement;
    const initialLoadCount = load.mock.calls.length;
    fireEvent.play(video);

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(initialLoadCount);
  });

  it.each(['AUDIO', 'VIDEO'] as const)(
    'plays a direct %s URL and auto-starts that source once',
    (kind) => {
      const play = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockResolvedValue(undefined);
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
        () => {},
      );
      const create = vi.spyOn(URL, 'createObjectURL');
      const revoke = vi.spyOn(URL, 'revokeObjectURL');
      const source = {
        kind,
        url: 'https://media.example.test/signed-recording',
      };
      const view = render(
        <NextIntlClientProvider
          locale="en"
          messages={{ practice: practiceMessages }}
        >
          <RecordingPlaybackPlayer source={source} autoStart />
        </NextIntlClientProvider>,
      );
      const element = document.querySelector(
        kind === 'AUDIO' ? 'audio' : 'video',
      ) as HTMLMediaElement;
      expect(element.src).toBe(source.url);
      fireEvent.canPlay(element);
      expect(play).toHaveBeenCalledOnce();
      view.rerender(
        <NextIntlClientProvider
          locale="en"
          messages={{ practice: practiceMessages }}
        >
          <RecordingPlaybackPlayer source={source} autoStart />
        </NextIntlClientProvider>,
      );
      fireEvent.canPlay(element);
      expect(play).toHaveBeenCalledOnce();
      view.unmount();
      expect(create).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    },
  );

  it.each(['AUDIO', 'VIDEO'] as const)(
    'publishes %s seek commits and frame time using nominal duration until decoding is available',
    (kind) => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recording');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
        () => {},
      );
      let frame: FrameRequestCallback | undefined;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
        (callback) => {
          frame = callback;
          return 1;
        },
      );
      const cancel = vi
        .spyOn(window, 'cancelAnimationFrame')
        .mockImplementation(() => {});
      const time = vi.fn(),
        seek = vi.fn(),
        state = vi.fn();
      const source = {
        kind,
        media: localMediaAssetFixture(new Blob(['recording'])),
        recordingTimebase: {
          nominalMediaDurationUs: 2000000,
          activeSegments: [
            {
              performanceStartUs: 0,
              performanceEndUs: 2000000,
              mediaStartUs: 0,
              mediaEndUs: 2000000,
            },
          ],
        },
      };
      render(
        <NextIntlClientProvider
          locale="en"
          messages={{ practice: practiceMessages }}
        >
          <RecordingPlaybackPlayer
            source={source}
            onMediaTimeChange={time}
            onMediaSeekCommitted={seek}
            onPlaybackStateChange={state}
          />
        </NextIntlClientProvider>,
      );
      const element = document.querySelector(
        kind === 'AUDIO' ? 'audio' : 'video',
      ) as HTMLMediaElement;
      const slider = screen.getByRole('slider', { name: 'Recording position' });
      expect(slider).toHaveAttribute('max', '2000');
      fireEvent.change(slider, { target: { value: '500' } });
      fireEvent.keyUp(slider, { key: 'ArrowRight' });
      expect(element.currentTime).toBe(0.5);
      expect(seek).toHaveBeenCalledWith(500);
      Object.defineProperty(element, 'paused', {
        configurable: true,
        value: false,
      });
      fireEvent.play(element);
      element.currentTime = 0.75;
      act(() => frame?.(performance.now()));
      expect(time).toHaveBeenLastCalledWith(750);
      fireEvent.pause(element);
      expect(state).toHaveBeenLastCalledWith(false);
      expect(cancel).toHaveBeenCalled();
      fireEvent.error(element);
      expect(screen.getByRole('slider')).toBeDisabled();
    },
  );
});
