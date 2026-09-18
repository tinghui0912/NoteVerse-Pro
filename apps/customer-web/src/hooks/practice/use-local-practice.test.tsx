// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import canonicalArtifactJson from '@/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import { useLocalPractice } from './use-local-practice';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

const micMock = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  onFatalError: null as ((err: Error) => void) | null,
}));

vi.mock('@/lib/practice/acoustic-inference/live-capture', () => {
  return {
    BrowserMicrophoneCaptureController: class MockMicController {
      constructor(options: { onFatalError?: (err: Error) => void }) {
        micMock.onFatalError = options.onFatalError ?? null;
      }
      async start() {
        return micMock.start();
      }
      async stop() {
        return micMock.stop();
      }
      snapshot() {
        return { state: 'running' };
      }
    },
  };
});

vi.mock('@/lib/practice/acoustic-inference/bytedance-contract', () => ({
  createProductionByteDanceManifest: vi.fn(() => ({})),
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
    micMock.start.mockReset().mockResolvedValue(undefined);
    micMock.stop.mockReset().mockResolvedValue(undefined);
    micMock.onFatalError = null;
  });

  it('initializes in READY lifecycle and IDLE inputState', () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MICROPHONE',
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
});
