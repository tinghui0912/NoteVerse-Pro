// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import canonicalArtifactJson from '@/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import type { PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import { ContinuousPracticeController, type ContinuousControllerSnapshot } from '@/lib/practice/continuous/continuous-practice-controller';
import { browserContinuousPlatform } from '@/lib/practice/continuous/continuous-platform';
import { useLocalPractice } from './use-local-practice';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

const recorderEvents = vi.hoisted(() => ({
  events: [] as string[],
}));

const midiMock = vi.hoisted(() => ({
  connectedInputCount: 1,
  emitCapturedAttackDuringStart: false,
  onStateChange: null as ((state: {
    isSupported: boolean;
    hasPermission: boolean | null;
    connectedInputCount: number;
    isRunning: boolean;
  }) => void) | null,
}));

vi.mock('@/lib/practice/midi/browser-midi-controller', () => {
  return {
    BrowserMidiController: class MockMidiController {
      constructor(options?: {
        onStateChange?: (state: {
          isSupported: boolean;
          hasPermission: boolean | null;
          connectedInputCount: number;
          isRunning: boolean;
        }) => void;
        onCapturedAttack?: (attack: {
          captureTime: { domainId: string; ms: number };
          pitch: string;
          confidence: number;
          source: 'MIDI';
        }) => void;
        timebase?: {
          domainId: string;
          runtimeToSessionTime: (runtimeMs: number) => { domainId: string; ms: number };
        };
      }) {
        midiMock.onStateChange = options?.onStateChange ?? null;
        this.options = options ?? {};
      }
      private readonly options: {
        onCapturedAttack?: (attack: {
          captureTime: { domainId: string; ms: number };
          pitch: string;
          confidence: number;
          source: 'MIDI';
        }) => void;
        timebase?: {
          domainId: string;
          runtimeToSessionTime: (runtimeMs: number) => { domainId: string; ms: number };
        };
      };
      async start() {
        if (midiMock.connectedInputCount === 0) {
          midiMock.onStateChange?.(this.getState());
          throw new Error('NO_CONNECTED_INPUT');
        }
        if (midiMock.emitCapturedAttackDuringStart && this.options.timebase) {
          this.options.onCapturedAttack?.({
            captureTime: this.options.timebase.runtimeToSessionTime(0),
            pitch: 'C4',
            confidence: 1,
            source: 'MIDI',
          });
        }
        midiMock.onStateChange?.(this.getState());
      }
      stop() {}
      dispose() {}
      getState() {
        return {
          isSupported: true,
          hasPermission: true,
          connectedInputCount: midiMock.connectedInputCount,
          isRunning: true,
        };
      }
    },
  };
});

describe('useLocalPractice', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.clearAllMocks();
    recorderEvents.events = [];
    midiMock.connectedInputCount = 1;
    midiMock.emitCapturedAttackDuringStart = false;
    midiMock.onStateChange = null;
    completedPerformanceStore.clearPerformance();
    class MockMediaRecorder {
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {}

      start() {
        this.state = 'recording';
      }

      requestData() {
        this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
      }

      stop() {
        recorderEvents.events.push('MEDIA_RECORDER_STOP_INVOKED');
        this.state = 'inactive';
        this.onstop?.();
      }

      pause() {
        this.state = 'paused';
      }

      resume() {
        this.state = 'recording';
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
  });

  it('initializes in IDLE session lifecycle without attempt readiness', () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MICROPHONE',
        scope: { kind: 'FULL' },
      })
    );

    expect(result.current.lifecycle).toBe('IDLE');
    expect(result.current.applicationState).toBe('IDLE');
    expect(result.current.runtimeStatus).toBeNull();
    expect(result.current.canAcceptAttempt).toBe(false);
    expect(result.current.stepInteractionPhase).toBeNull();
    expect(result.current.inputState).toBe('IDLE');
    expect(result.current.activeStepGroup).toBeNull();
    expect(result.current.performanceClock).toBeNull();
  });

  it('starts STEP practice and transitions to ACTIVE lifecycle and RUNNING inputState', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.applicationState).toBe('ACTIVE');
    expect(result.current.runtimeStatus).toBe('ACTIVE');
    expect(result.current.canAcceptAttempt).toBe(true);
    expect(result.current.stepInteractionPhase).toBe('READY');
    expect(result.current.inputState).toBe('RUNNING');
    expect(result.current.activeStepGroup?.groupId).toBe(
      artifact.expectedPracticeGroups[0].groupId
    );
  });

  it('starts STEP with a current group without sending target knowledge to MIDI', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.activeStepGroup?.groupId).toBe(artifact.expectedPracticeGroups[0].groupId);
  });

  it('reaches STEP microphone acquisition and reports an unavailable device rather than a product gate', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MICROPHONE',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('IDLE');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('STEP_MICROPHONE_UNAVAILABLE');
  });

  it('handles MIDI input start failure by keeping IDLE lifecycle and setting ERROR inputState', async () => {
    midiMock.connectedInputCount = 0;

    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('IDLE');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('NO_CONNECTED_INPUT');
  });

  it('STEP exposes waiting commands, never transport commands', () => {
    const { result } = renderHook(() => useLocalPractice({ artifact, mode: 'STEP_BY_STEP', inputSource: 'MIDI', scope: { kind: 'FULL' } }));
    expect(result.current).not.toHaveProperty('pause');
    expect(result.current).not.toHaveProperty('resume');
    expect(result.current.mode).toBe('STEP_BY_STEP');
  });

  it('handles MIDI disconnect by remaining ACTIVE and ERROR while preserving progress', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.lifecycle).toBe('ACTIVE');

    act(() => {
      midiMock.connectedInputCount = 0;
      midiMock.onStateChange?.({
        isSupported: true,
        hasPermission: true,
        connectedInputCount: 0,
        isRunning: true,
      });
    });

    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('NO_CONNECTED_INPUT');
    expect(result.current.activeStepGroup?.groupId).toBe(
      artifact.expectedPracticeGroups[0].groupId
    );

    midiMock.connectedInputCount = 1;
    await act(async () => {
      midiMock.onStateChange?.({ isSupported: true, hasPermission: true, connectedInputCount: 1, isRunning: true });
    });
    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('RUNNING');
    expect(result.current.inputError).toBeNull();
  });

  it('finishes on user request and transitions to ENDED', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.finish();
    });

    expect(result.current.lifecycle).toBe('ENDED');
    expect(result.current.completionReason).toBe('STOPPED_BY_USER');
  });

  it('skips steps and updates current group', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    const firstGroup = result.current.activeStepGroup;
    expect(firstGroup?.groupId).toBe(artifact.expectedPracticeGroups[0].groupId);

    act(() => {
      result.current.skip();
    });

    const secondGroup = result.current.activeStepGroup;
    expect(secondGroup?.groupId).toBe(artifact.expectedPracticeGroups[1].groupId);
  });

  it('restarts a fresh session after completion', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.finish();
    });
    expect(result.current.lifecycle).toBe('ENDED');

    await act(async () => {
      await result.current.restart();
    });
    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('RUNNING');
    expect(result.current.activeStepGroup?.groupId).toBe(
      artifact.expectedPracticeGroups[0].groupId
    );
  });

  it('starts CONTINUOUS practice with custom tempo and exposes resolvedTempoPlan', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
        tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 },
        metronomeEnabled: true,
      })
    );

    expect(result.current.resolvedTempoPlan).toEqual({
      selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 },
      segments: [{ startBeat: 0, bpm: 100, source: 'CUSTOM' }],
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('RUNNING');
    expect(result.current.performanceClock?.state).toBe('COUNT_IN');

    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.lifecycle).toBe('PAUSED');

    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.lifecycle).toBe('ACTIVE');

    await act(async () => {
      await result.current.finish();
    });
    expect(result.current.lifecycle).toBe('ENDED');
  });

  it('creates Continuous runtime before MIDI start without accepting pre-performance NOTE_ON evidence', async () => {
    midiMock.emitCapturedAttackDuringStart = true;
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
        tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.performanceEvaluation?.groups.every((group) => group.verdict === 'PENDING')).toBe(true);
  });

  it('keeps MIDI continuous recording OFF from requesting microphone media', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new Error('getUserMedia should not be called');
    });
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
        recordingMode: 'OFF',
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.finish();
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(completedPerformanceStore.getPerformance()?.media.status).toBe('NOT_RECORDED');
    expect(recorderEvents.events).not.toContain('MEDIA_RECORDER_STOP_INVOKED');
  });

  it('pauses continuous MIDI when every input disconnects and waits for explicit resume', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('ACTIVE');

    act(() => {
      midiMock.connectedInputCount = 0;
      midiMock.onStateChange?.({
        isSupported: true,
        hasPermission: true,
        connectedInputCount: 0,
        isRunning: true,
      });
    });

    expect(result.current.lifecycle).toBe('PAUSED');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('NO_CONNECTED_INPUT');

    act(() => {
      midiMock.connectedInputCount = 1;
      midiMock.onStateChange?.({
        isSupported: true,
        hasPermission: true,
        connectedInputCount: 1,
        isRunning: true,
      });
    });

    expect(result.current.lifecycle).toBe('PAUSED');
    expect(result.current.inputState).toBe('IDLE');

    await act(async () => {
      await result.current.resume();
    });

    expect(result.current.lifecycle).toBe('ACTIVE');
  });

  it('does not double-pause continuous MIDI when already paused before disconnect', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.pause();
    });

    expect(result.current.lifecycle).toBe('PAUSED');

    expect(() => {
      act(() => {
        midiMock.connectedInputCount = 0;
        midiMock.onStateChange?.({
          isSupported: true,
          hasPermission: true,
          connectedInputCount: 0,
          isRunning: true,
        });
        midiMock.onStateChange?.({
          isSupported: true,
          hasPermission: true,
          connectedInputCount: 0,
          isRunning: true,
        });
      });
    }).not.toThrow();

    expect(result.current.lifecycle).toBe('PAUSED');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('NO_CONNECTED_INPUT');
  });

  it('keeps continuous MIDI paused after reconnect until explicit resume', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.pause();
    });

    act(() => {
      midiMock.connectedInputCount = 0;
      midiMock.onStateChange?.({
        isSupported: true,
        hasPermission: true,
        connectedInputCount: 0,
        isRunning: true,
      });
    });

    act(() => {
      midiMock.connectedInputCount = 1;
      midiMock.onStateChange?.({
        isSupported: true,
        hasPermission: true,
        connectedInputCount: 1,
        isRunning: true,
      });
    });

    expect(result.current.lifecycle).toBe('PAUSED');
    expect(result.current.inputState).toBe('IDLE');

    await act(async () => {
      await result.current.resume();
    });

    expect(result.current.lifecycle).toBe('ACTIVE');
  });

  it('serializes duplicate CONTINUOUS finish requests through one completion transaction', async () => {
    const onCompletion = vi.fn();
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        scope: { kind: 'FULL' },
        onCompletion,
      })
    );

    await act(async () => {
      await result.current.start();
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.finish();
      second = result.current.finish();
    });
    await act(async () => {
      await first;
      await second;
    });

    expect(result.current.lifecycle).toBe('ENDED');
    expect(result.current.isFinalizingPerformance).toBe(false);
    expect(onCompletion).toHaveBeenCalledTimes(1);
  });

  it('delegates microphone Start to the Continuous owner and reflects its lifecycle without fabricated evidence', async () => {
    let snapshot: ContinuousControllerSnapshot = { session: 'PREPARING', transport: null, analysis: 'PREPARING',
      analysisError: null, inputError: null, recording: null, evaluation: null, completed: null, sessionSnapshot: null };
    const listeners = new Set<() => void>();
    const unsubscribe = vi.fn(() => listeners.clear());
    vi.spyOn(ContinuousPracticeController.prototype, 'subscribe').mockImplementation(listener => { listeners.add(listener); return unsubscribe; });
    vi.spyOn(ContinuousPracticeController.prototype, 'snapshot').mockImplementation(() => snapshot);
    const start = vi.spyOn(ContinuousPracticeController.prototype, 'start').mockResolvedValue();
    const dispose = vi.spyOn(ContinuousPracticeController.prototype, 'dispose').mockResolvedValue();
    const { result, unmount } = renderHook(() => useLocalPractice({ artifact, mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', scope: { kind: 'FULL' } }));
    await act(async () => { await result.current.start(); });
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.contexts[0]).toBeInstanceOf(ContinuousPracticeController);
    expect(result.current.inputState).toBe('STARTING');
    expect(result.current.inputError).toBeNull();
    act(() => {
      snapshot = { ...snapshot, session: 'ACTIVE', analysis: 'RUNNING', transport: {
        state: 'RUNNING', nowMs: 0, musicalBeat: 0, performanceTimeMs: 0, countInTotalMs: 0, countInRemainingMs: 0,
        countInBeats: 0, countInPulses: 0, countInPulse: 0, scopeCompleted: false, scopeStartBeat: 0,
        scopeTerminalBeat: artifact.scoreEndBeat, completionReason: null,
      } };
      listeners.forEach(listener => listener());
    });
    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('RUNNING');
    expect(result.current.performanceEvaluation).toBeNull();
    expect(completedPerformanceStore.getPerformance()).toBeNull();
    act(() => {
      snapshot = { ...snapshot, analysis: 'PAUSED', transport: { ...snapshot.transport!, state: 'PAUSED' } };
      listeners.forEach(listener => listener());
    });
    expect(result.current.lifecycle).toBe('PAUSED');
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  for (const failure of ['model-load', 'microphone-permission'] as const) {
    it(`surfaces real Continuous controller ${failure} failure and releases its worker once`, async () => {
      const worker = { load: vi.fn(async () => ({})), run: vi.fn(async () => { throw new Error('UNEXPECTED_INFERENCE'); }),
        dispose: vi.fn(async () => {}), onFailure: vi.fn(() => () => {}) };
      vi.spyOn(browserContinuousPlatform, 'modelUrl').mockResolvedValue('/test-model');
      vi.spyOn(browserContinuousPlatform, 'createWorker').mockReturnValue(worker);
      const acquire = vi.spyOn(browserContinuousPlatform, 'acquireMicrophone');
      if (failure === 'model-load') worker.load.mockRejectedValueOnce(new Error('MODEL_LOAD_FAILED'));
      else acquire.mockRejectedValueOnce(new DOMException('Test permission denial', 'NotAllowedError'));
      const start = vi.spyOn(ContinuousPracticeController.prototype, 'start');
      const dispose = vi.spyOn(ContinuousPracticeController.prototype, 'dispose');
      const { result, unmount } = renderHook(() => useLocalPractice({ artifact, mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', scope: { kind: 'FULL' } }));
      await act(async () => { await result.current.start(); });
      expect(start).toHaveBeenCalledOnce();
      expect(worker.load).toHaveBeenCalledWith('/test-model');
      expect(result.current.lifecycle).toBe('ENDED');
      expect(result.current.inputState).toBe('ERROR');
      expect(result.current.inputError).toBe(failure === 'model-load' ? 'MODEL_LOAD_FAILED' : 'MICROPHONE_PERMISSION_DENIED');
      expect(result.current.inputError).not.toBe('CONTINUOUS_ANALYSIS_UNAVAILABLE');
      if (failure === 'model-load') expect(acquire).not.toHaveBeenCalled();
      else expect(acquire).toHaveBeenCalledOnce();
      expect(worker.run).not.toHaveBeenCalled();
      expect(worker.dispose).toHaveBeenCalledOnce();
      unmount();
      await act(async () => {});
      expect(dispose).toHaveBeenCalledOnce();
      expect(worker.dispose).toHaveBeenCalledOnce();
      expect(completedPerformanceStore.getPerformance()).toBeNull();
    });
  }

  it('disposes a pending microphone preparation on unmount without starting capture after it settles', async () => {
    let settleLoad!: () => void;
    const worker = { load: vi.fn(() => new Promise<void>(resolve => { settleLoad = resolve; })),
      run: vi.fn(async () => { throw new Error('UNEXPECTED_INFERENCE'); }), dispose: vi.fn(async () => {}), onFailure: vi.fn(() => () => {}) };
    vi.spyOn(browserContinuousPlatform, 'modelUrl').mockResolvedValue('/test-model');
    vi.spyOn(browserContinuousPlatform, 'createWorker').mockReturnValue(worker);
    const acquire = vi.spyOn(browserContinuousPlatform, 'acquireMicrophone');
    const dispose = vi.spyOn(ContinuousPracticeController.prototype, 'dispose');
    const { result, unmount } = renderHook(() => useLocalPractice({ artifact, mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', scope: { kind: 'FULL' } }));
    let started!: Promise<void>;
    await act(async () => { started = result.current.start(); });
    expect(result.current.inputState).toBe('STARTING');
    expect(result.current.inputError).toBeNull();
    expect(worker.load).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { settleLoad(); await started; });
    expect(dispose).toHaveBeenCalledOnce();
    expect(worker.dispose).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
    expect(worker.run).not.toHaveBeenCalled();
  });
});
