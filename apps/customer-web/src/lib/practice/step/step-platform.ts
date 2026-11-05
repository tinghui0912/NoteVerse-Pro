import { createBrowserMetronomeAudio } from '@/lib/practice/metronome/browser-metronome-audio';
import { AcousticFailure } from '@/lib/practice/failure/causal-failure';
import { createPracticeAudioContext } from '@/lib/practice/failure/browser-failures';
import { BrowserMidiController, type BrowserMidiControllerOptions } from '@/lib/practice/midi/browser-midi-controller';
import type { MetronomeAudioPort } from '@/lib/practice/metronome/metronome-audio-port';
import type { LocalClock } from '@/lib/practice/session/timebase';
import type { StepGestureTimer } from './step-midi-attempt-input';
import { browserStepMicrophonePlatform, type StepMicrophonePlatform } from './step-microphone-platform';

export type StepMidiPort = Pick<BrowserMidiController, 'start' | 'refreshInputs' | 'dispose'>;
export interface StepPlatform {
  clock: LocalClock;
  timer: StepGestureTimer;
  createMidi(options: BrowserMidiControllerOptions): StepMidiPort;
  createMetronomeAudio(context: AudioContext | null): MetronomeAudioPort;
  microphone?: StepMicrophonePlatform & {
    createAudioContext(): AudioContext;
  };
}
export function browserStepPlatform(acquireInference: StepMicrophonePlatform['acquireInference'] = async () => { throw new AcousticFailure('ENVIRONMENT_NOT_READY'); }): StepPlatform {
  return { clock: { nowMs: () => performance.now() }, timer: {
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }, createMidi: options => new BrowserMidiController(options), createMetronomeAudio: context => createBrowserMetronomeAudio(context ? { kind: 'BORROWED', context } : { kind: 'OWNED' }),
  microphone: { ...browserStepMicrophonePlatform(acquireInference),
    createAudioContext: createPracticeAudioContext } };
}
