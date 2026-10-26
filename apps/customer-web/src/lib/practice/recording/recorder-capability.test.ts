import { afterEach, expect, it, vi } from 'vitest';
import { probeRecording, recordingOptions } from './recorder-capability';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function rig() {
  const instances: Recorder[] = [];
  class Recorder {
    static isTypeSupported = vi.fn((mime: string) => mime === 'video/webm');
    state = 'inactive';
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ondataavailable = null;
    start = vi.fn(() => { this.state = 'recording'; });
    stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); });
    constructor(readonly stream: MediaStream, readonly options?: MediaRecorderOptions) { instances.push(this); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const stream = { getAudioTracks: () => [{ readyState: 'live' }], getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream;
  return { instances, Recorder, stream };
}
it('probes real start/stop with the canonical video MIME and retains neither chunks nor listeners', async () => {
  const r = rig(); await probeRecording('VIDEO', r.stream);
  expect(r.instances).toHaveLength(1);
  expect(r.instances[0].options).toEqual(recordingOptions('VIDEO'));
  expect(r.instances[0].start).toHaveBeenCalledOnce(); expect(r.instances[0].stop).toHaveBeenCalledOnce();
  expect(r.instances[0]).toMatchObject({ state: 'inactive', onstop: null, onerror: null, ondataavailable: null });
});
it('audio uses the browser default MIME and rejects missing live audio before construction', async () => {
  const r = rig(); await probeRecording('AUDIO', r.stream); expect(r.instances[0].options).toBeUndefined();
  await expect(probeRecording('AUDIO', { ...r.stream, getAudioTracks: () => [] } as MediaStream)).rejects.toThrow('TRACKS_UNAVAILABLE');
  expect(r.instances).toHaveLength(1);
});
it('unsupported recording fails instead of substituting a different mode', async () => {
  const r = rig(); r.Recorder.isTypeSupported.mockReturnValue(false);
  await expect(probeRecording('VIDEO', r.stream)).rejects.toThrow('VIDEO_RECORDER_UNSUPPORTED');
  expect(r.instances).toHaveLength(0);
  vi.stubGlobal('MediaRecorder', undefined);
  expect(() => recordingOptions('AUDIO')).toThrow('MEDIA_RECORDER_UNSUPPORTED');
});
it('a stalled recorder is stopped and detached at the probe timeout', async () => {
  vi.useFakeTimers(); const r = rig();
  // Per-instance stop deliberately never delivers its completion event.
  const Native = r.Recorder;
  vi.stubGlobal('MediaRecorder', class extends Native {
    constructor(stream: MediaStream, options?: MediaRecorderOptions) { super(stream, options); this.stop = vi.fn(); }
  });
  const pending = probeRecording('AUDIO', r.stream);
  const rejected = expect(pending).rejects.toThrow('RECORDING_PROBE_TIMEOUT');
  await vi.advanceTimersByTimeAsync(5000); await rejected;
  expect(r.instances[0].onstop).toBeNull(); expect(r.instances[0].onerror).toBeNull();
  expect(r.instances[0].stop).toHaveBeenCalledTimes(2);
});
