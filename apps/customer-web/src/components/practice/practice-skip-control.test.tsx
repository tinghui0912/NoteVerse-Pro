// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeSkipControl } from './practice-skip-control';

function renderSkipControl({
  visible = true,
  disabled = false,
  onSkip = vi.fn(),
}: {
  visible?: boolean;
  disabled?: boolean;
  onSkip?: () => void;
} = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
      <PracticeSkipControl visible={visible} disabled={disabled} onSkip={onSkip} />
    </NextIntlClientProvider>
  );
  return { onSkip };
}

describe('PracticeSkipControl', () => {
  it('does not render outside active step-by-step practice', () => {
    renderSkipControl({ visible: false });

    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('sends one skip action when clicked', () => {
    const onSkip = vi.fn();
    renderSkipControl({ onSkip });

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('keeps skip disabled during paused step-by-step practice', () => {
    const onSkip = vi.fn();
    renderSkipControl({ disabled: true, onSkip });

    const button = screen.getByRole('button', { name: /skip/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSkip).not.toHaveBeenCalled();
  });
});
