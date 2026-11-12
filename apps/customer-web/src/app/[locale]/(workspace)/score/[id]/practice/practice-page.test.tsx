import { memoryRecordingSinkFactory } from '@/lib/practice/__fixtures__/recording-sink';
import { metronomeAudioFixture } from '@/lib/practice/__fixtures__/metronome';
// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import practice from '../../../../../../../messages/en/practice.json';
import common from '../../../../../../../messages/en/common.json';
import errors from '../../../../../../../messages/en/errors.json';
import artifact from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { borrowedDevices } from '@/lib/practice/__fixtures__/device-roots';
import { rootHealthFixture } from '@/lib/practice/__fixtures__/root-health';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import type { PracticeConfiguration } from '@/lib/practice/configuration/preferences';
import { ManualClock } from '@/lib/practice/session/timebase';
import { StepPracticeController } from '@/lib/practice/step/step-practice-controller';
import { ContinuousPracticeController } from '@/lib/practice/continuous/continuous-practice-controller';
import { PerformanceRecorder } from '@/lib/practice/recording/performance-recorder';
import PracticePage from './page';

const fake = vi.hoisted(() => ({ incomplete: false, routeScoreId: 'score-id', revision: 'pinned-revision' as string | null, mismatchMode: false,
  scoreRequest: vi.fn(), sourceRequest: vi.fn(),
  step: vi.fn(), continuous: vi.fn(), leaseEnabled: vi.fn(), viewer: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }));
let health: ReturnType<typeof rootHealthFixture>;
let mode: 'STEP_BY_STEP' | 'CONTINUOUS_PLAY';
let ready: boolean, deviceReady: boolean;
let clock: ManualClock;
const environment = { acquireInference: vi.fn(), acousticState: () => 'READY_IDLE', subscribeAcoustic: () => () => {} };
const binding = {};
const admittedArtifact = artifact;
const workspace = { get preparedPractice() { return ready ? { admission: { bundle: { binding: { scoreId: 'score-id', revisionId: 'pinned-revision', bundleId: 'source' }, artifact: admittedArtifact, musicXml: '<score />' }, configuration: { mode: fake.mismatchMode ? 'OTHER' : mode, inputSource: 'MIDI', recordingMode: 'OFF' } }, binding } : null; }, clearPreparedPractice: vi.fn(), handoffToReview: vi.fn(), hydrated: true,
  get profile() { return { mode: fake.incomplete ? null : mode, inputSource: fake.incomplete ? null : 'MIDI', continuous: { recordingMode: 'OFF', liveFeedbackEnabled: false } }; },
  get configuration(): PracticeConfiguration | null { return fake.incomplete ? null : { mode, inputSource: 'MIDI', recordingMode: 'OFF', liveFeedbackEnabled: false }; },
  get resourcePlan() { return this.configuration ? planPracticeResources(this.configuration) : null; }, scope: { kind: 'FULL' },
  tempoSelection: { mode: 'SCORE' }, metronomeEnabled: false, setScope: vi.fn(), setTempoSelection: vi.fn(),
  setMetronomeEnabled: vi.fn(), updateProfile: vi.fn(), environment };
vi.mock('@/i18n/routing', () => ({ Link: ({ children }: { children: unknown }) => children, useRouter: () => fake.router }));
vi.mock('next/navigation', () => ({ useRouter: () => fake.router, useSearchParams: () => new URLSearchParams(fake.revision ? `practiceRevisionId=${fake.revision}` : '') }));
vi.mock('@/contexts/practice-workspace-context', () => ({ usePracticeWorkspace: () => workspace }));
vi.mock('@/hooks/practice/use-practice-resource-binding', () => ({ usePracticeResourceBinding: (owner: unknown) => {
  fake.leaseEnabled(Boolean(owner)); return { snapshot: { state: deviceReady ? 'READY' : 'FAULTED', health: {}, roots: {}, issue: null },
    rootHealth: health.port, borrow: () => deviceReady ? borrowedDevices() : null };
} }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScoreDetail: fake.scoreRequest }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeBundle: fake.sourceRequest } }));
vi.mock('@/lib/practice/step/step-platform', () => ({ browserStepPlatform: (...args: unknown[]) => fake.step(...args) }));
vi.mock('@/lib/practice/continuous/continuous-platform', () => ({ browserContinuousPlatform: (...args: unknown[]) => fake.continuous(...args) }));
vi.mock('@/lib/practice/input-capability', () => ({ evaluatePracticeInputCapabilities: () => ({}), getSelectedInputCapability: () => ({ supported: true }) }));
vi.mock('@/components/client-only', () => ({ ClientOnly: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/practice/practice-score-viewer', () => ({ PracticeScoreViewer: (props: unknown) => { fake.viewer(props); return <div data-testid="score" />; } }));
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); mode = 'STEP_BY_STEP'; ready = true; deviceReady = true; health = rootHealthFixture();
  fake.incomplete=false;fake.mismatchMode=false;fake.routeScoreId='score-id';fake.revision='pinned-revision';
  fake.scoreRequest.mockImplementation(()=>{throw new Error('Score deleted');});fake.sourceRequest.mockRejectedValue(new Error('Source deleted'));
  clock = new ManualClock();
  const createMidi = vi.fn(() => ({ start: vi.fn(async () => {}), refreshInputs: vi.fn(), dispose: vi.fn() }));
  fake.step.mockReturnValue({ clock, timer: { schedule: vi.fn(), cancel: vi.fn() }, createMidi, createMetronomeAudio: () => metronomeAudioFixture() });
  fake.continuous.mockReturnValue({ midiClock: clock, createMidi, createMetronomeAudio: () => metronomeAudioFixture(),
    createRecorder: () => new PerformanceRecorder('OFF', memoryRecordingSinkFactory), acquireInference: vi.fn(), createAudioContext: vi.fn() });
});
afterEach(cleanup);
const pageTree = () => <NextIntlClientProvider locale="en" messages={{ practice, common, errors }}>
  <Suspense><PracticePage params={Promise.resolve({ id: fake.routeScoreId })} /></Suspense>
</NextIntlClientProvider>;
async function openPage() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(pageTree()); });
  await screen.findByRole('button', { name: practice.practiceSetup, hidden: true }); return view;
}
it.each(['STEP_BY_STEP', 'CONTINUOUS_PLAY'] as const)('%s page is READY until explicit Start and End offers Start again', async selected => {
  mode = selected; const step = vi.spyOn(StepPracticeController.prototype, 'start'), continuous = vi.spyOn(ContinuousPracticeController.prototype, 'start');
  await openPage(); expect(screen.getByRole('button', { name: practice.start })).toBeEnabled();
  expect(step).not.toHaveBeenCalled(); expect(continuous).not.toHaveBeenCalled(); expect(fake.continuous).not.toHaveBeenCalled(); expect(health.listenerCount()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: practice.start }));
  await waitFor(() => expect(screen.getByRole('button', { name: practice.finish })).toBeEnabled());
  expect(step).toHaveBeenCalledTimes(selected === 'STEP_BY_STEP' ? 1 : 0); expect(continuous).toHaveBeenCalledTimes(selected === 'CONTINUOUS_PLAY' ? 1 : 0);
  expect(health.listenerCount()).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: practice.finish }));
  await waitFor(() => expect(screen.getByRole('button', { name: practice.start })).toBeEnabled());
  expect(health.listenerCount()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: practice.start })); await waitFor(() => expect(selected === 'STEP_BY_STEP' ? step : continuous).toHaveBeenCalledTimes(2));
});
it.each(['STEP_BY_STEP', 'CONTINUOUS_PLAY'] as const)('%s locks scope/range/tempo after Start while metronome remains a live command', async selected => {
  mode = selected; await openPage(); fireEvent.click(screen.getByRole('button', { name: practice.start }));
  await waitFor(() => expect(health.listenerCount()).toBe(1));
  expect(screen.getByRole('button', { name: practice.rangeSelectionStart })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: practice.tempoButton }));
  expect(screen.getByRole('spinbutton', { name: 'BPM input' })).toBeDisabled();
  expect(fake.viewer.mock.calls.at(-1)![0].onRenderNoteClick).toBeUndefined();
});
it.each(['analysisIntervention', 'infrastructureIntervention'] as const)('STEP %s End uses current admission, with no independent Setup latch', async field => {
  const original = StepPracticeController.prototype.snapshot;
  vi.spyOn(StepPracticeController.prototype, 'snapshot').mockImplementation(function (this: StepPracticeController) {
    const snapshot = original.call(this);
    return { ...snapshot, ...(snapshot.state === 'ACTIVE' ? { [field]: { kind: field === 'analysisIntervention' ? 'TERMINAL_ANALYSIS_FAILURE' : 'TERMINAL_INFRASTRUCTURE_FAILURE' } } : {}) } as ReturnType<typeof original>;
  });
  await openPage(); fireEvent.click(screen.getByRole('button', { name: practice.start }));
  const dialog = await screen.findByRole('alertdialog'); fireEvent.click(dialog.querySelector('button')!);
  await waitFor(() => expect(screen.getByRole('button', { name: practice.start })).toBeEnabled());
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(fake.router.push).not.toHaveBeenCalled();
});
it.each(['score','revision','unpinned','configuration'] as const)('browser-known %s mismatch requires Setup without acquiring or querying', async kind => {
  if(kind==='score')fake.routeScoreId='other';if(kind==='revision')fake.revision='other';if(kind==='unpinned')fake.revision=null;if(kind==='configuration')fake.mismatchMode=true;
  await openPage();expect(screen.getByText(practice.setupRequired)).toBeVisible();
  expect(fake.leaseEnabled).toHaveBeenLastCalledWith(false);expect(fake.step).not.toHaveBeenCalled();expect(fake.continuous).not.toHaveBeenCalled();
  expect(fake.sourceRequest).not.toHaveBeenCalled();expect(fake.scoreRequest).not.toHaveBeenCalled();expect(fake.router.push).not.toHaveBeenCalled();
});
it('admitted Practice renders and starts from owned representations while Score and Bundle services are unavailable', async()=>{
  await openPage();expect(fake.viewer.mock.calls.at(-1)![0].xmlContent).toBe('<score />');
  fireEvent.click(screen.getByRole('button',{name:practice.start}));await waitFor(()=>expect(health.listenerCount()).toBe(1));
  expect(fake.sourceRequest).not.toHaveBeenCalled();expect(fake.scoreRequest).not.toHaveBeenCalled();
});
it('Setup navigation retains pinned revision and has no qualification/device side effects', async () => {
  await openPage(); fireEvent.click(screen.getByRole('button', { name: practice.practiceSetup }));
  expect(fake.router.push).toHaveBeenCalledWith('/score/score-id/practice/setup?practiceRevisionId=pinned-revision');
  expect(workspace.clearPreparedPractice).toHaveBeenCalledOnce(); expect(fake.step).not.toHaveBeenCalled();
});

it('STEP PREPARING exposes End and locks scope/tempo without accepting another Start', async () => {
  let release!: () => void;
  fake.step.mockReturnValueOnce({ clock: new ManualClock(), timer: { schedule: vi.fn(), cancel: vi.fn() },
    createMidi: () => ({ start: () => new Promise<void>(resolve => { release = resolve; }), refreshInputs: vi.fn(), dispose: vi.fn() }),
    createMetronomeAudio: () => metronomeAudioFixture() });
  await openPage(); fireEvent.click(screen.getByRole('button', { name: practice.start }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.getByRole('button', { name: practice.rangeSelectionStart })).toBeDisabled();
  expect(screen.getByRole('button', { name: practice.finish })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: practice.tempoButton })); expect(screen.getByRole('spinbutton', { name: 'BPM input' })).toBeDisabled();
  await act(async () => { release(); });
});

it.each([true, false])('natural STEP completion shows one dialog; Try Again with current admission=%s', async admitted => {
  const start = vi.spyOn(StepPracticeController.prototype, 'start'); const view = await openPage();
  fireEvent.click(screen.getByRole('button', { name: practice.start })); await waitFor(() => expect(health.listenerCount()).toBe(1));
  for (const _moment of artifact.moments) fireEvent.click(screen.getByRole('button', { name: practice.skip }));
  await screen.findByRole('dialog'); expect(start).toHaveBeenCalledOnce(); expect(health.listenerCount()).toBe(0);
  deviceReady = admitted;
  await act(async () => { view.rerender(pageTree()); });
  fireEvent.click(screen.getByRole('button', { name: practice.retryPractice }));
  await waitFor(() => admitted ? expect(start).toHaveBeenCalledTimes(2) : expect(screen.queryByRole('dialog')).toBeNull());
  if (!admitted) { expect(start).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: practice.start })).toBeDisabled(); }
  expect(fake.router.push).not.toHaveBeenCalled(); expect(fake.router.replace).not.toHaveBeenCalled();
});

it.each(['incomplete', 'environment'] as const)('%s admission stays in place without an execution owner', async condition => {
  if (condition === 'environment') ready = false; else fake[condition] = true;
  await openPage();
  expect(fake.router.replace).not.toHaveBeenCalled(); expect(fake.router.push).not.toHaveBeenCalled();
  expect(fake.step).not.toHaveBeenCalled(); expect(fake.continuous).not.toHaveBeenCalled();
  if (condition === 'incomplete' || condition === 'environment') expect(fake.leaseEnabled).toHaveBeenLastCalledWith(false);
  if (condition === 'incomplete' || condition === 'environment') expect(screen.getByText(practice.setupRequired)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: practice.practiceSetup }));
  expect(fake.router.push).toHaveBeenCalledExactlyOnceWith('/score/score-id/practice/setup?practiceRevisionId=pinned-revision');
});

it('an active attempt keeps its binding when acoustic infrastructure fails', async () => {
  const view = await openPage(); fireEvent.click(screen.getByRole('button', { name: practice.start }));
  await waitFor(() => expect(screen.getByRole('button', { name: practice.finish })).toBeEnabled());
  vi.spyOn(environment, 'acousticState').mockReturnValue('FAILED'); await act(async () => { view.rerender(pageTree()); });
  expect(screen.getByRole('button', { name: practice.finish })).toBeEnabled();
  expect(fake.router.replace).not.toHaveBeenCalled(); expect(fake.router.push).not.toHaveBeenCalled();
});

it('View Review explicitly hands the current completion to workspace without a Source read',async()=>{
  mode='CONTINUOUS_PLAY';const started=vi.spyOn(ContinuousPracticeController.prototype,'start');await openPage();
  fireEvent.click(screen.getByRole('button',{name:practice.start}));await waitFor(()=>expect(health.listenerCount()).toBe(1));
  act(()=>clock.advance(100000));const report=await screen.findByRole('button',{name:practice.viewSummary});
  const completion=(started.mock.contexts[0] as ContinuousPracticeController).snapshot().completed;expect(completion).not.toBeNull();
  expect(workspace.handoffToReview).not.toHaveBeenCalled();
  fireEvent.click(report);expect(workspace.handoffToReview).toHaveBeenCalledExactlyOnceWith(completion);
  expect(fake.router.push).toHaveBeenCalledWith('/score/score-id/practice/review');
  expect(fake.sourceRequest).not.toHaveBeenCalled();expect(fake.scoreRequest).not.toHaveBeenCalled();expect(workspace.clearPreparedPractice).not.toHaveBeenCalled();
});
