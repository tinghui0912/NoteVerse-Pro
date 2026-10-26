type RecordingPreparationErrorCode =
  | 'RECORDING_PERMISSION_DENIED'
  | 'RECORDING_AUDIO_UNAVAILABLE'
  | 'RECORDING_VIDEO_UNAVAILABLE'
  | 'MEDIA_RECORDER_UNSUPPORTED'
  | 'VIDEO_RECORDER_UNSUPPORTED'
  | 'RECORDER_INIT_FAILED'
  | 'RECORDING_PREPARATION_CANCELLED';

/** Admission diagnostics contain stable codes, never browser exception text. */
export class RecordingPreparationError extends Error {
  constructor(readonly code: RecordingPreparationErrorCode) { super(code); this.name = 'RecordingPreparationError'; }
}

export function recordingPreparationError(error: unknown): RecordingPreparationError {
  if (error instanceof RecordingPreparationError) return error;
  if (error instanceof DOMException && error.name === 'NotAllowedError') return new RecordingPreparationError('RECORDING_PERMISSION_DENIED');
  if (error instanceof DOMException && ['NotFoundError', 'NotReadableError'].includes(error.name)) return new RecordingPreparationError('RECORDING_AUDIO_UNAVAILABLE');
  if (error instanceof Error && ['MEDIA_RECORDER_UNSUPPORTED', 'VIDEO_RECORDER_UNSUPPORTED'].includes(error.message)) {
    return new RecordingPreparationError(error.message as 'MEDIA_RECORDER_UNSUPPORTED' | 'VIDEO_RECORDER_UNSUPPORTED');
  }
  return new RecordingPreparationError('RECORDER_INIT_FAILED');
}
