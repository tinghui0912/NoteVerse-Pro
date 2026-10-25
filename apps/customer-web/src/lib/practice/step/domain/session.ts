import type { LocalPracticeSessionBase } from '@/lib/practice/kernel/session';
import type { SessionTime } from '@/lib/practice/kernel/timebase';
import type { StepAttemptIdentity, StepAttemptRecord, StepAttemptState, StepSkipRecord, StepVerdictPolicy } from '@/lib/practice/step/domain/attempt';

/** Domain status only; browser preparation and disposal belong to the controller. */
export type StepRuntimeStatus = 'ACTIVE' | 'ENDED';

export type LocalStepSessionSnapshot = LocalPracticeSessionBase & {
  mode: 'STEP_BY_STEP';
  runtimeStatus: StepRuntimeStatus;
  step: {
    verdictPolicy: StepVerdictPolicy;
    currentIndex: number;
    targetGeneration: number;
    inputEligibleAfter: Readonly<SessionTime>;
    inputAvailable: boolean;
    completed: boolean;
    attemptState: StepAttemptState;
    activeAttempt: StepAttemptIdentity | null;
    pendingPostVerdict: StepAttemptRecord | null;
    canAcceptAttempt: boolean;
    attempts: readonly StepAttemptRecord[];
    skips: readonly StepSkipRecord[];
  };
};
