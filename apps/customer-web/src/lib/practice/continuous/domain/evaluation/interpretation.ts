import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment, ContinuousStrikeAssignment, ContinuousGroupAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousInterpretation, ContinuousInterpretationPolicyId, MidiGroupFeedback, AcousticGroupFeedback } from '@/lib/practice/continuous/domain/evaluation/interpretation-types';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';

export function interpretationPolicyForInputSource(inputSource: PracticeInputSource): ContinuousInterpretationPolicyId {
  return inputSource === 'MIDI' ? 'MIDI_PHYSICAL_NOTE_EVENTS_V1' as const : 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1' as const;
}
const strikeIdentity = (strike: ContinuousStrikeAssignment) => ({
  strikeId: strike.strikeId, groupId: strike.groupId, pitch: strike.pitch,
  expectedPerformanceTimeMs: strike.expectedPerformanceTimeMs, renderNoteIds: strike.renderNoteIds,
  timingOffsetMs: strike.state === 'MATCHED' ? strike.match.timingOffsetMs : null,
});
function midiGroup(group: ContinuousGroupAssignment): MidiGroupFeedback {
  const matched = group.strikes.filter(strike => strike.state === 'MATCHED').length;
  const verdict = group.state === 'PENDING' ? 'PENDING'
    : group.strikes.some(strike => strike.state === 'NOT_REACHED') ? 'NOT_REACHED'
      : matched === group.strikes.length ? 'CORRECT'
        : group.residualObservations.length ? 'WRONG' : matched ? 'INCOMPLETE_CHORD' : 'MISSING';
  return { groupId: group.groupId, verdict, wrongObservations: group.residualObservations,
    strikes: group.strikes.map(strike => ({ ...strikeIdentity(strike),
      state: strike.state === 'MATCHED' ? 'CORRECT' : strike.state === 'UNMATCHED' ? 'MISSING' : strike.state })) };
}
function acousticGroup(group: ContinuousGroupAssignment): AcousticGroupFeedback {
  const matched = group.strikes.filter(strike => strike.state === 'MATCHED').length;
  const verdict = group.state === 'PENDING' ? 'PENDING'
    : group.strikes.some(strike => strike.state === 'NOT_REACHED') ? 'NOT_REACHED'
      : matched === group.strikes.length ? 'SUPPORTED' : matched ? 'PARTIALLY_SUPPORTED' : 'UNCONFIRMED';
  return { groupId: group.groupId, verdict, strikes: group.strikes.map(strike => ({ ...strikeIdentity(strike),
    state: strike.state === 'MATCHED' ? 'SUPPORTED' : strike.state === 'UNMATCHED' ? 'UNCONFIRMED' : strike.state })) };
}
/** A pure projection of decoder-qualified evidence; no second assignment, timing calculation or uncalibrated confidence threshold. */
export function interpretContinuousAssignment(
  assignment: ContinuousAssignmentSnapshot | CompletedContinuousAssignment, inputSource: PracticeInputSource,
): ContinuousInterpretation {
  if (inputSource === 'MIDI') return immutableContinuousValue({ inputSource, policyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1',
    groups: assignment.groups.map(midiGroup), extraObservations: assignment.unattributedObservations.map(row => row.observation) });
  return immutableContinuousValue({ inputSource, policyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', groups: assignment.groups.map(acousticGroup) });
}
