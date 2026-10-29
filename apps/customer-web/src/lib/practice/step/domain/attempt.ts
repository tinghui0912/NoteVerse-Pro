import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { SessionTime } from '@/lib/practice/kernel/timebase';

export const STEP_RUNTIME_VERSION = Object.freeze({ schemaVersion: 8, runtimeVersion: 'step-exact-pitch-learning-v11' });
export type StepAttemptState = 'READY' | 'CAPTURING' | 'ANALYZING' | 'POST_VERDICT';
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
export type StepAttemptRecord = StepAttemptIdentity & StepPitchEvidence & Readonly<{ verdict: 'MATCH' | 'MISMATCH' }>;
export class StepDomainError extends Error {
  constructor(readonly code: 'STEP_ATTEMPT_STATE_INVALID' | 'STEP_ATTEMPT_EVIDENCE_INVALID' | 'STEP_TARGET_INVALID') {
    super(code); this.name = 'StepDomainError';
  }
}

export function normalizePitchSet(pitches: readonly string[]): string[] {
  return Array.from(new Set(pitches)).sort();
}

export function pitchSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizePitchSet(left);
  const normalizedRight = normalizePitchSet(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((pitch, index) => pitch === normalizedRight[index]);
}
