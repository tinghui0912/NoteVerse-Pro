import type { CaptureTime, SessionTime } from './timebase';

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

type PerformanceExpectedStrikeResult = 'MATCHED' | 'MISSING' | 'UNCONFIRMED';

type PerformanceExpectedEventResult =
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

export function normalizePitchSet(pitches: readonly string[]): string[] {
  return Array.from(new Set(pitches)).sort();
}

export function pitchSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  return normalizePitchSet(left).join('\u001f') === normalizePitchSet(right).join('\u001f');
}
