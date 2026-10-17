export type StepApplicationErrorCode = 'STEP_ANALYSIS_UNAVAILABLE' | 'STEP_SCORE_UNAVAILABLE'
  | 'STEP_MIDI_PERMISSION_DENIED' | 'NO_CONNECTED_INPUT' | 'STEP_MIDI_UNAVAILABLE'
  | 'STEP_ATTEMPT_FAILED' | 'STEP_HISTORY_LIMIT_EXCEEDED' | 'STEP_RESOURCE_CLEANUP_FAILED';
export const STEP_ERROR_MESSAGES: Readonly<Record<StepApplicationErrorCode, string>> = Object.freeze({
  STEP_ANALYSIS_UNAVAILABLE: 'Microphone attempt analysis is unavailable.',
  STEP_SCORE_UNAVAILABLE: 'The score is unavailable.',
  STEP_MIDI_PERMISSION_DENIED: 'MIDI permission was denied.',
  NO_CONNECTED_INPUT: 'Connect a MIDI input to continue.',
  STEP_MIDI_UNAVAILABLE: 'MIDI input is unavailable.',
  STEP_ATTEMPT_FAILED: 'The attempt could not be completed.',
  STEP_HISTORY_LIMIT_EXCEEDED: 'This session reached its attempt-history limit. Start a new session.',
  STEP_RESOURCE_CLEANUP_FAILED: 'Practice resources could not be released.',
});
export function stepApplicationError(error: unknown): StepApplicationErrorCode {
  const message = error instanceof Error ? error.message : '';
  if (Object.hasOwn(STEP_ERROR_MESSAGES, message)) return message as StepApplicationErrorCode;
  if (error instanceof Error && error.name === 'NotAllowedError') return 'STEP_MIDI_PERMISSION_DENIED';
  return 'STEP_MIDI_UNAVAILABLE';
}
