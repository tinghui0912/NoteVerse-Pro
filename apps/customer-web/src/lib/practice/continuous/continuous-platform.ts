import { getPracticeAcousticModelAccess } from '../../api/practice-acoustic-model-asset';
import { createAcousticModelWorker } from '@/lib/practice/acoustic/model/worker-client';
import { BrowserAcousticCapture } from '@/lib/practice/acoustic/source/capture';
import { BrowserMidiController } from '@/lib/practice/midi/browser-midi-controller';
import { PerformanceRecorder } from '@/lib/practice/recording/performance-recorder';
import { MetronomeController } from '@/lib/practice/metronome/metronome-controller';
import type { ContinuousPlatform } from './continuous-input';

export const browserContinuousPlatform: ContinuousPlatform = {
  midiClock: { nowMs: () => performance.now() },
  modelUrl: async signal => (await getPracticeAcousticModelAccess(signal)).downloadUrl,
  createWorker: createAcousticModelWorker,
  acquireMicrophone: () => navigator.mediaDevices.getUserMedia({ video: false,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
  createAudioContext: () => new AudioContext(),
  workletUrl: new URL('../acoustic/source/capture.worklet.js', import.meta.url).toString(),
  async coefficients(rate) {
    const file = rate === 44100 ? 'fir-160-441.f32' : rate === 48000 ? 'fir-1-3.f32' : null;
    if (!file) throw new Error('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
    const response = await fetch(`/model-assets/practice-acoustic/${file}`);
    if (!response.ok) throw new Error('FIR_ASSET_UNAVAILABLE');
    return new Uint8Array(await response.arrayBuffer());
  },
  connectCapture: options => BrowserAcousticCapture.connect(options),
  createMidi: options => new BrowserMidiController(options),
  createRecorder: mode => new PerformanceRecorder(mode),
  createMetronome: options => new MetronomeController(options),
};
