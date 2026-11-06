import type { PracticeCausalFailure } from '@/lib/practice/failure/causal-failure';
export type ContinuousErrorCode = 'MICROPHONE_PERMISSION_DENIED' | 'MICROPHONE_SOURCE_LOST' | 'AUDIO_CONTEXT_INTERRUPTED'
  | 'MODEL_ASSET_UNAVAILABLE' | 'WEBGPU_UNAVAILABLE' | 'MODEL_LOAD_FAILED' | 'UNQUALIFIED_SOURCE_RATE' | 'ANALYSIS_FAILED'
  | 'RECORDER_UNAVAILABLE' | 'RECORDING_PREPARATION_FAILED' | 'RESOURCE_CLEANUP_FAILED' | 'PRACTICE_ENVIRONMENT_NOT_READY'
  | 'NO_CONNECTED_INPUT' | 'MIDI_PERMISSION_DENIED' | 'MIDI_UNAVAILABLE' | 'SCORE_UNAVAILABLE';

/** An application-owned failure is already a consequence, not an external cause. */
export class ContinuousApplicationFailure extends Error {
  constructor(readonly code: ContinuousErrorCode, options?: ErrorOptions) { super(code, options); }
}

/** Cause is independent of the mode's intervention, transport and degradation policy. */
export function projectContinuousFailure(failure: PracticeCausalFailure, phase: 'PREPARING' | 'ACTIVE'): ContinuousErrorCode {
  switch (failure.kind) {
    case 'BUNDLE': return 'SCORE_UNAVAILABLE';
    case 'MIDI': return failure.code === 'PERMISSION_DENIED' ? 'MIDI_PERMISSION_DENIED'
      : failure.code === 'NO_CONNECTED_INPUT' ? 'NO_CONNECTED_INPUT' : 'MIDI_UNAVAILABLE';
    case 'DEVICE': return failure.resource === 'CAMERA' ? 'RECORDER_UNAVAILABLE'
      : failure.code === 'PERMISSION_DENIED' ? 'MICROPHONE_PERMISSION_DENIED' : 'MICROPHONE_SOURCE_LOST';
    case 'AUDIO_CONTEXT': return 'AUDIO_CONTEXT_INTERRUPTED';
    case 'CAPTURE': case 'INFERENCE': return phase === 'PREPARING' ? 'MODEL_LOAD_FAILED' : 'ANALYSIS_FAILED';
    case 'ACOUSTIC':
      switch (failure.code) {
        case 'SOURCE_RATE_UNSUPPORTED': return 'UNQUALIFIED_SOURCE_RATE';
        case 'MODEL_ASSET_UNAVAILABLE': case 'MODEL_IDENTITY_INVALID': return 'MODEL_ASSET_UNAVAILABLE';
        case 'WEBGPU_UNAVAILABLE': return 'WEBGPU_UNAVAILABLE';
        case 'MODEL_LOAD_FAILED': return 'MODEL_LOAD_FAILED';
        case 'ENVIRONMENT_NOT_READY': return 'PRACTICE_ENVIRONMENT_NOT_READY';
      }
    case 'RECORDING': return phase === 'PREPARING' ? 'RECORDING_PREPARATION_FAILED' : 'RECORDER_UNAVAILABLE';
  }
}

export const continuousErrorMessageKeys = {
  NO_CONNECTED_INPUT: 'midiNoConnectedInput', MIDI_PERMISSION_DENIED: 'midiStartFailed', MIDI_UNAVAILABLE: 'midiStartFailed',
  SCORE_UNAVAILABLE: 'scoreInvalid',
  RECORDING_PREPARATION_FAILED: 'recordingPreparationFailed',
  PRACTICE_ENVIRONMENT_NOT_READY: 'setupRequired',
  MICROPHONE_PERMISSION_DENIED: 'micPermissionDenied', MICROPHONE_SOURCE_LOST: 'micSourceLost',
  AUDIO_CONTEXT_INTERRUPTED: 'micContextInterrupted', MODEL_ASSET_UNAVAILABLE: 'micModelUnavailable',
  WEBGPU_UNAVAILABLE: 'micWebGpuUnavailable', MODEL_LOAD_FAILED: 'micModelUnavailable',
  UNQUALIFIED_SOURCE_RATE: 'micSourceRateUnavailable', ANALYSIS_FAILED: 'micAnalysisFailed',
  RECORDER_UNAVAILABLE: 'micRecorderUnavailable', RESOURCE_CLEANUP_FAILED: 'micCleanupFailed',
} as const satisfies Record<ContinuousErrorCode, string>;
