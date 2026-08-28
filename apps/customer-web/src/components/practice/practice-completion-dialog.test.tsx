// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import practiceMessages from '../../../messages/en/practice.json';
import { PracticeCompletionDialog } from './practice-completion-dialog';
import type { PracticeCompletionOutcome } from '@/lib/practice/completion-outcome';

function renderDialog(outcome: PracticeCompletionOutcome) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
      <PracticeCompletionDialog
        open
        audioUrl={null}
        outcome={outcome}
        isLoading={false}
        onOpenChange={vi.fn()}
        onRestart={vi.fn()}
        onAdjustSection={vi.fn()}
        onViewSummary={vi.fn()}
        onStartFullPiecePerformance={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

describe('PracticeCompletionDialog', () => {
  it('does not show a full-performance CTA after selected-section completion', () => {
    renderDialog({
      kind: 'selected-section',
      expectsPlayback: false,
      canViewSummary: false,
      canStartFullPiecePerformance: false,
    });

    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Adjust Range' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Start Full Performance' })
    ).not.toBeInTheDocument();
  });

  it('keeps the full-performance CTA for full-piece learning completion', () => {
    renderDialog({
      kind: 'full-piece-learning',
      expectsPlayback: false,
      canViewSummary: false,
      canStartFullPiecePerformance: true,
    });

    expect(screen.getByRole('button', { name: 'Start Full Performance' })).toBeEnabled();
  });
});
