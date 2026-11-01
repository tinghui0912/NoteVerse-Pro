import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { validateAcousticCapture } from './browser-acoustic-validation';
import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function microphone() {
  const stop = vi.fn();
  const stream = { getAudioTracks: () => [{ kind: 'audio', readyState: 'live', muted: false, stop }],
    getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}
it('acoustic validation uses the exact retained stream and releases only its temporary pipeline', async () => {
  const { stream, stop } = microphone(), close = vi.fn(async () => {}), captureStop = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal('AudioContext', class { state = 'running'; sampleRate = 48000; resume = async () => {}; close = close; });
  vi.spyOn(browserMicrophoneCapture, 'coefficients').mockResolvedValue(readFileSync('public/model-assets/practice-acoustic/fir-1-3.f32'));
  const capture = vi.spyOn(browserMicrophoneCapture, 'connectCapture').mockImplementation(async options => {
    options.bridge.receive({ type: 'pcm-chunk', samples: new Float32Array(2048), sequence: 0, sourceSampleRateHz: 48000,
      sourceStartSampleIndex: 0, sourceEndSampleIndex: 2048, audioContextStartFrame: 0, inputChannelCount: 1, captureTimeSeconds: 0 });
    return { stop: captureStop };
  });
  await validateAcousticCapture(stream, new AbortController().signal);
  expect(capture).toHaveBeenCalledOnce(); expect(capture.mock.calls[0][0].stream).toBe(stream);
  expect(stop).not.toHaveBeenCalled(); expect(captureStop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});
it('unsupported source rate closes the temporary context without stopping the retained microphone', async () => {
  const { stream, stop } = microphone(), close = vi.fn(async () => {});
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
  vi.stubGlobal('AudioContext', class { state = 'running'; sampleRate = 32000; resume = async () => {}; close = close; });
  await expect(validateAcousticCapture(stream, new AbortController().signal)).rejects.toMatchObject({ kind: 'ACOUSTIC', code: 'SOURCE_RATE_UNSUPPORTED' });
  expect(stop).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
