// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import canonicalArtifactJson from '@/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import type { PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import { useLocalPractice } from './use-local-practice';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

const recorderEvents = vi.hoisted(() => ({
  events: [] as string[],
}));

const micMock = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {
    recorderEvents.events.push('INPUT_TEARDOWN');
  }),
  onFatalError: null as ((err: Error) => void) | null,
}));

const midiMock = vi.hoisted(() => ({
  connectedInputCount: 1,
  onStateChange: null as ((state: {
    isSupported: boolean;
    hasPermission: boolean | null;
    connectedInputCount: number;
    isRunning: boolean;
  }) => void) | null,
}));

vi.mock('@/lib/practice/audio-analysis/step/step-acoustic-session', () => {
  return {
    StepMicrophoneCaptureController: class MockMicController {
      constructor(options: {
        onFatalError?: (err: Error) => void;
      }) {
        micMock.onFatalError = options.onFatalError ?? null;
      }
      async start() {
        return micMock.start();
      }
      async stop() {
        return micMock.stop();
      }
      get mediaStream() {
        return {
          getAudioTracks: () => [{ kind: 'audio', readyState: 'live', addEventListener: vi.fn(), stop: vi.fn() }],
          getTracks: () => [{ kind: 'audio', readyState: 'live', addEventListener: vi.fn(), stop: vi.fn() }],
        };
      }
      snapshot() {
        return { state: 'running' };
      }
    },
  };
});

vi.mock('@/lib/practice/acoustic-inference/bytedance-contract', () => ({
  createByteDanceManifestFromAccess: vi.fn(() => ({})),
}));

vi.mock('@/lib/api', () => ({
  modelAssetsApi: {
    getByteDanceNoteModelAccess: vi.fn(async () => ({
      schemaVersion: 1,
      assetId: 'bytedance-piano-transcription-note-model',
      assetVersion: 'CRNN_note_F1_0.9677_pedal_F1_0.9186',
      expectedByteSize: 98_691_493,
      sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
      mediaType: 'application/octet-stream',
      downloadUrl: 'https://test-bucket/model.onnx',
      downloadUrlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })),
  },
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
      }) {
        midiMock.onStateChange = options?.onStateChange ?? null;
      }
      async start() {
        if (midiMock.connectedInputCount === 0) {
          midiMock.onStateChange?.(this.getState());
          throw new Error('NO_CONNECTED_INPUT');
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
  beforeEach(() => {
    vi.clearAllMocks();
    recorderEvents.events = [];
    micMock.start.mockReset().mockResolvedValue(undefined);
    micMock.stop.mockReset().mockImplementation(async () => {
      recorderEvents.events.push('INPUT_TEARDOWN');
    });
    micMock.onFatalError = null;
    midiMock.connectedInputCount = 1;
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

  it('initializes in READY lifecycle and IDLE inputState', () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MICROPHONE',
        scope: { kind: 'FULL' },
      })
    );

    expect(result.current.lifecycle).toBe('READY');
    expect(result.current.inputState).toBe('IDLE');
    expect(result.current.activeStepGroup).toBeNull();
    expect(result.current.performanceClock).toBeNull();
  });

  it('starts STEP practice and transitions to ACTIVE lifecycle and RUNNING inputState', async () => {
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

    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('RUNNING');
    expect(micMock.start).toHaveBeenCalledTimes(1);
    expect(result.current.activeStepGroup?.groupId).toBe(
      artifact.expectedPracticeGroups[0].groupId
    );
  });

  it('handles input start failure by keeping READY lifecycle and setting ERROR inputState', async () => {
    micMock.start.mockRejectedValueOnce(new Error('Microphone permission denied'));

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

    expect(result.current.lifecycle).toBe('READY');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('Microphone permission denied');
  });

  it('allows pause and resume, properly stopping and restarting input', async () => {
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
    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('RUNNING');

    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.lifecycle).toBe('PAUSED');
    expect(result.current.inputState).toBe('IDLE');
    expect(micMock.stop).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.lifecycle).toBe('ACTIVE');
    expect(result.current.inputState).toBe('RUNNING');
    expect(micMock.start).toHaveBeenCalledTimes(2);
  });

  it('handles fatal input error by transitioning to PAUSED and ERROR while preserving progress', async () => {
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
    expect(result.current.lifecycle).toBe('ACTIVE');

    act(() => {
      micMock.onFatalError?.(new Error('AudioContext crashed'));
    });

    expect(result.current.lifecycle).toBe('PAUSED');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('AudioContext crashed');
    expect(result.current.activeStepGroup?.groupId).toBe(
      artifact.expectedPracticeGroups[0].groupId
    );

    // Resuming retries input start
    await act(async () => {
      await result.current.resume();
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
        inputSource: 'MICROPHONE',
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
        inputSource: 'MICROPHONE',
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
        inputSource: 'MICROPHONE',
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

  it('records STEP paused MIDI disconnect as device error without a second domain transition', async () => {
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
      await result.current.pause();
    });

    expect(() => {
      act(() => {
        midiMock.connectedInputCount = 0;
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

  it('does not start legacy rolling microphone analysis for CONTINUOUS practice', async () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
        scope: { kind: 'FULL' },
      })
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.lifecycle).toBe('READY');
    expect(result.current.inputState).toBe('ERROR');
    expect(result.current.inputError).toBe('CONTINUOUS_ANALYSIS_UNAVAILABLE');
    expect(result.current.performanceEvaluation).toBeNull();
    expect(recorderEvents.events).toEqual([]);
    expect(completedPerformanceStore.getPerformance()).toBeNull();
  });
});
