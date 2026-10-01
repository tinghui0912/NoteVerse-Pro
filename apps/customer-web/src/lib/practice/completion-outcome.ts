type PracticeCompletionOutcomeKind =
  | 'full-piece-learning'
  | 'full-piece-performance'
  | 'selected-section';

export type PracticeCompletionOutcome = {
  kind: PracticeCompletionOutcomeKind;
};
