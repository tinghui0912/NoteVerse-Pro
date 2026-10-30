import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { probePracticeRequirements } from './browser-readiness-probes';
import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function microphone() {
  const stop = vi.fn();
  const stream = { getAudioTracks: () => [{ kind: 'audio', readyState: 'live', muted: false, stop }],
    getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}
it('acoustic readiness validates real FIR and capture attachment then releases every test resource', async () => {
  const { stream, stop } = microphone(), close = vi.fn(async () => {}), captureStop = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal('AudioContext', class { state = 'running'; sampleRate = 48000; resume = async () => {}; close = close; });
  vi.spyOn(browserMicrophoneCapture, 'coefficients').mockResolvedValue(readFileSync('public/model-assets/practice-acoustic/fir-1-3.f32'));
  const capture = vi.spyOn(browserMicrophoneCapture, 'connectCapture').mockImplementation(async options => {
    options.bridge.receive({ type: 'pcm-chunk', samples: new Float32Array(2048), sequence: 0, sourceSampleRateHz: 48000,
      sourceStartSampleIndex: 0, sourceEndSampleIndex: 2048, audioContextStartFrame: 0, inputChannelCount: 1, captureTimeSeconds: 0 });
    return { stop: captureStop };
  });
  const ready = vi.fn(); await probePracticeRequirements(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }).qualification, ready, new AbortController().signal);
  expect(capture).toHaveBeenCalledOnce(); expect(ready.mock.calls.flat()).toEqual(['browserAudio', 'microphone']);
  expect(stop).toHaveBeenCalledOnce(); expect(captureStop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});
it('unsupported source rate fails closed and still releases the microphone and context', async () => {
  const { stream, stop } = microphone(), close = vi.fn(async () => {});
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
  vi.stubGlobal('AudioContext', class { state = 'running'; sampleRate = 32000; resume = async () => {}; close = close; });
  await expect(probePracticeRequirements(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }).qualification, vi.fn(), new AbortController().signal)).rejects.toMatchObject({ kind: 'ACOUSTIC', code: 'SOURCE_RATE_UNSUPPORTED' });
  expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});
it('MIDI needs real access and a connected input, without touching microphone capture', async () => {
  const acquire = vi.fn(), midi = vi.fn(async () => ({ inputs: new Map() }));
  vi.stubGlobal('navigator', { requestMIDIAccess: midi, mediaDevices: { getUserMedia: acquire } });
  await expect(probePracticeRequirements(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }).qualification, vi.fn(), new AbortController().signal)).rejects.toThrow('NO_CONNECTED_INPUT');
  expect(midi).toHaveBeenCalledWith({ sysex: false }); expect(acquire).not.toHaveBeenCalled();
});
