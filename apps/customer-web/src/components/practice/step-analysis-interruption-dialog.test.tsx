// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '../../../messages/en/practice.json';
import zh from '../../../messages/zh/practice.json';
import { StepAnalysisInterruptionDialog } from './step-analysis-interruption-dialog';
afterEach(cleanup);
it.each([['en',en],['zh',zh]] as const)('STEP %s exposes exactly End and prevents dismissal/duplicate End', async (locale,messages) => {
  let release!: () => void; const onEnd=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  render(<NextIntlClientProvider locale={locale} messages={{practice:messages}}><StepAnalysisInterruptionDialog onEnd={onEnd}/></NextIntlClientProvider>);
  const dialog=screen.getByRole('alertdialog'); expect(dialog).toHaveAccessibleName(messages.analysisStopped);
  expect(dialog).toHaveTextContent(messages.stepAnalysisStoppedDescription); expect(screen.getAllByRole('button')).toHaveLength(1);
  const end=screen.getByRole('button',{name:messages.finish});
  fireEvent.keyDown(dialog,{key:'Escape'});fireEvent.pointerDown(document.body);
  expect(dialog).toBeVisible();expect(onEnd).not.toHaveBeenCalled();
  fireEvent.click(end);fireEvent.click(end);expect(onEnd).toHaveBeenCalledOnce();expect(end).toBeDisabled();
  await act(async()=>{release();});
});
it('unmount alone never calls the explicit End command',()=>{
  const onEnd=vi.fn(async()=>{});const view=render(<NextIntlClientProvider locale="en" messages={{practice:en}}><StepAnalysisInterruptionDialog onEnd={onEnd}/></NextIntlClientProvider>);
  view.unmount();expect(onEnd).not.toHaveBeenCalled();
});
