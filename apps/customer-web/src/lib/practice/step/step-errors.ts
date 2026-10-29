import { StepDomainError } from './domain/attempt';

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
export function stepApplicationError(error: unknown, inputSource: 'MIDI' | 'MICROPHONE' = 'MIDI',
  phase: 'PREPARING' | 'ACTIVE' = 'PREPARING'): StepApplicationErrorCode {
  if (error instanceof StepDomainError && error.code === 'STEP_TARGET_INVALID') return 'STEP_SCORE_UNAVAILABLE';
  const message = error instanceof Error ? error.message : '';
  if (Object.hasOwn(STEP_ERROR_MESSAGES, message)) return message as StepApplicationErrorCode;
  if (inputSource === 'MICROPHONE') {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError') {
      return 'STEP_MICROPHONE_PERMISSION_DENIED';
    }
    if (/CONTEXT|CAPTURE|SOURCE_LOST|SAMPLE_RATE/.test(message)
      || message === 'STEP_MICROPHONE_SOURCE_MAPPING_INVALID' || message === 'NONCHRONOLOGICAL_ACOUSTIC_SOURCE') return 'STEP_MICROPHONE_INFRASTRUCTURE_FAILED';
    return phase === 'ACTIVE' ? 'STEP_ACOUSTIC_RUNTIME_FAILED' : 'STEP_ACOUSTIC_PREPARATION_FAILED';
  }
  if (error instanceof Error && error.name === 'NotAllowedError') return 'STEP_MIDI_PERMISSION_DENIED';
  return 'STEP_MIDI_UNAVAILABLE';
}
