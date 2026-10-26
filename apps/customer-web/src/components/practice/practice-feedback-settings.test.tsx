// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import messages from '../../../messages/en/practice.json';
import { PracticeFeedbackSettings } from './practice-feedback-settings';
import { Switch } from '@/components/ui/switch';

it('owns only Live Feedback, using a labelled keyboard-accessible switch', async () => {
  const change = vi.fn();
  function Fixture() { const [on, setOn] = useState(false); return <PracticeFeedbackSettings enabled={on} onChange={value => { setOn(value); change(value); }} />; }
  render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}><Fixture /></NextIntlClientProvider>);
  const control = screen.getByRole('switch', { name: 'Live note feedback' });
  expect(control).toHaveAttribute('aria-checked', 'false'); fireEvent.click(control);
  expect(control).toHaveAttribute('aria-checked', 'true');
  control.focus(); await userEvent.keyboard(' ');
  expect(control).toHaveAttribute('aria-checked', 'false'); expect(change.mock.calls).toEqual([[true], [false]]);
  expect(control).toHaveClass('focus-visible:ring-2');
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: /MIDI|microphone|audio|video|Step-by-step|Continuous/ })).toBeNull();
});
it('preserves Radix disabled semantics', () => {
  const change = vi.fn(); render(<Switch aria-label="feedback" disabled onCheckedChange={change} />);
  fireEvent.click(screen.getByRole('switch')); expect(change).not.toHaveBeenCalled(); expect(screen.getByRole('switch')).toBeDisabled();
});
