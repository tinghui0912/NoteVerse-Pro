// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en/practice.json';
import { PracticeWorkspaceProvider } from '@/contexts/practice-workspace-context';
import { PracticeEnvironment } from '@/lib/practice/environment/practice-environment';
import { PRACTICE_PREFERENCES_KEY } from '@/lib/practice/configuration/preference-storage';
import PracticeSetupPage from './page';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'score-id' }),
  useSearchParams: () => new URLSearchParams('practiceRevisionId=revision-id'), useRouter: () => navigation }));
afterEach(() => { localStorage.clear(); navigation.replace.mockReset(); });
function setup() {
  const platform = { modelUrl: vi.fn(), createEngine: vi.fn(),
    probe: vi.fn(async (requirements: readonly string[], ready: (key: never) => void) => requirements.forEach(key => ready(key as never))) };
  const environment = new PracticeEnvironment(platform);
  render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}>
    <PracticeWorkspaceProvider createEnvironment={() => environment}><PracticeSetupPage /></PracticeWorkspaceProvider>
  </NextIntlClientProvider>);
  return { platform, environment };
}
it('requires explicit first-use selections and prepares MIDI without any acoustic prerequisite', async () => {
  const r = setup();
  expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Step-by-step/ })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: /Step-by-step/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare practice' })); });
  expect(r.platform.probe.mock.calls[0][0]).toEqual(['midi']); expect(r.platform.createEngine).not.toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('/score/score-id/practice?practiceRevisionId=revision-id');
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  expect(screen.getByText('MIDI keyboard: Not prepared')).toBeVisible();
  expect(screen.queryByText('MIDI keyboard: Ready')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeEnabled();
});
it('requires explicit Continuous recording and keeps VIDEO intent when camera preparation fails', async () => {
  const r = setup(); r.platform.probe.mockRejectedValueOnce(new Error('CAMERA_PERMISSION_DENIED'));
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI keyboard' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Prepare practice' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare practice' })); });
  expect(r.environment.snapshot().status).toBe('BLOCKED');
  expect(JSON.parse(localStorage.getItem(PRACTICE_PREFERENCES_KEY)!).continuous.recordingMode).toBe('VIDEO');
  expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Check browser permissions'); expect(navigation.replace).not.toHaveBeenCalled();
});

it('Setup owns readiness configuration and exposes no presentation-feedback control', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /Continuous play/ }));
  for (const name of ['MIDI keyboard', 'Microphone', 'Audio', 'Video']) expect(screen.getByRole('button', { name })).toBeVisible();
  expect(screen.queryByRole('switch')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(messages.liveNoteFeedback)).toBeNull();
});
