export type ContinuousExpectedStrike = Readonly<{
  strikeId: string;
  groupId: string;
  pitch: string;
  expectedPerformanceTimeMs: number;
  renderNoteIds: readonly string[];
}>;

export type ContinuousObservation = Readonly<{
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'MIDI' | 'ACOUSTIC';
  provenance?: Readonly<{
    sourceDomainId: string;
    sourceSampleRateHz: number;
    sourceEventSample: number;
  }>;
}>;

/** Both clocks are performance-origin coordinates; availability is never attack time. */
export type ContinuousEvidencePublication = Readonly<{
  publicationId: string;
  sessionDomainId: string;
  analyzedThroughPerformanceMs: number;
  availabilityTimeMs: number;
  observations: readonly ContinuousObservation[];
}>;

export type ContinuousFinality = Readonly<{
  requiredAnalysisFrontierMs: number;
  unclampedRequiredFrontierMs: number;
  enablingPublicationId: string;
  enablingAnalysisFrontierMs: number;
  finalizationTimeMs: number;
  terminalClamp: boolean;
}>;

export type ContinuousStrikeEvaluation = ContinuousExpectedStrike & (
  | Readonly<{ state: 'PENDING' }>
  | Readonly<{
      state: 'MATCHED';
      match: Readonly<{ observation: ContinuousObservation; timingOffsetMs: number }>;
      finality: ContinuousFinality;
    }>
  | Readonly<{ state: 'MISSING' | 'NOT_REACHED'; finality: ContinuousFinality }>
);

type ContinuousGroupVerdict = 'PENDING' | 'CORRECT' | 'MISSING' | 'WRONG'
  | 'INCOMPLETE_CHORD' | 'NOT_REACHED';

export type ContinuousGroupEvaluation = Readonly<{
  groupId: string;
  performanceTimeMs: number;
  verdict: ContinuousGroupVerdict;
  strikes: readonly ContinuousStrikeEvaluation[];
  wrongObservations: readonly ContinuousObservation[];
  evidenceObservationIds: readonly string[];
  finality: ContinuousFinality | null;
}>;

type ContinuousFinalizedStrike = Exclude<ContinuousStrikeEvaluation, { state: 'PENDING' }>;
export type ContinuousFinalizedGroup = Omit<ContinuousGroupEvaluation, 'verdict' | 'strikes' | 'finality'> & Readonly<{
  verdict: Exclude<ContinuousGroupVerdict, 'PENDING'>;
  strikes: readonly ContinuousFinalizedStrike[];
  finality: ContinuousFinality;
}>;

export type ContinuousExtra = Readonly<{
  verdict: 'EXTRA';
  observation: ContinuousObservation;
  finality: ContinuousFinality;
}>;

export type ContinuousObservationOwner = Readonly<{
  observationId: string;
  disposition: 'MATCHED' | 'WRONG' | 'EXTRA';
  ownerId: string;
}>;

export type ContinuousCompletion = Readonly<{
  reason: 'SCOPE_COMPLETED' | 'STOPPED_BY_USER';
  performanceTimeMs: number;
  availabilityTimeMs: number;
}>;

export type ContinuousEvaluationSnapshot = Readonly<{
  sessionDomainId: string;
  analyzedThroughPerformanceMs: number | null;
  groups: readonly ContinuousGroupEvaluation[];
  extras: readonly ContinuousExtra[];
  observationOwnership: readonly ContinuousObservationOwner[];
  reservedObservationIds: readonly string[];
  completion: ContinuousCompletion | null;
}>;

export type CompletedContinuousEvaluation =
  | Readonly<{
      status: 'COMPLETE';
      sessionDomainId: string;
      groups: readonly ContinuousFinalizedGroup[];
      extras: readonly ContinuousExtra[];
      observationOwnership: readonly ContinuousObservationOwner[];
      completion: ContinuousCompletion;
    }>
  | Readonly<{
      status: 'UNAVAILABLE';
      reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' | 'INCOMPLETE_ANALYSIS' | 'CORRUPT_TRANSIENT_DRAFT';
    }>;

export type ContinuousEvaluationErrorCode = 'INVALID_EXPECTED_GROUP' | 'INVALID_PUBLICATION'
  | 'PUBLICATION_MUTATED' | 'DUPLICATE_OBSERVATION' | 'LATE_EVIDENCE' | 'SESSION_DOMAIN_MISMATCH'
  | 'PUBLICATION_AFTER_COMPLETION' | 'COMPLETION_MUTATED' | 'OWNERSHIP_VIOLATION'
  | 'FINALIZATION_BOUND_EXCEEDED' | 'UNRESOLVED_RESERVATION';

export class ContinuousEvaluationError extends Error {
  constructor(readonly code: ContinuousEvaluationErrorCode, detail = code as string) {
    super(detail);
    this.name = 'ContinuousEvaluationError';
  }
}

export function immutableContinuousValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) immutableContinuousValue(item);
    Object.freeze(value);
  }
  return value;
}
