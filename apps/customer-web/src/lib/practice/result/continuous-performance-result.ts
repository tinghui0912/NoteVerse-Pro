import { assertCompletedEvaluation } from "@/lib/practice/continuous/domain/evaluation/session";
import type { CompletedContinuousEvaluation } from "@/lib/practice/continuous/domain/evaluation/evaluation-types";
import type { ContinuousPracticeSessionSnapshot } from "@/lib/practice/continuous/domain/session";

export type CompletedContinuousPracticeSessionSnapshot = Readonly<
  Omit<
    ContinuousPracticeSessionSnapshot,
    "completionReason" | "lifecycleState" | "performance"
  > & {
    completionReason: "SCOPE_COMPLETED";
    lifecycleState: "ENDED";
    performance: Readonly<
      ContinuousPracticeSessionSnapshot["performance"] & { state: "ENDED" }
    >;
  }
>;

export type ContinuousPerformanceResult = Readonly<{
  session: CompletedContinuousPracticeSessionSnapshot;
  evaluation: CompletedContinuousEvaluation;
}>;

/** Natural completion produces an in-memory value referencing its executed owners. */
export function createContinuousPerformanceResult({
  session,
  evaluation,
}: Readonly<{
  session: ContinuousPracticeSessionSnapshot;
  evaluation: CompletedContinuousEvaluation;
}>): ContinuousPerformanceResult {
  if (
    session.completionReason !== "SCOPE_COMPLETED" ||
    session.lifecycleState !== "ENDED" ||
    session.performance.state !== "ENDED"
  ) {
    throw new Error(
      "Continuous result requires a naturally completed, ended session.",
    );
  }
  const { plan } = session;
  assertCompletedEvaluation(evaluation, plan.resources.input.kind);
  if (evaluation.status === "COMPLETE") {
    if (evaluation.assignment.completion.reason !== "SCOPE_COMPLETED") {
      throw new Error("Continuous result requires natural scope completion.");
    }
    if (evaluation.assignment.sessionDomainId !== session.localSessionId) {
      throw new Error("Continuous result session identity is inconsistent.");
    }
    const expected = plan.bundle.artifact.moments
      .slice(plan.scope.startIndex, plan.scope.endIndex + 1)
      .flatMap((group) => group.attacks);
    const assigned = evaluation.assignment.groups.flatMap(
      (group) => group.strikes,
    );
    const ids = new Set(assigned.map((strike) => strike.strikeId));
    if (
      assigned.length !== expected.length ||
      ids.size !== expected.length ||
      expected.some((strike) => !ids.has(strike.attackId))
    ) {
      throw new Error(
        "Continuous result does not cover its canonical scoped targets.",
      );
    }
  }
  const completedSession: CompletedContinuousPracticeSessionSnapshot =
    Object.freeze({
      ...session,
      completionReason: "SCOPE_COMPLETED",
      lifecycleState: "ENDED",
      performance: Object.freeze({
        ...session.performance,
        state: "ENDED" as const,
      }),
    });
  return Object.freeze({ session: completedSession, evaluation });
}
