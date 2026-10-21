// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import artifactJson from '@/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeInputSource, PracticeMode, PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import { ManualClock } from '@/lib/practice/local-core/timebase';
import { StepPracticeController } from '@/lib/practice/step/step-practice-controller';
import { ContinuousPracticeController } from '@/lib/practice/continuous/continuous-practice-controller';
import * as stepPlatform from '@/lib/practice/step/step-platform';
import { useLocalPractice } from './use-local-practice';

afterEach(() => vi.restoreAllMocks());
const artifact = artifactJson as PracticeScoreArtifact;

function pendingMicrophone() {
  let releaseLoad!: () => void;
  const stop = vi.fn(), stream = { getTracks: () => [{ stop }] };
  const context = Object.assign(new EventTarget(), { state: 'running', sampleRate: 48000, currentTime: 0,
    close: vi.fn(async () => {}), resume: vi.fn(async () => {}) });
  const worker = { load: vi.fn(() => new Promise<void>(resolve => { releaseLoad = resolve; })),
    run: vi.fn(), dispose: vi.fn(async () => {}) };
  const connect = vi.fn(), midiStart = vi.fn(async () => {});
  const platform: stepPlatform.StepPlatform = { clock: new ManualClock(), timer: { schedule: vi.fn(), cancel: vi.fn() },
    createMidi: vi.fn(() => ({ start: midiStart, dispose: vi.fn(), getState: () => ({
      isSupported: true, isRunning: true, hasPermission: true, connectedInputCount: 1 }) })),
    createMetronome: () => ({ start: vi.fn(), destroy: vi.fn(), setEnabled: vi.fn(), setStepContext: vi.fn() }),
    microphone: { acquireMicrophone: vi.fn(async () => stream as unknown as MediaStream),
      createAudioContext: () => context as unknown as AudioContext, watchInfrastructure: () => () => {},
      modelUrl: async () => 'fake://pending-model', createWorker: () => worker, coefficients: vi.fn(),
      connectCapture: connect, workletUrl: 'fake://not-started' } };
  const factory = vi.spyOn(stepPlatform, 'browserStepPlatform').mockReturnValue(platform);
  const options = (mode: PracticeMode = 'STEP_BY_STEP', inputSource: PracticeInputSource = 'MICROPHONE') =>
    ({ artifact, mode, inputSource, scope: { kind: 'FULL' as const } });
  return { platform, factory, options, worker, stop, context, connect, midiStart, release: () => releaseLoad() };
}

it('STEP Start is single-owner during preparation; unmount awaits late preparation without connecting capture', async () => {
  const r = pendingMicrophone(), disposal = vi.spyOn(StepPracticeController.prototype, 'dispose');
  const { result, unmount } = renderHook(() => useLocalPractice(r.options()));
  let starting!: Promise<void>;
  await act(async () => { starting = result.current.start(); });
  expect(result.current).toMatchObject({ mode: 'STEP_BY_STEP', lifecycle: 'PREPARING', inputState: 'STARTING', inputError: null });
  await act(async () => { await result.current.start(); });
  expect(r.factory).toHaveBeenCalledOnce(); expect(r.worker.load).toHaveBeenCalledOnce();
  unmount(); expect(disposal).toHaveBeenCalledOnce();
  let released = false;
  const pending = disposal.mock.results[0].value.then(() => { released = true; });
  await Promise.resolve(); expect(released).toBe(false);
  await act(async () => { r.release(); await starting; await pending; });
  expect(r.connect).not.toHaveBeenCalled(); expect(r.worker.dispose).toHaveBeenCalledOnce();
  expect(r.stop).toHaveBeenCalledOnce(); expect(r.context.close).toHaveBeenCalledOnce();
});

it.each(['input', 'mode'] as const)('%s switch waits for the old STEP microphone graph before another owner starts', async switchKind => {
  const r = pendingMicrophone();
  const continuousStart = vi.spyOn(ContinuousPracticeController.prototype, 'start').mockResolvedValue();
  const { result, rerender, unmount } = renderHook(({ mode, inputSource }) => useLocalPractice(r.options(mode, inputSource)),
    { initialProps: { mode: 'STEP_BY_STEP' as PracticeMode, inputSource: 'MICROPHONE' as PracticeInputSource } });
  let oldStart!: Promise<void>;
  await act(async () => { oldStart = result.current.start(); });
  rerender(switchKind === 'input' ? { mode: 'STEP_BY_STEP', inputSource: 'MIDI' } : { mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE' });
  let newStart!: Promise<void>;
  await act(async () => { newStart = result.current.start(); });
  expect(r.midiStart).not.toHaveBeenCalled(); expect(continuousStart).not.toHaveBeenCalled();
  await act(async () => { r.release(); await oldStart; await newStart; });
  expect(r.worker.dispose).toHaveBeenCalledOnce(); expect(r.connect).not.toHaveBeenCalled();
  expect(r.stop).toHaveBeenCalledOnce(); expect(r.context.close).toHaveBeenCalledOnce();
  if (switchKind === 'input') { expect(r.midiStart).toHaveBeenCalledOnce(); expect(result.current.inputState).toBe('RUNNING'); }
  else expect(continuousStart).toHaveBeenCalledOnce();
  unmount();
});

it('restart waits for disposal, uses a fresh STEP identity and surfaces a fresh acquisition error without locking input', async () => {
  const r = pendingMicrophone(), starts = vi.spyOn(StepPracticeController.prototype, 'start');
  const { result, unmount } = renderHook(() => useLocalPractice(r.options()));
  let first!: Promise<void>, restarting!: Promise<void>;
  await act(async () => { first = result.current.start(); });
  const firstId = (starts.mock.contexts[0] as StepPracticeController).snapshot().sessionSnapshot!.localSessionId;
  vi.mocked(r.platform.microphone!.acquireMicrophone).mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
  await act(async () => { restarting = result.current.restart(); });
  expect(starts).toHaveBeenCalledOnce();
  await act(async () => { r.release(); await first; await restarting; });
  expect(starts).toHaveBeenCalledTimes(2); expect(starts.mock.contexts[1]).not.toBe(starts.mock.contexts[0]);
  expect((starts.mock.contexts[1] as StepPracticeController).snapshot().sessionSnapshot?.localSessionId).not.toBe(firstId);
  expect(result.current).toMatchObject({ lifecycle: 'IDLE', inputState: 'ERROR', inputError: 'STEP_MICROPHONE_PERMISSION_DENIED' });
  expect(r.worker.dispose).toHaveBeenCalledOnce();
  unmount();
});

it('switching from pending Continuous startup waits for both disposal and late preparation before STEP starts', async () => {
  const r = pendingMicrophone(); let release!: () => void;
  vi.spyOn(ContinuousPracticeController.prototype, 'start').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const disposed = vi.spyOn(ContinuousPracticeController.prototype, 'dispose');
  const { result, rerender, unmount } = renderHook(({ mode }) => useLocalPractice(r.options(mode, 'MIDI')),
    { initialProps: { mode: 'CONTINUOUS_PLAY' as PracticeMode } });
  let oldStart!: Promise<void>, stepStart!: Promise<void>;
  await act(async () => { oldStart = result.current.start(); });
  rerender({ mode: 'STEP_BY_STEP' });
  await act(async () => { stepStart = result.current.start(); });
  expect(disposed).toHaveBeenCalledOnce(); expect(r.midiStart).not.toHaveBeenCalled();
  await act(async () => { release(); await oldStart; await stepStart; });
  expect(r.midiStart).toHaveBeenCalledOnce(); expect(result.current.lifecycle).toBe('ACTIVE');
  unmount();
});
