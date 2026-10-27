import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { CompletedContinuousAssignment, ContinuousStrikeAssignment, ContinuousGroupAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousInterpretation, ContinuousInterpretationPolicyId, MidiGroupFeedback, MidiStrikeFeedback, AcousticGroupFeedback } from '@/lib/practice/continuous/domain/evaluation/interpretation-types';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';

export function interpretationPolicyForInputSource(inputSource: PracticeInputSource): ContinuousInterpretationPolicyId {
  return inputSource === 'MIDI' ? 'MIDI_PHYSICAL_NOTE_EVENTS_V2' as const : 'ACOUSTIC_TARGET_DETECTION_V2' as const;
}
const strikeIdentity = (strike: ContinuousStrikeAssignment) => ({
  strikeId: strike.strikeId, groupId: strike.groupId, pitch: strike.pitch,
  expectedPerformanceTimeMs: strike.expectedPerformanceTimeMs, renderNoteIds: strike.renderNoteIds,
});
/** One target classification shared by live and completed interpretation. */
export function interpretContinuousTargetState(state: ContinuousStrikeAssignment['state'], inputSource: PracticeInputSource) {
  return state === 'MATCHED' ? inputSource === 'MIDI' ? 'CORRECT' as const : 'SUPPORTED' as const
    : state === 'UNMATCHED' ? inputSource === 'MIDI' ? 'MISSING' as const : 'NOT_DETECTED' as const : state;
}
function midiGroup(group: ContinuousGroupAssignment): MidiGroupFeedback {
  const strikes = group.strikes.map((strike): MidiStrikeFeedback => {
    const identity = strikeIdentity(strike);
    const state = interpretContinuousTargetState(strike.state, 'MIDI');
    if (strike.state === 'MATCHED') return { ...identity, state: state as 'CORRECT', timingOffsetMs: strike.match.timingOffsetMs };
    return { ...identity, state: state as 'PENDING' | 'MISSING' | 'NOT_REACHED' };
  });
  const verdict = group.state === 'PENDING' ? 'PENDING'
    : strikes.some(strike => strike.state === 'NOT_REACHED') ? 'NOT_REACHED'
      : strikes.every(strike => strike.state === 'CORRECT') ? 'CORRECT'
        : strikes.some(strike => strike.state === 'CORRECT') ? 'INCOMPLETE_CHORD' : 'MISSING';
  return { groupId: group.groupId, verdict, strikes };
}
function acousticGroup(group: ContinuousGroupAssignment): AcousticGroupFeedback {
  const matched = group.strikes.filter(strike => strike.state === 'MATCHED').length;
  const verdict = group.state === 'PENDING' ? 'PENDING'
    : group.strikes.some(strike => strike.state === 'NOT_REACHED') ? 'NOT_REACHED'
      : matched === group.strikes.length ? 'SUPPORTED' : matched ? 'PARTIALLY_SUPPORTED' : 'NOT_DETECTED';
  return { groupId: group.groupId, verdict, strikes: group.strikes.map(strike => ({ ...strikeIdentity(strike),
    timingOffsetMs: strike.state === 'MATCHED' ? strike.match.timingOffsetMs : null,
    state: interpretContinuousTargetState(strike.state, 'MICROPHONE') as 'PENDING' | 'SUPPORTED' | 'NOT_DETECTED' | 'NOT_REACHED' })) };
}
/** A pure projection of decoder-qualified evidence; no second assignment, timing calculation or uncalibrated confidence threshold. */
export function interpretContinuousAssignment(
  assignment: ContinuousAssignmentSnapshot | CompletedContinuousAssignment, inputSource: PracticeInputSource,
): ContinuousInterpretation {
  if (inputSource === 'MIDI') return immutableContinuousValue({ inputSource, interpretationPolicyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V2',
    groups: assignment.groups.map(midiGroup) });
  return immutableContinuousValue({ inputSource, interpretationPolicyId: 'ACOUSTIC_TARGET_DETECTION_V2', groups: assignment.groups.map(acousticGroup) });
}
