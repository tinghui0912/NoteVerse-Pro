// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScoreInfoPanel } from './score-info-panel';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/queries/use-score-queries', () => ({
  useUpdateScore: () => ({ mutate, isPending: false }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/score/score-capability-context', () => ({
  useScoreCapabilities: () => ({ capabilities: { can_edit: true } }),
}));
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === 'removeStyleTag' ? `Remove ${values?.name}` : key,
}));

beforeEach(() => {
  mutate.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

it('edits genres using code identity and the metadata version', async () => {
  render(
    <ScoreInfoPanel
      displayTitle="Score"
      scoreId="score"
      genres={['jazz', 'classical']}
      imageCount={1}
      metadataVersion={7}
    />
  );
  expect(screen.getByText('classical')).toBeInTheDocument();
  expect(screen.getByText('jazz')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remove classical' }));
  expect(mutate).toHaveBeenLastCalledWith(
    { scoreId: 'score', genres: ['jazz'], expected_metadata_version: 7 },
    expect.any(Object)
  );
  screen.getByRole('combobox').focus();
  await userEvent.keyboard('{Enter}');
  screen.getByRole('option', { name: 'rock' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(mutate).toHaveBeenLastCalledWith(
    { scoreId: 'score', genres: ['jazz', 'rock'], expected_metadata_version: 7 },
    expect.any(Object)
  );
  await userEvent.click(screen.getByRole('button', { name: 'clearStyleTags' }));
  expect(mutate).toHaveBeenLastCalledWith(
    { scoreId: 'score', genres: [], expected_metadata_version: 7 },
    expect.any(Object)
  );
});
