// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeControls } from './practice-controls';

function renderControls(rangeSelectionActive: boolean) {
  render(
    <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
      <PracticeControls
        status="idle"
        connectionStatus="ready"
        isLoading={false}
        isPreparingSession={false}
        canPrepareSession
        audioWorkletSupported
        rangeSelectionActive={rangeSelectionActive}
        canSelectRange
        onStart={vi.fn()}
        onPause={vi.fn()}
        onFinish={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleRangeSelection={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

describe('PracticeControls', () => {
  it('keeps the section button label stable while active', () => {
    renderControls(true);

    const button = screen.getByRole('button', { name: /select section/i });
    expect(button).toHaveTextContent('Select section');
    expect(button).toHaveClass('bg-slate-200');
  });

  it('renders settings inside the bottom controls', () => {
    renderControls(false);

    expect(screen.getByRole('button', { name: /practice settings/i })).toBeEnabled();
  });
});
