import type { PracticePlanBundle } from '@/lib/practice/planning/practice-plan';
import type { ResolvedPracticeScope } from '@/lib/practice/planning/scope';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/planning/tempo';
import type { ContinuousPracticeSessionSnapshot } from '@/lib/practice/continuous/domain/session';

/** Canonical semantics of an earned completion; no resource or outcome lifetime. */
export type ExecutedPerformance = Readonly<{
  bundle: PracticePlanBundle;
  scope: Readonly<ResolvedPracticeScope>;
  tempoPlan: ResolvedPracticeTempoPlan;
}>;

export function executedPerformanceFromCompletion(
  session: ContinuousPracticeSessionSnapshot,
): ExecutedPerformance {
  if (
    session.completionReason !== 'SCOPE_COMPLETED' ||
    session.lifecycleState !== 'ENDED' ||
    session.performance.state !== 'ENDED'
  )
    throw new Error('Executed performance requires natural completion.');
  return Object.freeze({
    bundle: session.plan.bundle,
    scope: session.plan.scope,
    tempoPlan: session.plan.tempoPlan,
  });
}
