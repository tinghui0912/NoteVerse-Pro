type MicrophoneInfrastructureErrorCode = 'MICROPHONE_PERMISSION_DENIED' | 'MICROPHONE_SOURCE_LOST' | 'AUDIO_CONTEXT_INTERRUPTED';
export type AcousticFailureCode = MicrophoneInfrastructureErrorCode | 'MODEL_ASSET_UNAVAILABLE' | 'WEBGPU_UNAVAILABLE'
  | 'MODEL_LOAD_FAILED' | 'SOURCE_SAMPLE_RATE_NOT_QUALIFIED' | 'ACOUSTIC_WORKER_CRASH'
  | 'ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED' | 'ACOUSTIC_CAPTURE_FAILURE';

/** Shared causal classification; presentation and transport consequences are mode-owned. */
export function acousticFailureCode(cause: unknown): AcousticFailureCode | null {
  const message = cause instanceof Error ? `${cause.name}:${cause.message}` : String(cause);
  if (/NotAllowedError|PermissionDenied/.test(message)) return 'MICROPHONE_PERMISSION_DENIED';
  if (/NotFoundError|NotReadableError|MICROPHONE_SOURCE_LOST/.test(message)) return 'MICROPHONE_SOURCE_LOST';
  if (/AUDIO_CONTEXT_INTERRUPTED/.test(message)) return 'AUDIO_CONTEXT_INTERRUPTED';
  if (/SOURCE_SAMPLE_RATE|SOURCE_RATE/.test(message)) return 'SOURCE_SAMPLE_RATE_NOT_QUALIFIED';
  if (/WEBGPU|GPU_UNAVAILABLE|GPU_NOT/.test(message)) return 'WEBGPU_UNAVAILABLE';
  if (/ASSET|MODEL_IDENTITY|MODEL_HASH|MODEL_BYTE/.test(message)) return 'MODEL_ASSET_UNAVAILABLE';
  if (/ACOUSTIC_WORKER_CRASH/.test(message)) return 'ACOUSTIC_WORKER_CRASH';
  if (/ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED/.test(message)) return 'ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED';
  if (/CAPTURE|WORKLET/.test(message)) return 'ACOUSTIC_CAPTURE_FAILURE';
  return null;
}
