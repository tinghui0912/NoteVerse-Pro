import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { MidiContinuousInterpretation, AcousticContinuousInterpretation } from '@/lib/practice/continuous/domain/evaluation/interpretation-types';
export type ContinuousEvaluationLayers<Assignment> =
  | Readonly<{ inputSource: 'MIDI'; policyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1'; assignment: Assignment; interpretation: MidiContinuousInterpretation }>
  | Readonly<{ inputSource: 'MICROPHONE'; policyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1'; assignment: Assignment; interpretation: AcousticContinuousInterpretation }>;
export type ContinuousEvaluationSnapshot = ContinuousEvaluationLayers<ContinuousAssignmentSnapshot>;
export type ContinuousEvaluationUnavailableReason = 'CONTINUOUS_ANALYSIS_UNAVAILABLE' | 'INCOMPLETE_ANALYSIS' | 'CORRUPT_TRANSIENT_DRAFT';
export type UnavailableContinuousEvaluation = Readonly<{ status: 'UNAVAILABLE'; reason: ContinuousEvaluationUnavailableReason }> & (
  | Readonly<{ inputSource: 'MIDI'; policyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1' }>
  | Readonly<{ inputSource: 'MICROPHONE'; policyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1' }>
);
export type CompletedContinuousEvaluation = (Readonly<{ status: 'COMPLETE' }> & ContinuousEvaluationLayers<CompletedContinuousAssignment>) | UnavailableContinuousEvaluation;
