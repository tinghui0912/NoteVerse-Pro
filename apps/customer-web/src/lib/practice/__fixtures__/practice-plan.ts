import type { PracticeScoreArtifact } from "../score/artifact";
import type { PracticeIntent } from "../planning/intent";
import {
  planPractice,
  type StepPracticePlan,
  type ContinuousPracticePlan,
} from "../planning/practice-plan";

type Choices = Partial<Omit<PracticeIntent, "mode">>;
export function stepPracticePlan(
  artifact: PracticeScoreArtifact,
  choices: Choices = {},
): StepPracticePlan {
  return planPractice({ binding: { scoreId: 'score-1', revisionId: 'revision-1', bundleId: "practice-bundle-fixture" }, artifact }, {
    mode: "STEP_BY_STEP",
    recordingMode: "OFF",
    inputSource: "MIDI",
    scope: { kind: "FULL" },
    tempoSelection: { mode: "SCORE" },
    metronomeEnabled: false,
    ...choices,
  } as Extract<PracticeIntent, { mode: "STEP_BY_STEP" }>) as StepPracticePlan;
}
export function continuousPracticePlan<const T extends Choices = {}>(
  artifact: PracticeScoreArtifact,
  choices: T = {} as T,
): ContinuousPracticePlan {
  return planPractice(
    { binding: { scoreId: 'score-1', revisionId: 'revision-1', bundleId: "practice-bundle-fixture" }, artifact },
    {
      mode: "CONTINUOUS_PLAY",
      recordingMode: "OFF",
      inputSource: "MIDI",
      scope: { kind: "FULL" },
      tempoSelection: { mode: "SCORE" },
      metronomeEnabled: false,
      ...choices,
    },
  ) as ContinuousPracticePlan;
}

/** Build resolved timing variants for isolated clock/evidence tests. */
export function withContinuousTiming(
  plan: ContinuousPracticePlan,
  timing: {
    countInTicks?: number;
    tempoPlan?: ContinuousPracticePlan["tempoPlan"];
  },
): ContinuousPracticePlan {
  return Object.freeze({
    ...plan,
    tempoPlan: timing.tempoPlan ?? plan.tempoPlan,
    countIn: Object.freeze({
      ...plan.countIn,
      durationTicks: timing.countInTicks ?? plan.countIn.durationTicks,
    }),
  });
}
