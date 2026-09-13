// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePracticeRecording } from './use-practice-recording';
import { createPerformanceReplayTimebase } from '@/lib/practice/performance-replay';

type PracticeRecordingApi = ReturnType<typeof usePracticeRecording>;

let latestApi: PracticeRecordingApi | null = null;

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];

  state: RecordingState = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  startTimeslice: number | undefined;
  requestDataCallCount = 0;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number) {
    this.startTimeslice = timeslice;
    this.state = 'recording';
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) } as BlobEvent);
  }

  completeStop() {
    this.onstop?.();
  }

  requestData() {
    this.requestDataCallCount += 1;
  }
}

function PracticeRecordingHarness({ onApi }: { onApi: (api: PracticeRecordingApi) => void }) {
  const api = usePracticeRecording();
  useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

describe('usePracticeRecording', () => {
  afterEach(() => {
    cleanup();
    latestApi = null;
    FakeMediaRecorder.instances = [];
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'MediaRecorder');
  });

  it('records local replay duration as active time excluding paused wall time', async () => {
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);

    render(
      <PracticeRecordingHarness
        onApi={(api) => {
          latestApi = api;
        }}
      />
    );

    act(() => {
      latestApi?.attach({} as MediaStream);
      latestApi?.start(createPerformanceReplayTimebase(0.5));
    });

    expect(FakeMediaRecorder.instances[0]?.startTimeslice).toBe(250);
    expect(latestApi?.finalizationStatus).toBe('recording');

    nowSpy.mockReturnValue(1_400);
    act(() => {
      latestApi?.pause();
    });

    nowSpy.mockReturnValue(9_000);
    act(() => {
      latestApi?.resume();
    });

    nowSpy.mockReturnValue(9_250);
    act(() => {
      latestApi?.stop();
    });

    expect(latestApi?.finalizationStatus).toBe('finalizing');
    expect(FakeMediaRecorder.instances[0]?.requestDataCallCount).toBe(1);

    act(() => {
      FakeMediaRecorder.instances[0]?.completeStop();
    });

    await waitFor(() => {
      expect(latestApi?.finalizationStatus).toBe('ready');
      expect(latestApi?.audioReplay).toMatchObject({
        kind: 'AUDIO_RECORDING',
        contentType: 'audio/webm',
        byteSize: 5,
        durationMs: 650,
        timebase: {
          version: 1,
          speedRatio: 0.5,
        },
      });
    });
  });

  it('keeps failed finalization terminal after recorder errors', async () => {
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });

    render(
      <PracticeRecordingHarness
        onApi={(api) => {
          latestApi = api;
        }}
      />
    );

    act(() => {
      latestApi?.attach({} as MediaStream);
      latestApi?.start();
      FakeMediaRecorder.instances[0]?.onerror?.();
      latestApi?.stop();
      FakeMediaRecorder.instances[0]?.completeStop();
    });

    await waitFor(() => {
      expect(latestApi?.finalizationStatus).toBe('failed');
      expect(latestApi?.audioReplay).toBeNull();
    });
  });
});
