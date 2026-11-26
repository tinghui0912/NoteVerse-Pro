// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import messages from '@/../messages/en/score.json';
import { ScoreThumbnail } from '@/features/scores/core/components/score-thumbnail';
import { ScoreDetailHero } from './score-detail-hero';
import { playableAudioRevisionId } from '@/features/scores/core/detail/derived-assets';
import type { ScoreDerivedAssetRead } from '@/generated/api';

afterEach(cleanup);

it.each(['pending', 'processing', 'unavailable', 'ready'] as const)('renders %s presentation without visible status copy', status => {
  const preparing = status === 'pending' || status === 'processing';
  const ready = status === 'ready';
  const { container } = render(<NextIntlClientProvider locale="en" messages={{ score: messages }}>
    <ScoreDetailHero title="Head score" thumbnailLoading={preparing} thumbnailUrl={ready ? '/head.svg' : null}
      playbackVisible playbackEnabled={ready} playbackLoading={preparing} loadPlayback={ready ? async () => ({playback_url:'https://objects.example/head.wav',expires_in:900}) : undefined} />
  </NextIntlClientProvider>);
  const playback = screen.getByRole('button');
  expect(playback.hasAttribute('disabled')).toBe(!ready);
  expect(playback.getAttribute('aria-label')).toBeTruthy();
  expect(playback.hasAttribute('title')).toBe(false);
  expect(container.textContent).toBe('Head scoreScore Information');
  expect(container.querySelectorAll('button')).toHaveLength(1);
  expect(container.querySelectorAll('img')).toHaveLength(ready ? 1 : 0);
  expect(container.querySelectorAll('.animate-spin')).toHaveLength(preparing ? 2 : 0);
});

it.each(['pending', 'processing', 'unavailable', 'ready'] as const)('selects only the Score head for %s audio', status => {
  const audio: ScoreDerivedAssetRead = { status, asset_id: status === 'ready' ? 'asset' : null };
  const derived = { audio, preview: audio };
  expect(playableAudioRevisionId(derived, true, 'current-head')).toBe(status === 'ready' ? 'current-head' : null);
  expect(playableAudioRevisionId(derived, false, 'current-head')).toBeNull();
  expect(playableAudioRevisionId(derived, true, null)).toBeNull();
});


it('allows the newly admitted thumbnail identity after a previous image error', () => {
  const { rerender } = render(<ScoreThumbnail title="Current score" thumbnailRenderAssetId="r1" />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  rerender(<ScoreThumbnail title="Current score" thumbnailRenderAssetId={null} />);
  expect(screen.queryByRole('img')).toBeNull();
  rerender(<ScoreThumbnail title="Current score" thumbnailRenderAssetId="r2" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe(new URL('/api/v1/render-assets/r2/view', window.location.href).href);
});
