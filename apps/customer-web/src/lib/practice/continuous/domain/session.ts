import type { PracticeSession } from "@/lib/practice/session/session";
import type { ContinuousPracticePlan } from "@/lib/practice/planning/practice-plan";

type ContinuousPracticeLifecycle = "READY" | "ACTIVE" | "PAUSED" | "ENDED";

export type ContinuousPracticeSessionSnapshot =
  PracticeSession<ContinuousPracticePlan> & {
    lifecycleState: ContinuousPracticeLifecycle;
    performance: {
      metronomeEnabled: boolean;
      state: "READY" | "COUNT_IN" | "RUNNING" | "PAUSED" | "ENDED";
      stateBeforePause: "READY" | "COUNT_IN" | "RUNNING" | "PAUSED" | "ENDED";
      activeElapsedMs: number;
      countInMs: number;
      countInTicks: number;
      countInPulses: number;
    };
  };
