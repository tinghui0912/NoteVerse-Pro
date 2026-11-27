import type { PracticePianoKey } from '@/lib/practice/score/piano-key';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';
import type { SessionTime } from '@/lib/practice/session/timebase';

export type StepAttemptState = 'READY' | 'CAPTURING' | 'ANALYZING' | 'POST_VERDICT';
export type StepTarget = Readonly<{
  stepId: string; targetGeneration: number; inputEligibleAfter: Readonly<SessionTime>;
  attackKeys: readonly PracticePianoKey[]; continuationKeys: readonly PracticePianoKey[];
}>;
export type StepAttemptIdentity = Readonly<{
  attemptId: string; localSessionId: string; stepId: string; targetGeneration: number;
  inputSource: PracticeInputSource; attemptStartSessionTime: Readonly<SessionTime>;
}>;
/** Score-blind bounded pianoKey facts; only the runtime compares these with a target. */
export type StepPianoKeyEvidence = Readonly<{
  observedAttackKeys: readonly [PracticePianoKey, ...PracticePianoKey[]];
  confidence: number;
  captureEndSessionTime: Readonly<SessionTime>;
}>;
export type StepAttemptRecord = StepAttemptIdentity & StepPianoKeyEvidence & Readonly<{ verdict: 'MATCH' | 'MISMATCH' }>;
export class StepDomainError extends Error {
  constructor(readonly code: 'STEP_ATTEMPT_STATE_INVALID' | 'STEP_ATTEMPT_EVIDENCE_INVALID') {
    super(code); this.name = 'StepDomainError';
  }
}

export function normalizePianoKeySet(pianoKeys: readonly PracticePianoKey[]): PracticePianoKey[] {
  return Array.from(new Set(pianoKeys)).sort((a, b) => a - b);
}

export function pianoKeySetsEqual(left: readonly PracticePianoKey[], right: readonly PracticePianoKey[]): boolean {
  const normalizedLeft = normalizePianoKeySet(left);
  const normalizedRight = normalizePianoKeySet(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((pianoKey, index) => pianoKey === normalizedRight[index]);
}
