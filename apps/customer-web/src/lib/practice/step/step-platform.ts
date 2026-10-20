import { BrowserMidiController, type BrowserMidiControllerOptions } from '../midi/browser-midi-controller';
import { MetronomeController, type MetronomeControllerOptions } from '../metronome/metronome-controller';
import type { LocalClock } from '../local-core/timebase';
import type { StepGestureTimer } from './step-midi-attempt-input';
import { browserStepMicrophonePlatform, type StepMicrophonePlatform } from './step-microphone-platform';
import { watchMicrophoneInfrastructure } from '../acoustic/source/microphone-infrastructure';

export type StepMidiPort = Pick<BrowserMidiController, 'start' | 'dispose' | 'getState'>;
export type StepMetronomePort = Pick<MetronomeController, 'start' | 'destroy' | 'setEnabled' | 'setStepContext'>;
export interface StepPlatform {
  clock: LocalClock;
  timer: StepGestureTimer;
  createMidi(options: BrowserMidiControllerOptions): StepMidiPort;
  createMetronome(options: MetronomeControllerOptions): StepMetronomePort;
  microphone?: StepMicrophonePlatform & {
    acquireMicrophone(): Promise<MediaStream>;
    createAudioContext(): AudioContext;
    watchInfrastructure: typeof watchMicrophoneInfrastructure;
  };
}
export function browserStepPlatform(): StepPlatform {
  return { clock: { nowMs: () => performance.now() }, timer: {
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }, createMidi: options => new BrowserMidiController(options), createMetronome: options => new MetronomeController(options),
  microphone: { ...browserStepMicrophonePlatform,
    acquireMicrophone: () => navigator.mediaDevices.getUserMedia({ video: false,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
    createAudioContext: () => new AudioContext(), watchInfrastructure: watchMicrophoneInfrastructure } };
}
