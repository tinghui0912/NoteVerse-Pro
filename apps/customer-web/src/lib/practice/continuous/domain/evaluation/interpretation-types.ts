import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
export type ContinuousInterpretationPolicyId = 'MIDI_PHYSICAL_NOTE_EVENTS_V1' | 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1';
type FeedbackStrike<State extends string> = ContinuousExpectedStrike & Readonly<{ state: State; timingOffsetMs: number | null }>;
export type MidiStrikeFeedback = ContinuousExpectedStrike & (
  | Readonly<{ state: 'PENDING' | 'MISSING' | 'NOT_REACHED' }>
  | Readonly<{ state: 'CORRECT'; timingOffsetMs: number }>
  | Readonly<{ state: 'WRONG'; observation: ContinuousObservation; timingOffsetMs: number }>
);
export type AcousticStrikeFeedback = FeedbackStrike<'PENDING' | 'SUPPORTED' | 'UNCONFIRMED' | 'NOT_REACHED'>;
export type MidiGroupFeedback = Readonly<{
  groupId: string; verdict: 'PENDING' | 'CORRECT' | 'MISSING' | 'WRONG' | 'INCOMPLETE_CHORD' | 'NOT_REACHED';
  strikes: readonly MidiStrikeFeedback[];
}>;
export type AcousticGroupFeedback = Readonly<{
  groupId: string; verdict: 'PENDING' | 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNCONFIRMED' | 'NOT_REACHED';
  strikes: readonly AcousticStrikeFeedback[];
}>;
export type MidiContinuousInterpretation = Readonly<{
  inputSource: 'MIDI'; interpretationPolicyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1';
  groups: readonly MidiGroupFeedback[]; extraObservations: readonly ContinuousObservation[];
}>;
export type AcousticContinuousInterpretation = Readonly<{
  inputSource: 'MICROPHONE'; interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1';
  groups: readonly AcousticGroupFeedback[];
}>;
export type ContinuousInterpretation = MidiContinuousInterpretation | AcousticContinuousInterpretation;
