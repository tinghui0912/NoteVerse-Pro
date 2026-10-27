import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
export type ContinuousInterpretationPolicyId = 'MIDI_PHYSICAL_NOTE_EVENTS_V2' | 'ACOUSTIC_TARGET_DETECTION_V2';
type FeedbackStrike<State extends string> = ContinuousExpectedStrike & Readonly<{ state: State; timingOffsetMs: number | null }>;
export type MidiStrikeFeedback = ContinuousExpectedStrike & (
  | Readonly<{ state: 'PENDING' | 'MISSING' | 'NOT_REACHED' }>
  | Readonly<{ state: 'CORRECT'; timingOffsetMs: number }>
);
type AcousticStrikeFeedback = FeedbackStrike<'PENDING' | 'SUPPORTED' | 'NOT_DETECTED' | 'NOT_REACHED'>;
export type MidiGroupFeedback = Readonly<{
  groupId: string; verdict: 'PENDING' | 'CORRECT' | 'MISSING' | 'INCOMPLETE_CHORD' | 'NOT_REACHED';
  strikes: readonly MidiStrikeFeedback[];
}>;
export type AcousticGroupFeedback = Readonly<{
  groupId: string; verdict: 'PENDING' | 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'NOT_DETECTED' | 'NOT_REACHED';
  strikes: readonly AcousticStrikeFeedback[];
}>;
export type MidiContinuousInterpretation = Readonly<{
  inputSource: 'MIDI'; interpretationPolicyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V2';
  groups: readonly MidiGroupFeedback[];
}>;
export type AcousticContinuousInterpretation = Readonly<{
  inputSource: 'MICROPHONE'; interpretationPolicyId: 'ACOUSTIC_TARGET_DETECTION_V2';
  groups: readonly AcousticGroupFeedback[];
}>;
export type ContinuousInterpretation = MidiContinuousInterpretation | AcousticContinuousInterpretation;
