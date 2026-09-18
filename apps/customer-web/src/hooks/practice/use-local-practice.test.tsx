// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import canonicalArtifactJson from '@/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import { useLocalPractice } from './use-local-practice';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

// Mock the microphone capture controller with a proper class
vi.mock('@/lib/practice/acoustic-inference/live-capture', () => {
  return {
    BrowserMicrophoneCaptureController: class MockMicController {
      async start() {}
      async stop() {}
      snapshot() {
        return { state: 'running' };
      }
    },
  };
});

// Mock the MIDI controller with a proper class
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
  });

  it('initializes in idle state', () => {
    const { result } = renderHook(() =>
      useLocalPractice({
        artifact,
        mode: 'STEP_BY_STEP',
        inputSource: 'MICROPHONE',
      })
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.activeStepGroup).toBeNull();
    expect(result.current.performanceClock).toBeNull();
  });

  it('starts STEP practice and sets first active target group', async () => {
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

    expect(result.current.status).toBe('listening');
    expect(result.current.activeStepGroup?.groupId).toBe(
      artifact.expectedPracticeGroups[0].groupId
    );
  });

  it('allows pause and resume in STEP mode', async () => {
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
    expect(result.current.status).toBe('listening');

    act(() => {
      result.current.pause();
    });
    expect(result.current.status).toBe('paused');

    act(() => {
      result.current.resume();
    });
    expect(result.current.status).toBe('listening');
  });

  it('finishes on user request', async () => {
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

    expect(result.current.status).toBe('finished');
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
});
