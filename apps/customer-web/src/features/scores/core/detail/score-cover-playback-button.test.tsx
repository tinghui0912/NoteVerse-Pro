// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScoreCoverPlaybackButton } from './score-cover-playback-button';
import score from '@/../messages/en/score.json';
class AudioAsset extends EventTarget {
  constructor(public src = '') {super();}
  preload = '';
  play = vi.fn(async () => {this.dispatchEvent(new Event('play'));});
  pause = vi.fn(() => {this.dispatchEvent(new Event('pause'));});
}
const assets: AudioAsset[] = [];
beforeEach(() => {assets.length = 0; vi.stubGlobal('Audio', class extends AudioAsset {constructor(src: string) {super(src);assets.push(this);}});});
afterEach(() => vi.unstubAllGlobals());
const wrapper = ({children}: {children: React.ReactNode}) => <NextIntlClientProvider locale="en" messages={{score}}>{children}</NextIntlClientProvider>;
it('plays the admitted audio, pauses and releases it on unmount', async () => {
  const view = render(<ScoreCoverPlaybackButton audioSrc="/api/v1/scores/score/playback" />, {wrapper});
  await userEvent.click(screen.getByRole('button', {name: score.playScore}));
  expect(assets).toHaveLength(1);
  expect(assets[0].src).toBe('/api/v1/scores/score/playback');
  expect(screen.getByRole('button', {name: score.pauseScore})).toBeVisible();
  await userEvent.click(screen.getByRole('button', {name: score.pauseScore}));
  expect(assets[0].pause).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', {name: score.playScore}));
  act(() => assets[0].dispatchEvent(new Event('ended')));
  expect(screen.getByRole('button', {name: score.playScore})).toBeVisible();
  view.unmount();expect(assets[0].pause).toHaveBeenCalledTimes(2);
});
it.each([false, true])('disables playback until audio is available (loading=%s)', loading => {
  render(<ScoreCoverPlaybackButton loading={loading} />, {wrapper});
  expect(screen.getByRole('button', {name: loading ? score.playbackPreparing : score.playbackUnavailable})).toBeDisabled();
});
