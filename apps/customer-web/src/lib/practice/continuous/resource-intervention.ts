import type { RecordingRuntimeFailureReason } from '@/lib/practice/recording/recording-runtime-fault';
export type PracticeResourceImpact = 'RECORDING_ONLY' | 'INPUT_REQUIRED' | 'INPUT_AND_RECORDING';
export type PracticeResourceIntervention = Readonly<{
  impact: PracticeResourceImpact;
  reason: RecordingRuntimeFailureReason | 'MICROPHONE_SOURCE_LOST' | 'AUDIO_CONTEXT_INTERRUPTED' | 'CAPTURE_PIPELINE_INVALID' | 'NO_CONNECTED_INPUT';
  recoverability: 'SAME_PIPELINE_RECOVERABLE' | 'RESTART_REQUIRED';
  state: 'WAITING_FOR_USER' | 'RECOVERED_WAITING_FOR_USER';
  pauseOrigin: 'INTERVENTION' | 'USER';
}>;
