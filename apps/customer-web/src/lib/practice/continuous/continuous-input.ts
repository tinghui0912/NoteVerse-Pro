import type { ContinuousCaptureBridge } from '@/lib/practice/acoustic/continuous/capture-bridge';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import type { BrowserAcousticCapture } from '@/lib/practice/acoustic/source/capture';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { LocalClock, PracticeTimebase } from '@/lib/practice/kernel/timebase';
import type { MetronomeController, MetronomeControllerOptions } from '@/lib/practice/metronome/metronome-controller';
import type { BrowserMidiControllerOptions, BrowserMidiState } from '@/lib/practice/midi/browser-midi-controller';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';
import type { PerformanceRecorder } from '@/lib/practice/recording/performance-recorder';
import type { ContinuousMidiAttack } from './domain/clock-evidence-port';

export type ContinuousMidiPort = Readonly<{ start(): Promise<void>; dispose(): void; getState(): BrowserMidiState }>;
export type ContinuousRecorderPort = Pick<PerformanceRecorder, 'prepare' | 'assertPrepared' | 'activate' | 'onRuntimeFault' | 'runtimeFault'
  | 'recoverRuntime' | 'continueWithoutRecording' | 'startIfReady' | 'pause' | 'resume' | 'freeze' | 'finalize' | 'stopAndCleanup' | 'snapshot'>;
export type ContinuousMetronomePort = Pick<MetronomeController, 'start' | 'pause' | 'resume' | 'stop' | 'destroy' | 'setEnabled' | 'syncContinuous'>;
/** Platform boundaries are injectable for deterministic tests, never alternate evaluation policies. */
export interface ContinuousPlatform {
  midiClock: LocalClock;
  acquireInference(signal: AbortSignal): Promise<AcousticInferencePort>;
  acquireMicrophone(): Promise<MediaStream>;
  createAudioContext(): AudioContext;
  coefficients(rate: number): Promise<Uint8Array>;
  workletUrl: string;
  connectCapture(options: Omit<Parameters<typeof BrowserAcousticCapture.connect>[0], 'bridge'> & { bridge: ContinuousCaptureBridge }): Promise<Pick<BrowserAcousticCapture, 'stop'>>;
  createMidi(options: BrowserMidiControllerOptions): ContinuousMidiPort;
  createRecorder(mode: PracticeRecordingMode): ContinuousRecorderPort;
  createMetronome(options: MetronomeControllerOptions): ContinuousMetronomePort;
}
export type MicrophoneConnection = Readonly<{
  context: AudioContext; stream: MediaStream; sessionDomainId: string;
  clock: LocalClock; publish(publication: ContinuousEvidencePublication): void;
}>;
export type MidiConnection = Readonly<{ timebase: PracticeTimebase;
  observe(attack: ContinuousMidiAttack): void;
  onState: NonNullable<BrowserMidiControllerOptions['onStateChange']> }>;
