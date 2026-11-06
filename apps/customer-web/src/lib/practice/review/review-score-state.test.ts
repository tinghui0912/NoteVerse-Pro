import { createContinuousPerformanceResult } from "@/lib/practice/result/continuous-performance-result";
import { unavailableContinuousEvaluation } from "@/lib/practice/continuous/domain/evaluation/session";
import { expect, it } from "vitest";
import { canonicalContinuousResultFixture } from "@/lib/practice/__fixtures__/continuous-result";
import { resolvePracticeScope } from "@/lib/practice/planning/scope";
import { createTransientReviewSession } from "./transient-review-session";
import { resolveReviewScoreState } from "./review-score-state";
const result = canonicalContinuousResultFixture(),
  artifact = result.session.plan.bundle.artifact;
const source = {
  binding: { scoreId: 'score-1', revisionId: 'revision-1', bundleId: result.session.plan.bundle.binding.bundleId },
  artifact,
  musicXml: "<score />",
};
it("projects FULL cursor scope while preserving completed evaluation", () => {
  const session = createTransientReviewSession(
    { result, recording: { status: "NOT_RECORDED" } },
    source,
  );
  expect(resolveReviewScoreState(session)).toEqual({
    status: "READY",
    scope: {
      kind: "FULL",
      startTick: result.session.plan.scope.startTick,
      terminalTick: result.session.plan.scope.terminalTick,
    },
  });
  expect(session.result.evaluation).toBe(result.evaluation);
});
it("projects RANGE note references from the admitted artifact", () => {
  const scope = resolvePracticeScope(artifact, {
    kind: "RANGE",
    startGroupId: artifact.moments[1].groupId,
    endGroupId: artifact.moments[2].groupId,
  });
  const session = createTransientReviewSession(
    {
      result: createContinuousPerformanceResult({
        session: { ...result.session, plan: { ...result.session.plan, scope } },
        evaluation: unavailableContinuousEvaluation(
          "MIDI",
          "CONTINUOUS_ANALYSIS_UNAVAILABLE",
        ),
      }),
      recording: { status: "NOT_RECORDED" },
    },
    source,
  );
  expect(resolveReviewScoreState(session)).toMatchObject({
    status: "READY",
    scope: {
      kind: "RANGE",
      startTick: scope.startTick,
      terminalTick: scope.terminalTick,
    },
  });
});
it("fails closed when a scope cannot project canonical notation references", () => {
  const scope = {
    ...result.session.plan.scope,
    kind: "RANGE" as const,
    startIndex: 500,
    endIndex: 501,
    startGroupId: "missing",
    endGroupId: "missing",
  };
  const session = createTransientReviewSession(
    {
      result: createContinuousPerformanceResult({
        session: { ...result.session, plan: { ...result.session.plan, scope } },
        evaluation: unavailableContinuousEvaluation(
          "MIDI",
          "CONTINUOUS_ANALYSIS_UNAVAILABLE",
        ),
      }),
      recording: { status: "NOT_RECORDED" },
    },
    source,
  );
  expect(resolveReviewScoreState(session)).toMatchObject({
    status: "SCOPE_INVALID",
  });
});
