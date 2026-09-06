// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import practiceMessages from '../../../messages/en/practice.json';
import { PracticeCompletionDialog } from './practice-completion-dialog';
import type { PracticeCompletionOutcome } from '@/lib/practice/completion-outcome';
import type { PracticeSessionMode } from '@/lib/practice/session-policy';

function renderDialog(
  outcome: PracticeCompletionOutcome,
  sessionMode: PracticeSessionMode = 'STEP_BY_STEP'
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
      <PracticeCompletionDialog
        open
        outcome={outcome}
        sessionMode={sessionMode}
        isLoading={false}
        onOpenChange={vi.fn()}
        onRestart={vi.fn()}
        onAdjustSection={vi.fn()}
        onViewSummary={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

describe('PracticeCompletionDialog', () => {
  it('shows retry and section practice after selected-section completion', () => {
    renderDialog({
      kind: 'selected-section',
    });

    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Adjust Section' })).toBeEnabled();
    expect(screen.queryByText('Preparing playback...')).not.toBeInTheDocument();
  });

  it('shows retry and section practice after full-piece step-by-step completion', () => {
    renderDialog({
      kind: 'full-piece-learning',
    });

    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Section Practice' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'View Report' })).not.toBeInTheDocument();
  });

  it('shows retry and report after full-piece performance completion', () => {
    renderDialog({
      kind: 'full-piece-performance',
    }, 'CONTINUOUS_PLAY');

    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'View Report' })).toBeEnabled();
    expect(screen.queryByText('Preparing playback...')).not.toBeInTheDocument();
  });

  it('uses performance actions for selected continuous ranges', () => {
    renderDialog({
      kind: 'selected-section',
    }, 'CONTINUOUS_PLAY');

    expect(screen.getByRole('button', { name: 'Try Again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'View Report' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Section Practice' })).not.toBeInTheDocument();
  });

  it('shows the report action loading state while opening the report', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: practiceMessages }}>
        <PracticeCompletionDialog
          open
          outcome={{ kind: 'full-piece-performance' }}
          sessionMode="CONTINUOUS_PLAY"
          isLoading
          onOpenChange={vi.fn()}
          onRestart={vi.fn()}
          onAdjustSection={vi.fn()}
          onViewSummary={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: 'View Report' })).toBeDisabled();
  });
});
