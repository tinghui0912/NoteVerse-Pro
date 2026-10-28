// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '../../../messages/en/practice.json';
import zh from '../../../messages/zh/practice.json';
import { AnalysisInterruptionDialog } from './analysis-interruption-dialog';
afterEach(cleanup);
it.each([['en', en], ['zh', zh]] as const)('blocks dismissal and exposes two explicit localized choices in %s', async (locale, messages) => {
  const onContinueWithoutAnalysis = vi.fn(async () => {}), onEnd = vi.fn(async () => {});
  render(<NextIntlClientProvider locale={locale} messages={{ practice: messages }}><AnalysisInterruptionDialog
    {...{ onContinueWithoutAnalysis, onEnd }} /></NextIntlClientProvider>);
  const dialog = screen.getByRole('alertdialog'); expect(dialog).toHaveAccessibleName(messages.analysisStopped);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent.pointerDown(document.body);
  expect(dialog).toBeVisible(); expect(onEnd).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: messages.continueWithoutAnalysis })); });
  expect(onContinueWithoutAnalysis).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: /Restart|重新开始/ })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: messages.finish })); }); expect(onEnd).toHaveBeenCalledOnce();
});
it('prevents duplicate decisions while resource release is pending', async () => {
  let done!: () => void; const onContinueWithoutAnalysis = vi.fn(() => new Promise<void>(resolve => { done = resolve; }));
  render(<NextIntlClientProvider locale="en" messages={{ practice: en }}><AnalysisInterruptionDialog
    onContinueWithoutAnalysis={onContinueWithoutAnalysis} onEnd={async () => {}} /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: en.continueWithoutAnalysis }));
  expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true);
  await act(async () => { done(); }); expect(screen.getByRole('button', { name: en.finish })).toBeEnabled();
});
