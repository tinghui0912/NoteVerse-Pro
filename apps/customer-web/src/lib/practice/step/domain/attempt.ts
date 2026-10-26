import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { SessionTime } from '@/lib/practice/kernel/timebase';

// Full history, never silently evicted. One attempt / 5s permits >138 hours.
export const MAX_STEP_HISTORY_RECORDS = 100_000;
export const STEP_RUNTIME_VERSION = Object.freeze({ schemaVersion: 7, runtimeVersion: 'step-explicit-target-policy-retry-v7' });
export type StepAttemptState = 'READY' | 'CAPTURING' | 'ANALYZING' | 'POST_VERDICT';
/** Resolved by the runtime from the input source, never a caller-selected option. */
export type StepVerdictPolicy = 'MIDI_EXACT_SET_V1' | 'MICROPHONE_EXACT_SET_WITH_SUPERSET_ABSTENTION_V1';
export type StepTarget = Readonly<{
  stepId: string; targetGeneration: number; inputEligibleAfter: Readonly<SessionTime>;
  attackPitches: readonly string[]; continuationPitches: readonly string[];
}>;
export type StepAttemptIdentity = Readonly<{
  attemptId: string; localSessionId: string; stepId: string; targetGeneration: number;
  inputSource: PracticeInputSource; attemptStartSessionTime: Readonly<SessionTime>;
}>;
/** Score-blind bounded pitch facts; only the runtime compares these with a target. */
export type StepPitchEvidence = Readonly<{
  observedAttackPitches: readonly [string, ...string[]];
  confidence: number;
  captureEndSessionTime: Readonly<SessionTime>;
}>;
export type StepRetry = Readonly<{
  origin: 'TARGET_POLICY';
  reason: 'TARGET_COVERED_WITH_EXTRA';
}>;
type StepAttemptOutcome =
  | Readonly<{ verdict: 'MATCH'; retry: null }>
  | Readonly<{ verdict: 'MISMATCH'; retry: null }>
  | Readonly<{ verdict: 'RETRY'; retry: StepRetry }>;
export type StepAttemptRecord = StepAttemptIdentity & StepPitchEvidence & StepAttemptOutcome;
export type StepSkipRecord = Readonly<{ stepId: string; targetGeneration: number; sessionTime: Readonly<SessionTime> }>;
export class StepDomainError extends Error {
  constructor(readonly code: 'STEP_HISTORY_LIMIT_EXCEEDED' | 'STEP_ATTEMPT_STATE_INVALID' | 'STEP_ATTEMPT_EVIDENCE_INVALID') {
    super(code); this.name = 'StepDomainError';
  }
}

export function normalizePitchSet(pitches: readonly string[]): string[] {
  return Array.from(new Set(pitches)).sort();
}

export function pitchSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  return normalizePitchSet(left).join('\u001f') === normalizePitchSet(right).join('\u001f');
}
