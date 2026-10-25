import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment, ContinuousStrikeAssignment, ContinuousGroupAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousInterpretation, ContinuousInterpretationPolicyId, MidiGroupFeedback, MidiStrikeFeedback, AcousticGroupFeedback } from '@/lib/practice/continuous/domain/evaluation/interpretation-types';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';

export function interpretationPolicyForInputSource(inputSource: PracticeInputSource): ContinuousInterpretationPolicyId {
  return inputSource === 'MIDI' ? 'MIDI_PHYSICAL_NOTE_EVENTS_V1' as const : 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1' as const;
}
const strikeIdentity = (strike: ContinuousStrikeAssignment) => ({
  strikeId: strike.strikeId, groupId: strike.groupId, pitch: strike.pitch,
  expectedPerformanceTimeMs: strike.expectedPerformanceTimeMs, renderNoteIds: strike.renderNoteIds,
});
function midiGroup(group: ContinuousGroupAssignment): MidiGroupFeedback {
  const strikes = group.strikes.map((strike): MidiStrikeFeedback => {
    const identity = strikeIdentity(strike);
    if (strike.state === 'MATCHED') return { ...identity, state: 'CORRECT', timingOffsetMs: strike.match.timingOffsetMs };
    if (strike.state !== 'UNMATCHED') return { ...identity, state: strike.state };
    const residual = group.residualAssignments.find(row => row.strikeId === strike.strikeId);
    return residual ? { ...identity, state: 'WRONG', observation: residual.observation, timingOffsetMs: residual.timingOffsetMs }
      : { ...identity, state: 'MISSING' };
  });
  const verdict = group.state === 'PENDING' ? 'PENDING'
    : strikes.some(strike => strike.state === 'NOT_REACHED') ? 'NOT_REACHED'
      : strikes.every(strike => strike.state === 'CORRECT') ? 'CORRECT'
        : strikes.some(strike => strike.state === 'WRONG') ? 'WRONG'
          : strikes.some(strike => strike.state === 'CORRECT') ? 'INCOMPLETE_CHORD' : 'MISSING';
  return { groupId: group.groupId, verdict, strikes };
}
function acousticGroup(group: ContinuousGroupAssignment): AcousticGroupFeedback {
  const matched = group.strikes.filter(strike => strike.state === 'MATCHED').length;
  const verdict = group.state === 'PENDING' ? 'PENDING'
    : group.strikes.some(strike => strike.state === 'NOT_REACHED') ? 'NOT_REACHED'
      : matched === group.strikes.length ? 'SUPPORTED' : matched ? 'PARTIALLY_SUPPORTED' : 'UNCONFIRMED';
  return { groupId: group.groupId, verdict, strikes: group.strikes.map(strike => ({ ...strikeIdentity(strike),
    timingOffsetMs: strike.state === 'MATCHED' ? strike.match.timingOffsetMs : null,
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
