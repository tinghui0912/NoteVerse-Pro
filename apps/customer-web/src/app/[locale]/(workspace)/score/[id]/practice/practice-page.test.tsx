// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import practice from '../../../../../../../messages/en/practice.json';
import common from '../../../../../../../messages/en/common.json';
import errors from '../../../../../../../messages/en/errors.json';
import artifact from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import PracticePage from './page';
import type { PracticeResourceIntervention } from '@/lib/practice/continuous/resource-intervention';

const fake = vi.hoisted(() => {
  const local = { mode: 'STEP_BY_STEP', lifecycle: 'ACTIVE', inputState: 'READY', inputError: null,
    analysisIntervention: null as { kind: string } | null, infrastructureIntervention: null as { kind: string } | null,
    resourceIntervention: null as PracticeResourceIntervention | null,
    activeStepGroup: { groupId: 'retained-target' }, isFinalizingPerformance: false, stepInteractionPhase: 'READY',
    restart: vi.fn(async () => {}), start: vi.fn(), abandon: vi.fn(async () => {}), setMetronomeEnabled: vi.fn() };
  const workspace = { ready: true, hydrated: true, readiness: { status: 'READY' },
    profile: { mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', continuous: { recordingMode: 'OFF', liveFeedbackEnabled: false } },
    scope: { kind: 'FULL' }, tempoSelection: { mode: 'SCORE' }, metronomeEnabled: false,
    setScope: vi.fn(), setTempoSelection: vi.fn(), setMetronomeEnabled: vi.fn(), updateProfile: vi.fn(),
    environment: { invalidate: vi.fn(), acquireInference: vi.fn() } };
  return { local, workspace, router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
    device: { snapshot: { state: 'READY', issue: null, health: { inputMicrophone: 'HEALTHY' }, roots: {} }, borrow: vi.fn(), observe: vi.fn() },
    natural: (_snapshot: { completionReason: string }) => {} };
});
vi.mock('next/navigation', () => ({ useRouter: () => fake.router, usePathname: () => '/score/score-id/practice',
  useSearchParams: () => new URLSearchParams('practiceRevisionId=pinned-revision') }));
vi.mock('@/contexts/practice-workspace-context', () => ({ usePracticeWorkspace: () => fake.workspace }));
vi.mock('@/hooks/practice/use-practice-device-lease', () => ({ usePracticeDeviceLease: () => fake.device }));
vi.mock('@/hooks/practice/use-local-practice', () => ({ useLocalPractice: (options: { onNaturalCompletion: typeof fake.natural }) => { fake.natural = options.onNaturalCompletion; return fake.local; } }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScoreDetail: () => ({ data: { data: { capabilities: { can_practice: true }, head_revision_id: 'head-revision' } } }) }));
vi.mock('@/hooks/practice/use-practice-ready-score-content', () => ({ usePracticeReadyScoreContent: () => ({ data: { data: { content: '<score />' } } }) }));
vi.mock('@/hooks/practice/use-practice-score-artifact', () => ({ usePracticeScoreArtifact: () => ({ data: artifact }) }));
vi.mock('@/hooks/practice/use-practice-range-selection', () => ({ usePracticeRangeSelection: () => ({ practiceScope: { kind: 'FULL' }, isIncomplete: false, isSelecting: false }) }));
vi.mock('@/lib/practice/input-capability', () => ({ evaluatePracticeInputCapabilities: () => ({}), getSelectedInputCapability: () => ({ supported: true }) }));
vi.mock('@/components/states', () => ({ ResourceLoadError: () => null }));
vi.mock('@/components/score/workspace-access-denied', () => ({ WorkspaceAccessDenied: () => null }));
vi.mock('@/components/practice/practice-readiness-gate', () => ({ PracticeReadinessGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/client-only', () => ({ ClientOnly: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/score/score-surface', () => ({ ScoreSurface: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/practice/practice-score-viewer', () => ({ PracticeScoreViewer: ({ sessionStatus }: { sessionStatus: React.ReactNode }) => sessionStatus }));

beforeEach(() => {
  vi.clearAllMocks(); fake.local.mode = 'STEP_BY_STEP'; fake.local.lifecycle = 'ACTIVE';
  fake.local.analysisIntervention = null; fake.local.infrastructureIntervention = null; fake.local.resourceIntervention = null;
  fake.workspace.ready = true; fake.workspace.readiness.status = 'READY'; fake.workspace.profile.mode = 'STEP_BY_STEP'; fake.device.snapshot.state = 'READY';
  fake.workspace.environment.invalidate.mockReset();
  fake.local.abandon.mockImplementation(async () => { fake.local.lifecycle = fake.local.mode === 'CONTINUOUS_PLAY' ? 'READY' : 'IDLE'; fake.local.analysisIntervention = null; fake.local.infrastructureIntervention = null; fake.local.resourceIntervention = null; });
});
afterEach(cleanup);
async function openPage() {
  await act(async () => { render(<NextIntlClientProvider locale="en" messages={{ practice, common, errors }}><Suspense><PracticePage params={Promise.resolve({id:'score-id'})} /></Suspense></NextIntlClientProvider>); });
  await screen.findByRole('button', { name: practice.practiceSetup, hidden: true });
  fake.local.restart.mockClear();
}
it('top Setup navigation preserves READY evidence and exact pinned revision without environment/device side effects', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: practice.practiceSetup }));
  expect(fake.workspace.environment.invalidate).not.toHaveBeenCalled();
  expect(fake.router.push).toHaveBeenCalledWith('/score/score-id/practice/setup?practiceRevisionId=pinned-revision');
  expect(fake.workspace.ready).toBe(true); expect(fake.local.restart).not.toHaveBeenCalled(); expect(fake.local.start).not.toHaveBeenCalled();
});
it('Settings shares the pure Setup navigation', async () => {
  await openPage(); fireEvent.click(screen.getByRole('button', { name: practice.settingsButton }));
  fireEvent.click(screen.getByRole('button', { name: practice.setupChangeConfiguration }));
  expect(fake.workspace.environment.invalidate).not.toHaveBeenCalled();
  expect(fake.router.push).toHaveBeenCalledWith('/score/score-id/practice/setup?practiceRevisionId=pinned-revision');
});
for (const incident of ['analysisIntervention', 'infrastructureIntervention'] as const) it(`terminal ${incident} End never exposes Continue even with healthy roots`, async () => {
  fake.local[incident] = {kind: incident === 'analysisIntervention' ? 'TERMINAL_ANALYSIS_FAILURE' : 'TERMINAL_INFRASTRUCTURE_FAILURE'};
  await openPage();
  await act(async () => { fireEvent.click(screen.getByRole('alertdialog').querySelector('button')!); });
  expect(fake.local.abandon).toHaveBeenCalledOnce(); expect(fake.local.lifecycle).toBe('IDLE');
  expect(fake.device.snapshot.state).toBe('READY'); expect(fake.workspace.ready).toBe(true);
  expect(screen.queryByRole('button', {name:practice.continueLearning})).toBeNull();
  expect(screen.getByRole('button', {name:practice.practiceSetup})).toBeVisible();
  expect(fake.local.restart).not.toHaveBeenCalled();
});
it('ordinary healthy STEP End retains explicit Continue', async () => {
  await openPage();
  await act(async () => { fireEvent.click(screen.getByRole('button', {name:practice.finish})); });
  expect(await screen.findByRole('button', {name:practice.continueLearning})).toBeEnabled();
  expect(fake.local.abandon).toHaveBeenCalledOnce(); expect(fake.local.restart).not.toHaveBeenCalled();
});
for (const ready of [true, false]) it(`completion Try Again with devices ready=${ready} never renews devices`, async () => {
  fake.local.mode = 'CONTINUOUS_PLAY'; fake.local.lifecycle = 'COMPLETED'; fake.workspace.profile.mode = 'CONTINUOUS_PLAY';
  await openPage();
  if (!ready) fake.device.snapshot.state = 'FAULTED';
  await act(async () => { fake.natural({completionReason:'SCOPE_COMPLETED'}); });
  fireEvent.click(screen.getByRole('button', {name:practice.retryPractice}));
  await waitFor(() => ready ? expect(fake.local.restart).toHaveBeenCalledOnce() : expect(fake.router.push).toHaveBeenCalled());
  expect(fake.workspace.environment.invalidate).not.toHaveBeenCalled();
  expect(fake.workspace.ready).toBe(true);
});

it('hard Continuous capture End restores healthy explicit Start without forcing Setup or restarting', async () => {
  fake.local.mode = 'CONTINUOUS_PLAY'; fake.local.lifecycle = 'PAUSED'; fake.workspace.profile.mode = 'CONTINUOUS_PLAY';
  fake.local.resourceIntervention = { reason: 'CAPTURE_PIPELINE_INVALID', impact: 'INPUT_REQUIRED', recoverability: 'RESTART_REQUIRED',
    state: 'WAITING_FOR_USER', pauseOrigin: 'INTERVENTION' };
  await openPage();
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveAccessibleName(practice.captureProcessingStopped);
  expect(dialog.textContent).not.toMatch(/disconnected|CAPTURE_BOUNDARY_LIMIT_EXCEEDED/);
  expect(dialog.querySelectorAll('button')).toHaveLength(1);
  await act(async () => { fireEvent.click(dialog.querySelector('button')!); });
  expect(fake.local.abandon).toHaveBeenCalledOnce(); expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(fake.workspace.ready).toBe(true); expect(fake.device.snapshot.state).toBe('READY');
  expect(fake.router.push).not.toHaveBeenCalled(); expect(fake.local.restart).not.toHaveBeenCalled(); expect(fake.local.start).not.toHaveBeenCalled();
  const start = screen.getByRole('button', { name: practice.start });
  expect(start).toBeEnabled(); fireEvent.click(start); expect(fake.local.start).toHaveBeenCalledOnce();
});
