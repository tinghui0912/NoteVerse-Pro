import type { PracticeInputSource } from './artifact';
import type { SessionTime } from './timebase';

export const MAX_ACTIVE_STEP_ATTEMPTS = 1;
// Full history, never silently evicted. One attempt / 5s permits >138 hours.
export const MAX_STEP_HISTORY_RECORDS = 100_000;
export const STEP_RUNTIME_VERSION = Object.freeze({ schemaVersion: 4, runtimeVersion: 'step-paced-attempt-v4' });
export type StepAttemptState = 'READY' | 'CAPTURING' | 'ANALYZING' | 'POST_VERDICT';
export type StepTarget = Readonly<{
  stepId: string; targetGeneration: number; inputEligibleAfter: Readonly<SessionTime>;
  attackPitches: readonly string[]; continuationPitches: readonly string[];
}>;
export type StepAttemptIdentity = Readonly<{
  attemptId: string; localSessionId: string; stepId: string; targetGeneration: number;
  inputSource: PracticeInputSource; attemptStartSessionTime: Readonly<SessionTime>;
}>;
export type StepRetryReason = 'UNCERTAIN' | 'TOO_QUIET';
/** Generic finalized gesture facts; correctness belongs exclusively to the runtime. */
export type StepAttemptEvidence = Readonly<{
  kind: 'EVIDENCE'; observedAttackPitches: readonly string[]; confidence: number;
  captureEndSessionTime: Readonly<SessionTime>;
}> | Readonly<{ kind: 'RETRY'; reason: StepRetryReason; captureEndSessionTime: Readonly<SessionTime> }>;
export type StepAttemptVerdict = 'MATCH' | 'MISMATCH' | 'RETRY';
export type StepAttemptRecord = StepAttemptIdentity & Readonly<{
  verdict: StepAttemptVerdict; observedAttackPitches: readonly string[]; confidence: number | null;
  captureEndSessionTime: Readonly<SessionTime>; retryReason: StepRetryReason | null;
}>;
export type StepSkipRecord = Readonly<{ stepId: string; targetGeneration: number; sessionTime: Readonly<SessionTime> }>;
export class StepDomainError extends Error {
  constructor(readonly code: 'STEP_HISTORY_LIMIT_EXCEEDED' | 'STEP_ATTEMPT_STATE_INVALID' | 'STEP_ATTEMPT_EVIDENCE_INVALID') {
    super(code); this.name = 'StepDomainError';
  }
}
