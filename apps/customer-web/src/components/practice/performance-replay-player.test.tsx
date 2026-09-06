// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import practiceMessages from '../../../messages/en/practice.json';
import { PerformanceReplayPlayer } from './performance-replay-player';

describe('PerformanceReplayPlayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders MIDI replay controls with seek', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
        <PerformanceReplayPlayer
          replay={{
            kind: 'MIDI_EVENTS',
            durationMs: 100,
            timebase: {
              version: 1,
              speedRatio: 1,
            },
            events: [
              {
                event_type: 'note_on',
                note_number: 60,
                velocity: 96,
                timestamp_ms: 0,
              },
              {
                event_type: 'note_off',
                note_number: 60,
                velocity: 0,
                timestamp_ms: 100,
              },
            ],
          }}
          onReplayTimeChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Replay position' })).toBeInTheDocument();
    expect(screen.getAllByText('0:00')).toHaveLength(2);
  });

  it('keeps secondary actions in the replay control row', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
        <PerformanceReplayPlayer
          replay={{
            kind: 'MIDI_EVENTS',
            durationMs: 100,
            timebase: {
              version: 1,
              speedRatio: 1,
            },
            events: [],
          }}
          actions={<button type="button">Delete</button>}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('binds audio replay blob URLs after mount and revokes them on unmount', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:audio-replay');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
        <PerformanceReplayPlayer
          replay={{
            kind: 'AUDIO_RECORDING',
            blob,
            contentType: 'audio/webm',
            byteSize: blob.size,
            durationMs: 1000,
            timebase: {
              version: 1,
              speedRatio: 1,
            },
          }}
          onReplayTimeChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const audio = document.querySelector('audio');
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(audio).toHaveAttribute('src', 'blob:audio-replay');

    unmount();

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:audio-replay');
  });

  it('returns audio replay controls to play state when the audio element errors', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-replay');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(
      <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
        <PerformanceReplayPlayer
          replay={{
            kind: 'AUDIO_RECORDING',
            blob,
            contentType: 'audio/webm',
            byteSize: blob.size,
            durationMs: 1000,
            timebase: {
              version: 1,
              speedRatio: 1,
            },
          }}
          onReplayTimeChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    const audio = document.querySelector('audio');
    expect(audio).not.toBeNull();
    fireEvent.play(audio as HTMLAudioElement);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.error(audio as HTMLAudioElement);

    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument();
  });

  it('samples audio currentTime with requestAnimationFrame while replay is playing', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const onReplayTimeChange = vi.fn();
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
      <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
        <PerformanceReplayPlayer
          replay={{
            kind: 'AUDIO_RECORDING',
            blob,
            contentType: 'audio/webm',
            byteSize: blob.size,
            durationMs: 1000,
            timebase: {
              version: 1,
              speedRatio: 1,
            },
          }}
          onReplayTimeChange={onReplayTimeChange}
        />
      </NextIntlClientProvider>
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

    expect(onReplayTimeChange).toHaveBeenCalledWith(250);
  });
});
