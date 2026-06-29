// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { formatPlaybackTime } from '@/components/score/score-preview-controls';
import { useScorePreviewPlayback } from '@/hooks/score/use-score-preview-playback';
import type { ScorePreviewController } from '@/lib/score/contracts';

function createFakeController(loadError?: Error) {
  const controller: ScorePreviewController = {
    loadScore: vi.fn(async () => {
      if (loadError) throw loadError;
    }),
    fitToContainer: vi.fn(async () => undefined),
    dispose: vi.fn(),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    playFromStep: vi.fn(async () => undefined),
    setTempo: vi.fn(),
    getPlaybackSnapshot: vi.fn(() => ({
      state: 'IDLE' as const,
      currentStep: 0,
      totalSteps: 1,
      currentTime: 0,
      duration: 12,
    })),
    onPlaybackIteration: vi.fn(),
    onPlaybackStateChange: vi.fn(),
    resetCursor: vi.fn(),
    hideCursor: vi.fn(),
    syncCursorToStep: vi.fn(),
    ensureCursorVisible: vi.fn(),
  };
  return controller;
}

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ common: { errorBoundaryDesc: 'Load failed' } }}>
      {children}
    </NextIntlClientProvider>
  );
}

describe('score preview playback ownership', () => {
  it('formats playback time defensively', () => {
    expect(formatPlaybackTime(65.9)).toBe('01:05');
    expect(formatPlaybackTime(Number.NaN)).toBe('00:00');
  });

  it('disposes a loaded controller when the modal closes', async () => {
    const controller = createFakeController();
    const createController = vi.fn(async () => controller);
    const { result, rerender } = renderHook(
      ({ isOpen }) => useScorePreviewPlayback({ isOpen, xmlString: '<score-partwise />', createController }),
      { initialProps: { isOpen: true }, wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ isOpen: false });

    await waitFor(() => expect(controller.dispose).toHaveBeenCalledTimes(1));
  });

  it('reloads the Verovio controller when the MusicXML changes', async () => {
    const firstController = createFakeController();
    const secondController = createFakeController();
    const createController = vi
      .fn()
      .mockResolvedValueOnce(firstController)
      .mockResolvedValueOnce(secondController);
    const { result, rerender } = renderHook(
      ({ xmlString }) => useScorePreviewPlayback({ isOpen: true, xmlString, createController }),
      { initialProps: { xmlString: '<score-partwise><work><work-title>Old</work-title></work></score-partwise>' }, wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(firstController.loadScore).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ xmlString: '<score-partwise><work><work-title>New</work-title></work></score-partwise>' });

    await waitFor(() => expect(firstController.dispose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(secondController.loadScore).toHaveBeenCalledTimes(1));
    expect(secondController.loadScore).toHaveBeenCalledWith('<score-partwise><work><work-title>New</work-title></work></score-partwise>');
  });

  it('disposes a controller whose score load fails', async () => {
    const controller = createFakeController(new Error('Invalid score'));
    const { result } = renderHook(
      () => useScorePreviewPlayback({
        isOpen: true,
        xmlString: '<score-partwise />',
        createController: async () => controller,
      }),
      { wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.loadError).toBe('Invalid score'));
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it('suspends window following on manual scroll and can return to playback', async () => {
    const controller = createFakeController();
    const { result } = renderHook(
      () => useScorePreviewPlayback({
        isOpen: true,
        xmlString: '<score-partwise />',
        createController: async () => controller,
        followViewport: 'window',
      }),
      { wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const playbackStateListener = vi.mocked(controller.onPlaybackStateChange).mock.calls[0][0];

    act(() => playbackStateListener('PLAYING'));
    act(() => window.dispatchEvent(new WheelEvent('wheel')));
    expect(result.current.isFollowSuspended).toBe(true);
    expect(controller.pause).not.toHaveBeenCalled();

    act(() => result.current.returnToPlaybackPosition());
    expect(result.current.isFollowSuspended).toBe(false);
    expect(controller.ensureCursorVisible).toHaveBeenLastCalledWith({
      scrollTarget: 'window',
      force: true,
    });
  });

  it('shows the opening cursor only when playback starts from the beginning', async () => {
    const controller = createFakeController();
    vi.mocked(controller.getPlaybackSnapshot).mockReturnValue({
      state: 'STOPPED',
      currentStep: 0,
      totalSteps: 10,
      currentTime: 0,
      duration: 12,
    });
    const { result } = renderHook(
      () => useScorePreviewPlayback({
        isOpen: true,
        xmlString: '<score-partwise />',
        createController: async () => controller,
      }),
      { wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(controller.resetCursor).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.playPause();
    });

    expect(controller.resetCursor).toHaveBeenCalledWith({
      scrollIntoView: true,
      scrollTarget: 'container',
    });
    expect(controller.play).toHaveBeenCalledTimes(1);
  });

  it('hides the cursor when playback is stopped manually', async () => {
    const controller = createFakeController();
    const { result } = renderHook(
      () => useScorePreviewPlayback({
        isOpen: true,
        xmlString: '<score-partwise />',
        createController: async () => controller,
      }),
      { wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.stop();
    });

    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(controller.hideCursor).toHaveBeenCalledTimes(1);
  });

  it('keeps the cursor at the dragged seek target without resetting to the opening event', async () => {
    const controller = createFakeController();
    vi.mocked(controller.getPlaybackSnapshot).mockReturnValue({
      state: 'PAUSED',
      currentStep: 0,
      totalSteps: 10,
      currentTime: 0,
      duration: 12,
    });
    const { result } = renderHook(
      () => useScorePreviewPlayback({
        isOpen: true,
        xmlString: '<score-partwise />',
        createController: async () => controller,
      }),
      { wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.seek([40]));

    expect(controller.resetCursor).not.toHaveBeenCalled();
    expect(controller.syncCursorToStep).toHaveBeenCalledWith(4, {
      alignBeforeFirstEventToMeasureStart: false,
      scrollIntoView: true,
      scrollTarget: 'container',
    });
  });

  it('resets to the first visible event when seeking to the beginning', async () => {
    const controller = createFakeController();
    vi.mocked(controller.getPlaybackSnapshot).mockReturnValue({
      state: 'PAUSED',
      currentStep: 0,
      totalSteps: 10,
      currentTime: 0,
      duration: 12,
    });
    const { result } = renderHook(
      () => useScorePreviewPlayback({
        isOpen: true,
        xmlString: '<score-partwise />',
        createController: async () => controller,
      }),
      { wrapper: IntlWrapper }
    );

    act(() => result.current.scoreContainerRef(document.createElement('div')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.seek([0]));

    expect(controller.resetCursor).toHaveBeenCalledWith({
      scrollIntoView: true,
      scrollTarget: 'container',
    });
    expect(controller.syncCursorToStep).not.toHaveBeenCalled();
  });
});
