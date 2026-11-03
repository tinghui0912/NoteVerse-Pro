import { memoryRecordingSinkFactory } from '@/lib/practice/__fixtures__/recording-sink';
import { afterEach, expect, it, vi } from 'vitest';
import { recordingProbeFixture } from '../__fixtures__/recording-probe';
import { probeRecording, recordingOptions } from './recorder-capability';
import { openOpfsRecordingSink } from './opfs-recording-sink';
import { opfsStoreFixture } from '../__fixtures__/opfs-store';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function rig() {
  const instances: Recorder[] = [];
  class Recorder {
    static isTypeSupported = vi.fn((mime: string) => mime === 'video/webm');
    state = 'inactive';
    mimeType: string;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ondataavailable = null;
    start = vi.fn(() => { this.state = 'recording'; });
    stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); });
    constructor(readonly stream: MediaStream, readonly options?: MediaRecorderOptions) { this.mimeType = options?.mimeType ?? 'audio/webm'; instances.push(this); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const stream = { getAudioTracks: () => [{ readyState: 'live' }], getVideoTracks: () => [{ readyState: 'live' }] } as unknown as MediaStream;
  return { instances, Recorder, stream };
}
it('probes real start/stop with the canonical video MIME and retains neither chunks nor listeners', async () => {
  const r = rig(); await probeRecording('VIDEO', r.stream, new AbortController().signal, memoryRecordingSinkFactory);
  expect(r.instances).toHaveLength(1);
  expect(r.instances[0].options).toEqual(recordingOptions('VIDEO'));
  expect(r.instances[0].start).toHaveBeenCalledOnce(); expect(r.instances[0].stop).toHaveBeenCalledOnce();
  expect(r.instances[0]).toMatchObject({ state: 'inactive', onstop: null, onerror: null, ondataavailable: null });
});
it('audio uses the browser default MIME and rejects missing live audio before construction', async () => {
  const r = rig(); await probeRecording('AUDIO', r.stream, new AbortController().signal, memoryRecordingSinkFactory); expect(r.instances[0].options).toBeUndefined();
  await expect(probeRecording('AUDIO', { ...r.stream, getAudioTracks: () => [] } as MediaStream, new AbortController().signal, memoryRecordingSinkFactory)).rejects.toThrow('TRACKS_UNAVAILABLE');
  expect(r.instances).toHaveLength(1);
});
it('unsupported recording fails instead of substituting a different mode', async () => {
  const r = rig(); r.Recorder.isTypeSupported.mockReturnValue(false);
  await expect(probeRecording('VIDEO', r.stream, new AbortController().signal, memoryRecordingSinkFactory)).rejects.toThrow('VIDEO_RECORDER_UNSUPPORTED');
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
  const pending = probeRecording('AUDIO', r.stream, new AbortController().signal, memoryRecordingSinkFactory);
  const rejected = expect(pending).rejects.toThrow('RECORDING_PROBE_TIMEOUT');
  await vi.advanceTimersByTimeAsync(5000); await rejected;
  expect(r.instances[0].onstop).toBeNull(); expect(r.instances[0].onerror).toBeNull();
  expect(r.instances[0].stop).toHaveBeenCalledTimes(2);
});

it('already-aborted preflight constructs no recorder or timeout',async()=>{
  vi.useFakeTimers();const r=rig(),controller=new AbortController();controller.abort();
  await expect(probeRecording('AUDIO',r.stream,controller.signal, memoryRecordingSinkFactory)).rejects.toBe(controller.signal.reason);
  expect(r.instances).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
});
it.each([false,true])('abort settles a stalled probe without advancing time, even when stop throws=%s',async throws=>{
  vi.useFakeTimers();const r=recordingProbeFixture(),root=r.root('audio'),controller=new AbortController();
  const detach=vi.spyOn(controller.signal,'removeEventListener');
  const pending=probeRecording('AUDIO',root.stream,controller.signal, memoryRecordingSinkFactory),recorder=r.instances[0];
  const lateStop=recorder.onstop!,lateError=recorder.onerror!;
  expect(vi.getTimerCount()).toBe(1);expect(recorder.state).toBe('recording');
  if(throws)recorder.stop.mockImplementationOnce(()=>{throw new Error('native stop failed');});
  const reason=new DOMException('preparation retired','AbortError');
  const rejected=expect(pending).rejects.toBe(reason);
  controller.abort(reason);await rejected;
  expect(vi.getTimerCount()).toBe(0);expect(recorder.stop).toHaveBeenCalledTimes(2);
  expect(detach).toHaveBeenCalledExactlyOnceWith('abort',expect.any(Function));
  expect(recorder).toMatchObject({onstop:null,onerror:null,ondataavailable:null});
  lateStop();lateError();expect(recorder.stop).toHaveBeenCalledTimes(2);
  expect(root.track.stop).not.toHaveBeenCalled();
});


it('prefers WebM when WebM and MP4 are supported, and admits an MP4-only browser', async () => {
  const r = rig(); r.Recorder.isTypeSupported.mockReturnValue(true);
  expect(recordingOptions('VIDEO')).toEqual({ mimeType: 'video/webm;codecs=vp9,opus' });
  r.Recorder.isTypeSupported.mockImplementation(mime => mime === 'video/mp4');
  expect(recordingOptions('VIDEO')).toEqual({ mimeType: 'video/mp4' });
  await probeRecording('VIDEO', r.stream, new AbortController().signal, memoryRecordingSinkFactory);
  expect(r.instances[0].mimeType).toBe('video/mp4');
});

it.each(['AUDIO', 'VIDEO'] as const)('rejects the actual unsupported %s recorder MIME during preflight', async mode => {
  const r = rig();
  vi.stubGlobal('MediaRecorder', class extends r.Recorder {
    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      super(stream, options); this.mimeType = mode === 'AUDIO' ? 'audio/unknown' : 'video/quicktime';
    }
  });
  await expect(probeRecording(mode, r.stream, new AbortController().signal, memoryRecordingSinkFactory)).rejects.toThrow('RECORDER_UNSUPPORTED');
  expect(r.instances[0]).toMatchObject({ state: 'inactive', onstop: null, onerror: null });
});

it.each(['AUDIO', 'VIDEO'] as const)('%s preflight writes, seals and removes its OPFS probe', async mode => {
  const r = rig(), f = opfsStoreFixture();
  await probeRecording(mode, r.stream, new AbortController().signal, signal => openOpfsRecordingSink(signal, f.platform));
  expect(f.write).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledOnce(); expect(f.files.size).toBe(0); expect(f.held.size).toBe(0);
});

it.each(['AUDIO', 'VIDEO'] as const)('%s storage probe fails preparation and cleans its file on write failure', async mode => {
  const r = rig(), f = opfsStoreFixture(); f.write.mockRejectedValueOnce(new Error('disk full'));
  await expect(probeRecording(mode, r.stream, new AbortController().signal,
    signal => openOpfsRecordingSink(signal, f.platform))).rejects.toThrow('RECORDING_STORAGE_FAILED');
  expect(f.files.size).toBe(0); expect(f.held.size).toBe(0);
});

it('OPFS-unavailable selected recording fails during preparation', async () => {
  const r = rig(); vi.stubGlobal('navigator', { storage: {} });
  await expect(probeRecording('AUDIO', r.stream, new AbortController().signal)).rejects.toThrow('RECORDING_STORAGE_UNAVAILABLE');
});

it('transaction abort cancels a pending storage probe and awaits file retirement', async () => {
  const r = rig(), f = opfsStoreFixture(), controller = new AbortController();
  let fail!: (error: Error) => void;
  f.write.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
  f.abort.mockImplementationOnce(async () => { fail(new DOMException('write aborted', 'AbortError')); });
  const pending = probeRecording('AUDIO', r.stream, controller.signal, signal => openOpfsRecordingSink(signal, f.platform));
  const reason = new DOMException('transaction retired', 'AbortError');
  const rejected = expect(pending).rejects.toBe(reason);
  await vi.waitFor(() => expect(f.write).toHaveBeenCalledOnce());
  controller.abort(reason); await rejected;
  expect(f.files.size).toBe(0); expect(f.held.size).toBe(0);
});
