export type ContinuousEvaluationErrorCode = 'INVALID_EXPECTED_GROUP' | 'INVALID_PUBLICATION'
  | 'PUBLICATION_MUTATED' | 'DUPLICATE_OBSERVATION' | 'LATE_EVIDENCE' | 'SESSION_DOMAIN_MISMATCH'
  | 'PUBLICATION_AFTER_COMPLETION' | 'COMPLETION_MUTATED' | 'OWNERSHIP_VIOLATION'
  | 'CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED' | 'FINALIZATION_BOUND_EXCEEDED' | 'UNRESOLVED_RESERVATION' | 'OBSERVATION_SOURCE_MISMATCH';

export class ContinuousEvaluationError extends Error {
  constructor(readonly code: ContinuousEvaluationErrorCode, detail = code as string) {
    super(detail);
    this.name = 'ContinuousEvaluationError';
  }
}
