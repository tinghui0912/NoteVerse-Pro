import type { CaptureTime, SessionTime } from './timebase';

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
  activationBoundary: SessionTime;
  attackPitches: string[];
  continuationPitches: string[];
};

export type StepVerifierObservation = CaptureTime & {
  stepId: string;
  activationGeneration: number;
  attackOnsetTime: SessionTime;
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

export type PerformanceExpectedStrikeResult = 'MATCHED' | 'MISSING' | 'UNCONFIRMED';

export type PerformanceExpectedEventResult =
  | 'MATCH'
  | 'PARTIAL'
  | 'MISMATCH'
  | 'UNCERTAIN'
  | 'NOT_OBSERVED';

export type PerformanceExpectedStrikeOutcome = {
  strikeId: string;
  pitch: string;
  renderNoteIds: string[];
  result: PerformanceExpectedStrikeResult;
};

export type PerformanceExpectedEventOutcome = {
  expectedGroupId: string;
  performanceTimeMs: number;
  result: PerformanceExpectedEventResult;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
  expectedStrikeOutcomes: PerformanceExpectedStrikeOutcome[];
  unexpectedPitches: string[];
  renderNoteIds: string[];
  measureNumbers: string[];
  timingOffsetMs?: number;
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
