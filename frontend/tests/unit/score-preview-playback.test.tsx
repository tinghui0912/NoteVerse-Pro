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
});
