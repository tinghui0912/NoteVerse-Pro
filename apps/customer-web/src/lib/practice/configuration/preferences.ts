import type { PracticeMode } from '@/lib/practice/planning/intent';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';

export type PracticePreferenceProfile = Readonly<{
  schemaVersion: 1;
  mode: PracticeMode | null;
  inputSource: PracticeInputSource | null;
  continuous: Readonly<{ recordingMode: PracticeRecordingMode | null; liveFeedbackEnabled: boolean }>;
}>;
export type PracticeConfiguration = Readonly<{
  mode: PracticeMode; inputSource: PracticeInputSource; recordingMode: PracticeRecordingMode; liveFeedbackEnabled: boolean;
}>;
export const emptyPracticePreferences: PracticePreferenceProfile = Object.freeze({
  schemaVersion: 1, mode: null, inputSource: null,
  continuous: Object.freeze({ recordingMode: null, liveFeedbackEnabled: false }),
});
export function resolvePracticeConfiguration(profile: PracticePreferenceProfile):
  | { status: 'COMPLETE'; configuration: PracticeConfiguration }
  | { status: 'INCOMPLETE'; missing: readonly ('MODE' | 'INPUT_SOURCE' | 'CONTINUOUS_RECORDING_MODE')[] } {
  const missing: ('MODE' | 'INPUT_SOURCE' | 'CONTINUOUS_RECORDING_MODE')[] = [];
  if (!profile.mode) missing.push('MODE');
  if (!profile.inputSource) missing.push('INPUT_SOURCE');
  if (profile.mode === 'CONTINUOUS_PLAY' && !profile.continuous.recordingMode) missing.push('CONTINUOUS_RECORDING_MODE');
  if (missing.length) return { status: 'INCOMPLETE', missing };
  return { status: 'COMPLETE', configuration: Object.freeze({ mode: profile.mode!, inputSource: profile.inputSource!,
    recordingMode: profile.mode === 'STEP_BY_STEP' ? 'OFF' : profile.continuous.recordingMode!,
    liveFeedbackEnabled: profile.continuous.liveFeedbackEnabled }) };
}
