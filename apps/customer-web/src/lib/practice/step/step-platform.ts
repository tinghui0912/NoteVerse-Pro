import { AcousticFailure } from '@/lib/practice/failure/causal-failure';
import { createPracticeAudioContext } from '@/lib/practice/failure/browser-failures';
import { BrowserMidiController, type BrowserMidiControllerOptions } from '@/lib/practice/midi/browser-midi-controller';
import { MetronomeController, type MetronomeControllerOptions } from '@/lib/practice/metronome/metronome-controller';
import type { LocalClock } from '@/lib/practice/kernel/timebase';
import type { StepGestureTimer } from './step-midi-attempt-input';
import { browserStepMicrophonePlatform, type StepMicrophonePlatform } from './step-microphone-platform';

export type StepMidiPort = Pick<BrowserMidiController, 'start' | 'refreshInputs' | 'dispose'>;
export type StepMetronomePort = Pick<MetronomeController, 'start' | 'destroy' | 'setEnabled' | 'setStepContext'>;
export interface StepPlatform {
  clock: LocalClock;
  timer: StepGestureTimer;
  createMidi(options: BrowserMidiControllerOptions): StepMidiPort;
  createMetronome(options: MetronomeControllerOptions): StepMetronomePort;
  microphone?: StepMicrophonePlatform & {
    createAudioContext(): AudioContext;
  };
}
export function browserStepPlatform(acquireInference: StepMicrophonePlatform['acquireInference'] = async () => { throw new AcousticFailure('ENVIRONMENT_NOT_READY'); }): StepPlatform {
  return { clock: { nowMs: () => performance.now() }, timer: {
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }, createMidi: options => new BrowserMidiController(options), createMetronome: options => new MetronomeController(options),
  microphone: { ...browserStepMicrophonePlatform(acquireInference),
    createAudioContext: createPracticeAudioContext } };
}
