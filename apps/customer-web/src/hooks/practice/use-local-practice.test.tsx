// @vitest-environment jsdom

import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import canonicalArtifactJson from '@/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import { completedPerformanceStore } from '@/lib/practice/completed-performance';
import type { PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import { noteAnnotationsFromPerformanceOutcomes } from '@/lib/practice/performance-annotation-controller';
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
  drainThrough: vi.fn(async (cutoff) => ({
    status: 'covered' as const,
    requestedThrough: cutoff,
    coverage: { intervals: [] },
  })),
  inferenceCoverageTime: vi.fn(() => null),
  onFatalError: null as ((err: Error) => void) | null,
  onPerformanceCoverage: null as null | ((coverage: {
    intervals: {
      startSampleIndex: number;
      endSampleIndex: number;
      startSessionTimeMs: number;
      endSessionTimeMs: number;
    }[];
  }) => void),
}));

vi.mock('@/lib/practice/acoustic-inference/live-capture', () => {
  return {
    BrowserMicrophoneCaptureController: class MockMicController {
      constructor(options: {
        onFatalError?: (err: Error) => void;
        evidenceSink?: {
          onPerformanceCoverage?: (coverage: {
            intervals: {
              startSampleIndex: number;
              endSampleIndex: number;
              startSessionTimeMs: number;
              endSessionTimeMs: number;
            }[];
          }) => void;
        };
      }) {
        micMock.onFatalError = options.onFatalError ?? null;
        micMock.onPerformanceCoverage = options.evidenceSink?.onPerformanceCoverage ?? null;
      }
      async start() {
        return micMock.start();
      }
      async stop() {
        return micMock.stop();
      }
      async drainThrough(cutoff: { domainId: string; ms: number; sampleIndex: number }) {
        return micMock.drainThrough(cutoff);
      }
      inferenceCoverageTime() {
        return micMock.inferenceCoverageTime();
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
      async start() {}
      stop() {}
      dispose() {}
      getState() {
        return { isRunning: true };
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
    micMock.drainThrough.mockReset().mockImplementation(async (cutoff) => ({
      status: 'covered' as const,
      requestedThrough: cutoff,
      coverage: { intervals: [] },
    }));
    micMock.inferenceCoverageTime.mockReset().mockReturnValue(null);
    micMock.onFatalError = null;
    micMock.onPerformanceCoverage = null;
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
        inputSource: 'MICROPHONE',
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

  it('serializes duplicate CONTINUOUS finish requests through one completion transaction', async () => {
    const drain = { resolve: null as null | (() => void) };
    micMock.drainThrough.mockImplementation(async (cutoff) => {
      recorderEvents.events.push('MIC_DRAIN_STARTED');
      await new Promise<void>((resolve) => {
        drain.resolve = resolve;
      });
      recorderEvents.events.push('MIC_DRAIN_COMPLETED');
      return {
        status: 'covered' as const,
        requestedThrough: cutoff,
        coverage: { intervals: [] },
      };
    });
    const onCompletion = vi.fn();
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
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
    await waitFor(() => {
      expect(result.current.isFinalizingPerformance).toBe(true);
    });
    expect(micMock.drainThrough).toHaveBeenCalledTimes(1);
    drain.resolve?.();
    await act(async () => {
      await first;
      await second;
    });

    expect(result.current.lifecycle).toBe('ENDED');
    expect(result.current.isFinalizingPerformance).toBe(false);
    expect(onCompletion).toHaveBeenCalledTimes(1);
    expect(micMock.drainThrough).toHaveBeenCalledTimes(1);
  });

  it('stops performance media before draining microphone inference', async () => {
    let nowMs = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const drain = { resolve: null as null | (() => void) };
    micMock.drainThrough.mockImplementation(async (cutoff) => {
      recorderEvents.events.push('MIC_DRAIN_STARTED');
      await new Promise<void>((resolve) => {
        drain.resolve = resolve;
      });
      recorderEvents.events.push('MIC_DRAIN_COMPLETED');
      return {
        status: 'covered' as const,
        requestedThrough: cutoff,
        coverage: { intervals: [] },
      };
    });
    const onCompletion = vi.fn();
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
        scope: { kind: 'FULL' },
        onCompletion,
      })
    );

    try {
      await act(async () => {
        await result.current.start();
      });

      nowMs = 3_000;
      await waitFor(() => {
        expect(result.current.performanceClock?.state).toBe('RUNNING');
      });

      let completion!: Promise<void>;
      act(() => {
        completion = result.current.finish();
      });
      await waitFor(() => {
        expect(result.current.isFinalizingPerformance).toBe(true);
      });
      expect(recorderEvents.events.slice(0, 2)).toEqual([
        'MEDIA_RECORDER_STOP_INVOKED',
        'MIC_DRAIN_STARTED',
      ]);

      drain.resolve?.();
      await act(async () => {
        await completion;
      });

      expect(onCompletion).toHaveBeenCalledTimes(1);
      expect(recorderEvents.events).toEqual([
        'MEDIA_RECORDER_STOP_INVOKED',
        'MIC_DRAIN_STARTED',
        'MIC_DRAIN_COMPLETED',
        'INPUT_TEARDOWN',
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('settles no-input microphone outcomes after default count-in coverage', async () => {
    let nowMs = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const onCompletion = vi.fn();
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
        scope: { kind: 'FULL' },
        onCompletion,
      })
    );

    try {
      await act(async () => {
        await result.current.start();
      });
      expect(result.current.performanceOutcomes).toHaveLength(artifact.expectedPracticeGroups.length);
      expect(
        result.current.performanceOutcomes[0]?.expectedStrikeOutcomes.map((strike) => strike.result)
      ).toEqual(['UNCONFIRMED']);

      nowMs = 1_800;
      await waitFor(() => {
        expect(result.current.performanceClock?.state).toBe('RUNNING');
      });

      act(() => {
        micMock.onPerformanceCoverage?.({
          intervals: [
            {
              startSampleIndex: 72_000,
              endSampleIndex: 86_400,
              startSessionTimeMs: 1_500,
              endSessionTimeMs: 1_800,
            },
          ],
        });
      });

      expect(
        result.current.performanceOutcomes[0]?.expectedStrikeOutcomes.map((strike) => strike.result)
      ).toEqual(['MISSING']);
      expect(
        noteAnnotationsFromPerformanceOutcomes(result.current.performanceOutcomes).confirmedErrorNoteIds
      ).toEqual(expect.arrayContaining(artifact.expectedPracticeGroups[0].renderNoteIds));

      await act(async () => {
        await result.current.finish();
      });
      expect(onCompletion).toHaveBeenCalledTimes(1);
      expect(completedPerformanceStore.getPerformance()?.evaluation.outcomes).toHaveLength(
        artifact.expectedPracticeGroups.length
      );
    } finally {
      nowSpy.mockRestore();
    }
  });
});
