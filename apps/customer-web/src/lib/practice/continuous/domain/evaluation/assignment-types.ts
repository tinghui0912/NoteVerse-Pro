import type { ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
export type ContinuousExpectedStrike = Readonly<{
  strikeId: string;
  groupId: string;
  pitch: string;
  expectedPerformanceTimeMs: number;
  renderNoteIds: readonly string[];
}>;
export type ContinuousFinality = Readonly<{
  requiredAnalysisFrontierMs: number;
  unclampedRequiredFrontierMs: number;
  enablingPublicationId: string;
  enablingAnalysisFrontierMs: number;
  /** Knowledge availability in Session Time; all frontier fields above use Performance Time. */
  finalizationSessionTimeMs: number;
  terminalClamp: boolean;
}>;
export type ContinuousCompletion = Readonly<{
  reason: 'SCOPE_COMPLETED' | 'STOPPED_BY_USER';
  performanceTimeMs: number;
  availabilitySessionTimeMs: number;
}>;
export type ContinuousStrikeAssignment = ContinuousExpectedStrike & (
  | Readonly<{ state: 'PENDING' }>
  | Readonly<{ state: 'MATCHED'; match: Readonly<{ observation: ContinuousObservation; timingOffsetMs: number }>; finality: ContinuousFinality }>
  | Readonly<{ state: 'UNMATCHED' | 'NOT_REACHED'; finality: ContinuousFinality }>
);
export type FinalizedContinuousStrikeAssignment = Exclude<ContinuousStrikeAssignment, { state: 'PENDING' }>;
export type ContinuousGroupAssignment = Readonly<{ groupId: string; performanceTimeMs: number }> & (
  | Readonly<{ state: 'PENDING'; strikes: readonly ContinuousStrikeAssignment[]; finality: null }>
  | Readonly<{ state: 'FINALIZED'; strikes: readonly FinalizedContinuousStrikeAssignment[]; finality: ContinuousFinality }>
);
export type FinalizedContinuousGroupAssignment = Extract<ContinuousGroupAssignment, { state: 'FINALIZED' }>;
export type UnattributedContinuousObservation = Readonly<{ observation: ContinuousObservation; finality: ContinuousFinality }>;
export type ContinuousObservationAssignment =
  | Readonly<{ kind: 'STRIKE_MATCH'; observationId: string; strikeId: string }>
  | Readonly<{ kind: 'UNATTRIBUTED'; observationId: string }>;
export type ContinuousAssignmentSnapshot = Readonly<{
  sessionDomainId: string;
  analyzedThroughPerformanceMs: number | null;
  observations: readonly ContinuousObservation[];
  groups: readonly ContinuousGroupAssignment[];
  unattributedObservations: readonly UnattributedContinuousObservation[];
  observationAssignments: readonly ContinuousObservationAssignment[];
  reservedObservationIds: readonly string[];
  completion: ContinuousCompletion | null;
}>;
export type CompletedContinuousAssignment = Readonly<{
  sessionDomainId: string;
  observations: readonly ContinuousObservation[];
  groups: readonly FinalizedContinuousGroupAssignment[];
  unattributedObservations: readonly UnattributedContinuousObservation[];
  observationAssignments: readonly ContinuousObservationAssignment[];
  completion: ContinuousCompletion;
}>;
export type CompletedContinuousAssignmentResult =
  | Readonly<{ status: 'COMPLETE'; assignment: CompletedContinuousAssignment }>
  | Readonly<{ status: 'UNAVAILABLE'; reason: 'INCOMPLETE_ANALYSIS' }>;

/** Source-blind read-only target identity/state: no group summary or evidence payload. */
export type ContinuousTargetState = Readonly<{
  strikeId: string; renderNoteIds: readonly string[]; state: ContinuousStrikeAssignment['state'];
}>;
