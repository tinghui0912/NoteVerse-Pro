export type RecordingRuntimeFailureReason = 'AUDIO_TRACK_MUTED' | 'VIDEO_TRACK_MUTED'
  | 'AUDIO_TRACK_ENDED' | 'VIDEO_TRACK_ENDED' | 'MEDIA_RECORDER_ERROR'
  | 'RECORDER_START_FAILED' | 'RECORDER_PAUSE_FAILED' | 'RECORDER_RESUME_FAILED' | 'RECORDER_NOT_ACTIVE';
export type RecordingRuntimeFault = Readonly<{
  reason: RecordingRuntimeFailureReason;
  recoverability: 'SAME_PIPELINE_RECOVERABLE' | 'RESTART_REQUIRED';
}>;
