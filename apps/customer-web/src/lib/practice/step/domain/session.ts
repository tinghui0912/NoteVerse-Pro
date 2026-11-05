import type { PracticeSession } from "@/lib/practice/session/session";
import type { SessionTime } from "@/lib/practice/session/timebase";
import type {
  StepAttemptIdentity,
  StepAttemptRecord,
  StepAttemptState,
} from "@/lib/practice/step/domain/attempt";
import type { StepPracticePlan } from "@/lib/practice/planning/practice-plan";

/** Domain status only; browser preparation and disposal belong to the controller. */

export type StepRuntimeStatus = "ACTIVE" | "ENDED";

export type StepPracticeSessionSnapshot = PracticeSession<StepPracticePlan> & {
  runtimeStatus: StepRuntimeStatus;
  step: {
    metronomeEnabled: boolean;
    currentIndex: number;
    targetGeneration: number;
    inputEligibleAfter: Readonly<SessionTime>;
    inputAvailable: boolean;
    completed: boolean;
    attemptState: StepAttemptState;
    activeAttempt: StepAttemptIdentity | null;
    pendingPostVerdict: StepAttemptRecord | null;
    canAcceptAttempt: boolean;
  };
};
