import { createContinuousPerformanceResult } from "@/lib/practice/result/continuous-performance-result";
import { continuousPracticePlan } from "@/lib/practice/__fixtures__/practice-plan";
import { completedContinuousSessionFixture } from "@/lib/practice/__fixtures__/continuous-result";
import { unavailableContinuousEvaluation } from "@/lib/practice/continuous/domain/evaluation/session";
import { canonicalContinuousResultFixture } from "@/lib/practice/__fixtures__/continuous-result";
import { expect, it } from "vitest";
import { reviewViewModel } from "./review-view-model";
it.each(["MIDI", "MICROPHONE"] as const)(
  "projects only replay metadata for %s",
  (source) => {
    const view = reviewViewModel(canonicalContinuousResultFixture(source));
    expect(view.durationText).toBe("00:10");
    expect(view.inputSourceLabel).toBe(
      source === "MIDI" ? "inputSourceMidi" : "inputSourceMic",
    );
    expect(Object.keys(view).sort()).toEqual([
      "durationText",
      "inputSourceLabel",
      "scope",
      "tempo",
    ]);
  },
);
it("unavailable analysis does not create outcome cards or aggregates", () => {
  const view = reviewViewModel(
    canonicalContinuousResultFixture("MICROPHONE", false),
  );
  expect(Object.keys(view).sort()).toEqual([
    "durationText",
    "inputSourceLabel",
    "scope",
    "tempo",
  ]);
});

it.each(["SCORE", "CUSTOM_FIXED_BPM"] as const)(
  "returns semantic %s tempo and numeric scope instead of localized copy",
  (mode) => {
    const result = canonicalContinuousResultFixture();
    const base = result.session.plan;
    const plan = continuousPracticePlan(base.bundle.artifact, {
      scope: {
        kind: "RANGE",
        startGroupId: base.bundle.artifact.moments[1].groupId,
        endGroupId: base.bundle.artifact.moments[2].groupId,
      },
      tempoSelection: mode === "SCORE" ? { mode } : { mode, bpm: 96 },
    });
    const view = reviewViewModel(
      createContinuousPerformanceResult({
        session: completedContinuousSessionFixture(plan),
        evaluation: unavailableContinuousEvaluation(
          "MIDI",
          "CONTINUOUS_ANALYSIS_UNAVAILABLE",
        ),
      }),
    );
    expect(view.tempo).toEqual(
      mode === "SCORE"
        ? { kind: "SCORE" }
        : { kind: "CUSTOM_FIXED_BPM", bpm: 96 },
    );
    expect(view.scope).toEqual({
      label: "scopeSection",
      startTick: plan.scope.startTick,
      terminalTick: plan.scope.terminalTick,
    });
    expect(Object.keys(view).sort()).toEqual([
      "durationText",
      "inputSourceLabel",
      "scope",
      "tempo",
    ]);
  },
);

it("exposes the full-scope translation key with its numeric bounds", () => {
  const result = canonicalContinuousResultFixture();
  expect(reviewViewModel(result).scope).toEqual({
    label: "scopeFull",
    startTick: result.session.plan.scope.startTick,
    terminalTick: result.session.plan.scope.terminalTick,
  });
});
