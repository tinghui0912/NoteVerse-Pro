import type { CaptureTime } from './timebase';

export type NormalizedAcousticNoteEvidence = CaptureTime & {
  pitch: string;
  onsetScore: number;
  frameScore?: number;
  confidence: number;
  source: 'ACOUSTIC';
};

export type LocalMidiNoteObservation = CaptureTime & {
  pitch: string;
  velocity: number;
  source: 'MIDI';
};

export type StepVerifierTarget = {
  stepId: string;
  activationGeneration: number;
  attackPitches: string[];
  continuationPitches: string[];
};

export type StepVerifierObservation = CaptureTime & {
  stepId: string;
  activationGeneration: number;
  observedAttackPitches: string[];
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
};

export type PerformanceEvidenceObservation = CaptureTime & {
  pitches: string[];
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
  inferenceCompletedAtMs?: number;
};

export type PerformanceEvaluationObservation = PerformanceEvidenceObservation & {
  performanceTimeMs: number;
  musicalBeat: number;
};

export type LocalEvidencePipeline = {
  pushAudioFrame?(frame: CapturedAudioFrame): void;
  pushMidiObservation?(observation: LocalMidiNoteObservation): void;
};

export type CapturedAudioFrame = CaptureTime & {
  sampleRate: number;
  channelCount: number;
  samples: Float32Array;
};

export function normalizePitchSet(pitches: readonly string[]): string[] {
  return Array.from(new Set(pitches)).sort();
}

export function pitchSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  return normalizePitchSet(left).join('\u001f') === normalizePitchSet(right).join('\u001f');
}
