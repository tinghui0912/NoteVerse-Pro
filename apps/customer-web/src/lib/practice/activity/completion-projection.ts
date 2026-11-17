import type { PracticeActivityCreateRequest } from '@/generated/api';
import type { StepPracticeSessionSnapshot } from '@/lib/practice/step/domain/session';
import type { ContinuousPracticeSessionSnapshot } from '@/lib/practice/continuous/domain/session';

export function practiceActivityRequestFromCompletion(
  snapshot: StepPracticeSessionSnapshot | ContinuousPracticeSessionSnapshot,
): PracticeActivityCreateRequest | null {
  if (snapshot.completionReason !== 'SCOPE_COMPLETED') return null;
  const { plan } = snapshot;
  const { binding } = plan.bundle;
  return {
    client_session_id: snapshot.localSessionId,
    practice_binding: {
      score_id: binding.scoreId,
      revision_id: binding.revisionId,
      bundle_id: binding.bundleId,
    },
    mode: plan.mode,
    input_source: plan.resources.input.kind,
    scope: {
      kind: plan.scope.kind,
      start_tick: plan.scope.startTick,
      terminal_tick: plan.scope.terminalTick,
    },
  };
}
