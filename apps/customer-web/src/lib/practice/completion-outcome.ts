import type { PracticeSessionCompletionOutcomeRead } from '@/generated/practice-api';

export type PracticeCompletionOutcomeKind =
  | 'full-piece-learning'
  | 'full-piece-performance'
  | 'selected-section';

export type PracticeCompletionOutcome = {
  kind: PracticeCompletionOutcomeKind;
};

type ResolvePracticeCompletionOutcomeOptions = {
  completionOutcome: PracticeSessionCompletionOutcomeRead | null | undefined;
};

export function resolvePracticeCompletionOutcome({
  completionOutcome,
}: ResolvePracticeCompletionOutcomeOptions): PracticeCompletionOutcome {
  if (!completionOutcome) {
    throw new Error('Finished practice session is missing completion outcome.');
  }

  return {
    kind: completionOutcomeKind(completionOutcome.kind),
  };
}

function completionOutcomeKind(
  kind: PracticeSessionCompletionOutcomeRead['kind']
): PracticeCompletionOutcomeKind {
  if (kind === 'SELECTED_SECTION') {
    return 'selected-section';
  }
  if (kind === 'FULL_PIECE_PERFORMANCE') {
    return 'full-piece-performance';
  }
  return 'full-piece-learning';
}
