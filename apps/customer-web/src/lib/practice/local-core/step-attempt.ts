import type { PracticeInputSource } from './artifact';
import type { SessionTime } from './timebase';

export const MAX_ACTIVE_STEP_ATTEMPTS = 1;
// Full history, never silently evicted. One attempt / 5s permits >138 hours.
export const MAX_STEP_HISTORY_RECORDS = 100_000;
export const STEP_RUNTIME_VERSION = Object.freeze({ schemaVersion: 6, runtimeVersion: 'step-source-sensitive-verdict-v6' });
export type StepAttemptState = 'READY' | 'CAPTURING' | 'ANALYZING' | 'POST_VERDICT';
/** Resolved by the runtime from the input source, never a caller-selected option. */
export type StepVerdictPolicy = 'MIDI_EXACT_SET' | 'MICROPHONE_CONSERVATIVE_TRISTATE';
export type StepTarget = Readonly<{
  stepId: string; targetGeneration: number; inputEligibleAfter: Readonly<SessionTime>;
  attackPitches: readonly string[]; continuationPitches: readonly string[];
}>;
export type StepAttemptIdentity = Readonly<{
  attemptId: string; localSessionId: string; stepId: string; targetGeneration: number;
  inputSource: PracticeInputSource; attemptStartSessionTime: Readonly<SessionTime>;
}>;
export type StepRetryReason = 'UNCERTAIN' | 'TOO_QUIET';
/** Score-blind bounded gesture facts; only the runtime compares these with a target.
 * Explicit RETRY describes acquisition quality, never target-relative coverage. */
export type StepAttemptEvidence = Readonly<{
  kind: 'EVIDENCE'; observedAttackPitches: readonly string[]; confidence: number;
  captureEndSessionTime: Readonly<SessionTime>;
}> | Readonly<{ kind: 'RETRY'; reason: StepRetryReason; captureEndSessionTime: Readonly<SessionTime> }>;
export type StepAttemptVerdict = 'MATCH' | 'MISMATCH' | 'RETRY';
export type StepAttemptRecord = StepAttemptIdentity & Readonly<{
  /** Runtime uncertainty retains EVIDENCE pitches/confidence; acquisition RETRY has []/null. */
  verdict: StepAttemptVerdict; observedAttackPitches: readonly string[]; confidence: number | null;
  captureEndSessionTime: Readonly<SessionTime>; retryReason: StepRetryReason | null;
}>;
export type StepSkipRecord = Readonly<{ stepId: string; targetGeneration: number; sessionTime: Readonly<SessionTime> }>;
export class StepDomainError extends Error {
  constructor(readonly code: 'STEP_HISTORY_LIMIT_EXCEEDED' | 'STEP_ATTEMPT_STATE_INVALID' | 'STEP_ATTEMPT_EVIDENCE_INVALID') {
    super(code); this.name = 'StepDomainError';
  }
}
