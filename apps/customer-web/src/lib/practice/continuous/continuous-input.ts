import type { ContinuousEvidencePublication } from '../local-core/continuous-evaluation-types';
import type { LocalClock, PracticeTimebase } from '../local-core/timebase';
import type { BrowserMidiControllerOptions, BrowserMidiState } from '../midi/browser-midi-controller';
import type { PerformanceRecorder, PracticeRecordingMode } from '../performance-recorder';
import type { MetronomeController, MetronomeControllerOptions } from '../metronome/metronome-controller';
import type { AcousticInferencePort } from '../acoustic/runtime/inference-types';
import type { BrowserAcousticCapture } from '../acoustic/source/capture';
import type { ContinuousCaptureBridge } from '../acoustic/continuous/capture-bridge';

export interface ContinuousModelWorker extends AcousticInferencePort { load(url: string): Promise<unknown>; }
export type ContinuousMidiPort = Readonly<{ start(): Promise<void>; dispose(): void; getState(): BrowserMidiState }>;
export type ContinuousRecorderPort = Pick<PerformanceRecorder, 'prepare' | 'startIfReady' | 'pause' | 'resume' | 'freeze' | 'finalize' | 'stopAndCleanup' | 'snapshot'>;
export type ContinuousMetronomePort = Pick<MetronomeController, 'start' | 'pause' | 'resume' | 'stop' | 'destroy' | 'setEnabled' | 'syncContinuous'>;
/** Platform boundaries are injectable for deterministic tests, never alternate evaluation policies. */
export interface ContinuousPlatform {
  midiClock: LocalClock;
  modelUrl(signal: AbortSignal): Promise<string>;
  createWorker(): ContinuousModelWorker;
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
  observe: NonNullable<BrowserMidiControllerOptions['onCapturedAttack']>;
  onState: NonNullable<BrowserMidiControllerOptions['onStateChange']> }>;
