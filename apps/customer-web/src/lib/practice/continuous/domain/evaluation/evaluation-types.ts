import type { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { MidiContinuousInterpretation, AcousticContinuousInterpretation } from '@/lib/practice/continuous/domain/evaluation/interpretation-types';
export type ContinuousEvaluationLayers<Assignment> =
  | Readonly<{ assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID; inputSource: 'MIDI'; interpretationPolicyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1'; assignment: Assignment; interpretation: MidiContinuousInterpretation }>
  | Readonly<{ assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID; inputSource: 'MICROPHONE'; interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1'; assignment: Assignment; interpretation: AcousticContinuousInterpretation }>;
export type ContinuousEvaluationSnapshot = ContinuousEvaluationLayers<ContinuousAssignmentSnapshot>;
export type ContinuousEvaluationUnavailableReason = 'CONTINUOUS_ANALYSIS_UNAVAILABLE' | 'INCOMPLETE_ANALYSIS';
export type UnavailableContinuousEvaluation = Readonly<{ status: 'UNAVAILABLE'; reason: ContinuousEvaluationUnavailableReason }> & (
  | Readonly<{ assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID; inputSource: 'MIDI'; interpretationPolicyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1' }>
  | Readonly<{ assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID; inputSource: 'MICROPHONE'; interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1' }>
);
export type CompletedContinuousEvaluation = (Readonly<{ status: 'COMPLETE' }> & ContinuousEvaluationLayers<CompletedContinuousAssignment>) | UnavailableContinuousEvaluation;
