import { getContinuousModelAccess } from '../../api/continuous-model-asset';
import { createContinuousAcousticWorker } from '../acoustic-inference/continuous/worker-client';
import { ContinuousAcousticCapture } from '../acoustic-inference/continuous/capture';
import { BrowserMidiController } from '../midi/browser-midi-controller';
import { PerformanceRecorder } from '../performance-recorder';
import { MetronomeController } from '../metronome/metronome-controller';
import type { ContinuousPlatform } from './continuous-input';

export const browserContinuousPlatform: ContinuousPlatform = {
  midiClock: { nowMs: () => performance.now() },
  modelUrl: async signal => (await getContinuousModelAccess(signal)).downloadUrl,
  createWorker: createContinuousAcousticWorker,
  acquireMicrophone: () => navigator.mediaDevices.getUserMedia({ video: false,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
  createAudioContext: () => new AudioContext(),
  workletUrl: new URL('../acoustic-inference/continuous/capture.worklet.js', import.meta.url).toString(),
  async coefficients(rate) {
    const file = rate === 44100 ? 'fir-160-441.f32' : rate === 48000 ? 'fir-1-3.f32' : null;
    if (!file) throw new Error('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
    const response = await fetch(`/model-assets/continuous/${file}`);
    if (!response.ok) throw new Error('FIR_ASSET_UNAVAILABLE');
    return new Uint8Array(await response.arrayBuffer());
  },
  connectCapture: options => ContinuousAcousticCapture.connect(options),
  createMidi: options => new BrowserMidiController(options),
  createRecorder: mode => new PerformanceRecorder(mode),
  createMetronome: options => new MetronomeController(options),
};
