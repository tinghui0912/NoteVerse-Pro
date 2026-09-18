// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeControls } from './practice-controls';

function renderControls(
  rangeSelectionActive: boolean,
  overrides: Partial<ComponentProps<typeof PracticeControls>> = {}
) {
  render(
    <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
      <PracticeControls
        lifecycle="READY"
        isLoading={false}
        isPreparingSession={false}
        canPrepareSession
        audioWorkletSupported
        rangeSelectionActive={rangeSelectionActive}
        canSelectRange
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onFinish={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleRangeSelection={vi.fn()}
        {...overrides}
      />
    </NextIntlClientProvider>
  );
}

describe('PracticeControls', () => {
  it('keeps the section button label stable while active', () => {
    renderControls(true);

    const button = screen.getByRole('button', { name: /section/i });
    expect(button).toHaveTextContent('Section');
    expect(button).toHaveClass('bg-slate-200');
  });

  it('renders settings inside the bottom controls', () => {
    renderControls(false);

    expect(screen.getByRole('button', { name: /settings/i })).toBeEnabled();
  });

  it('calls onPause when active and onResume when paused', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();

    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeControls
          lifecycle="ACTIVE"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          audioWorkletSupported
          rangeSelectionActive={false}
          canSelectRange={false}
          onStart={vi.fn()}
          onPause={onPause}
          onResume={onResume}
          onFinish={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const pauseButton = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseButton);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeControls
          lifecycle="PAUSED"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          audioWorkletSupported
          rangeSelectionActive={false}
          canSelectRange={false}
          onStart={vi.fn()}
          onPause={onPause}
          onResume={onResume}
          onFinish={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const resumeButton = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(resumeButton);
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
