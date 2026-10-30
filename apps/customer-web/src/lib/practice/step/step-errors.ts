import type { PracticeCausalFailure } from '@/lib/practice/failure/causal-failure';

export type StepApplicationErrorCode = 'STEP_SCORE_UNAVAILABLE'
  | 'PRACTICE_ENVIRONMENT_NOT_READY'
  | 'STEP_MIDI_PERMISSION_DENIED' | 'NO_CONNECTED_INPUT' | 'STEP_MIDI_UNAVAILABLE'
  | 'STEP_MICROPHONE_PERMISSION_DENIED' | 'STEP_MICROPHONE_UNAVAILABLE' | 'STEP_ACOUSTIC_PREPARATION_FAILED'
  | 'STEP_MICROPHONE_INFRASTRUCTURE_FAILED'
  | 'STEP_MICROPHONE_INTERRUPTED'
  | 'STEP_ACOUSTIC_RUNTIME_FAILED'
  | 'STEP_ATTEMPT_FAILED' | 'STEP_RESOURCE_CLEANUP_FAILED';
export const STEP_ERROR_MESSAGES: Readonly<Record<StepApplicationErrorCode, string>> = Object.freeze({
  STEP_SCORE_UNAVAILABLE: 'The score is unavailable.',
  PRACTICE_ENVIRONMENT_NOT_READY: 'Prepare the practice environment before starting.',
  STEP_MIDI_PERMISSION_DENIED: 'MIDI permission was denied.',
  NO_CONNECTED_INPUT: 'Connect a MIDI input to continue.',
  STEP_MIDI_UNAVAILABLE: 'MIDI input is unavailable.',
  STEP_MICROPHONE_PERMISSION_DENIED: 'Microphone permission was denied.',
  STEP_MICROPHONE_UNAVAILABLE: 'Microphone input is unavailable.',
  STEP_ACOUSTIC_PREPARATION_FAILED: 'Microphone analysis could not be prepared.',
  STEP_MICROPHONE_INFRASTRUCTURE_FAILED: 'Microphone audio is unavailable.',
  STEP_MICROPHONE_INTERRUPTED: 'Microphone input is temporarily interrupted.',
  STEP_ACOUSTIC_RUNTIME_FAILED: 'Microphone analysis failed. Start a new session.',
  STEP_ATTEMPT_FAILED: 'The attempt could not be completed.',
  STEP_RESOURCE_CLEANUP_FAILED: 'Practice resources could not be released.',
});
/** Pure STEP consequence policy. Invariant/unknown failures use the caller's generic mode outcome. */
export function projectStepFailure(failure: PracticeCausalFailure, phase: 'PREPARING' | 'ACTIVE'): StepApplicationErrorCode {
  switch (failure.kind) {
    case 'SOURCE': return 'STEP_SCORE_UNAVAILABLE';
    case 'MIDI': return failure.code === 'PERMISSION_DENIED' ? 'STEP_MIDI_PERMISSION_DENIED'
      : failure.code === 'NO_CONNECTED_INPUT' ? 'NO_CONNECTED_INPUT' : 'STEP_MIDI_UNAVAILABLE';
    case 'DEVICE': return failure.resource === 'MICROPHONE' && failure.code === 'PERMISSION_DENIED' ? 'STEP_MICROPHONE_PERMISSION_DENIED'
      : phase === 'ACTIVE' ? 'STEP_MICROPHONE_INFRASTRUCTURE_FAILED' : 'STEP_MICROPHONE_UNAVAILABLE';
    case 'AUDIO_CONTEXT': case 'CAPTURE': return 'STEP_MICROPHONE_INFRASTRUCTURE_FAILED';
    case 'ACOUSTIC':
      if (failure.code === 'ENVIRONMENT_NOT_READY') return 'PRACTICE_ENVIRONMENT_NOT_READY';
      if (failure.code === 'SOURCE_RATE_UNSUPPORTED') return 'STEP_MICROPHONE_INFRASTRUCTURE_FAILED';
      return phase === 'ACTIVE' ? 'STEP_ACOUSTIC_RUNTIME_FAILED' : 'STEP_ACOUSTIC_PREPARATION_FAILED';
    case 'INFERENCE': return phase === 'ACTIVE' ? 'STEP_ACOUSTIC_RUNTIME_FAILED' : 'STEP_ACOUSTIC_PREPARATION_FAILED';
    case 'RECORDING': return 'STEP_ATTEMPT_FAILED';
  }
}
