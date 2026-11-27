import type { PracticeScope } from "@/lib/practice/planning/scope";
import type { PracticeTempoSelection } from "@/lib/practice/planning/tempo";
import type { PracticeRecordingMode } from "@/lib/practice/recording/recording-mode";

export type PracticeMode = "STEP_BY_STEP" | "CONTINUOUS_PLAY";
export type PracticeInputSource = "MICROPHONE" | "MIDI";

type IntentChoices = Readonly<{
  inputSource: PracticeInputSource;
  scope: Readonly<PracticeScope>;
  tempoSelection: Readonly<PracticeTempoSelection>;
  metronomeEnabled: boolean;
}>;
export type PracticeIntent = IntentChoices &
  (
    | Readonly<{ mode: "STEP_BY_STEP"; recordingMode: "OFF" }>
    | Readonly<{
        mode: "CONTINUOUS_PLAY";
        recordingMode: PracticeRecordingMode;
      }>
  );
