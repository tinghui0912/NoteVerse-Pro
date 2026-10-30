// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import { ScoreHeroActions } from './score-hero-actions';
import score from '../../../messages/en/score.json';
import common from '../../../messages/en/common.json';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
vi.mock('@/i18n/routing', () => ({ Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/score/score-capability-context', () => ({ useScoreCapabilities: () => ({ capabilities: { can_practice: true } }) }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScorePublication: () => ({}), usePublishScore: () => ({}), useUnpublishScore: () => ({}) }));
vi.mock('@/hooks/use-download', () => ({ useDownload: () => ({ handleDownload: vi.fn() }) }));
const assets = { render_assets: [], revision_sources: [] } as unknown as ComponentProps<typeof ScoreHeroActions>['revisionAssets'];
it.each([true, false])('Score Detail Practice enters pinned Setup regardless of Environment readiness=%s', async ready => {
  const environment = new PracticeEnvironment({ modelUrl: vi.fn(), createEngine: vi.fn(), probe: vi.fn(async (_requirements, mark) => { mark('midi'); }) });
  if (ready) await environment.requalify(['midi']);
  const matches = vi.spyOn(environment, 'matches');
  render(<NextIntlClientProvider locale="en" messages={{ score, common }}>
    <ScoreHeroActions scoreId="score" revisionId="current-head" revisionAssets={assets} />
  </NextIntlClientProvider>);
  expect(screen.getByRole('link', { name: score.practiceScore })).toHaveAttribute('href', '/score/score/practice/setup?practiceRevisionId=current-head');
  expect(matches).not.toHaveBeenCalled(); await environment.dispose();
});
it('Score Detail enters Setup when the head identity is not available', () => {
  render(<NextIntlClientProvider locale="en" messages={{ score, common }}>
    <ScoreHeroActions scoreId="score" revisionAssets={assets} />
  </NextIntlClientProvider>);
  expect(screen.getByRole('link', { name: score.practiceScore })).toHaveAttribute('href', '/score/score/practice/setup');
});
