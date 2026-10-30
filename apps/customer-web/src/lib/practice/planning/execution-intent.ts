import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { PracticeScope } from '@/lib/practice/kernel/scope';
import type { PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';

type IntentChoices = Readonly<{
  inputSource: PracticeInputSource;
  scope: Readonly<PracticeScope>;
  tempoSelection: Readonly<PracticeTempoSelection>;
  metronomeEnabled: boolean;
}>;
export type PracticeExecutionIntent = IntentChoices & (
  | Readonly<{ mode: 'STEP_BY_STEP'; recordingMode: 'OFF' }>
  | Readonly<{ mode: 'CONTINUOUS_PLAY'; recordingMode: PracticeRecordingMode }>
);
