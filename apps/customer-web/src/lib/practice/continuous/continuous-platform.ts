import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';
import { BrowserMidiController } from '@/lib/practice/midi/browser-midi-controller';
import { PerformanceRecorder } from '@/lib/practice/recording/performance-recorder';
import { MetronomeController } from '@/lib/practice/metronome/metronome-controller';
import type { ContinuousPlatform } from './continuous-input';

export function browserContinuousPlatform(acquireInference: ContinuousPlatform['acquireInference'] = async () => { throw new Error('PRACTICE_ENVIRONMENT_NOT_READY'); }): ContinuousPlatform { return {
  midiClock: { nowMs: () => performance.now() },
  acquireInference,
  acquireMicrophone: () => navigator.mediaDevices.getUserMedia({ video: false,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
  createAudioContext: () => new AudioContext(),
  ...browserMicrophoneCapture,
  createMidi: options => new BrowserMidiController(options),
  createRecorder: mode => new PerformanceRecorder(mode),
  createMetronome: options => new MetronomeController(options),
}; }
