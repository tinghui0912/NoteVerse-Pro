export type ContinuousErrorCode =
  | 'MICROPHONE_PERMISSION_DENIED' | 'MICROPHONE_SOURCE_LOST' | 'AUDIO_CONTEXT_INTERRUPTED'
  | 'MODEL_ASSET_UNAVAILABLE' | 'WEBGPU_UNAVAILABLE' | 'MODEL_LOAD_FAILED'
  | 'UNQUALIFIED_SOURCE_RATE' | 'ANALYSIS_FAILED' | 'RECORDER_UNAVAILABLE' | 'RESOURCE_CLEANUP_FAILED';

/** Public categories never contain exception messages, URLs or stacks. */
export function continuousErrorCode(cause: unknown, fallback: ContinuousErrorCode): ContinuousErrorCode {
  const message = cause instanceof Error ? `${cause.name}:${cause.message}` : String(cause);
  if (/NotAllowedError|PermissionDenied/.test(message)) return 'MICROPHONE_PERMISSION_DENIED';
  if (/NotFoundError|NotReadableError/.test(message)) return 'MICROPHONE_SOURCE_LOST';
  if (/MICROPHONE_SOURCE_LOST/.test(message)) return 'MICROPHONE_SOURCE_LOST';
  if (/AUDIO_CONTEXT_INTERRUPTED/.test(message)) return 'AUDIO_CONTEXT_INTERRUPTED';
  if (/SOURCE_SAMPLE_RATE|SOURCE_RATE/.test(message)) return 'UNQUALIFIED_SOURCE_RATE';
  if (/WEBGPU|GPU_UNAVAILABLE|GPU_NOT/.test(message)) return 'WEBGPU_UNAVAILABLE';
  if (/ASSET|MODEL_IDENTITY|MODEL_HASH|MODEL_BYTE/.test(message)) return 'MODEL_ASSET_UNAVAILABLE';
  if (/RECORDER|RECORDING/.test(message)) return 'RECORDER_UNAVAILABLE';
  return fallback;
}

export const continuousErrorMessageKeys = {
  MICROPHONE_PERMISSION_DENIED: 'micPermissionDenied', MICROPHONE_SOURCE_LOST: 'micSourceLost',
  AUDIO_CONTEXT_INTERRUPTED: 'micContextInterrupted', MODEL_ASSET_UNAVAILABLE: 'micModelUnavailable',
  WEBGPU_UNAVAILABLE: 'micWebGpuUnavailable', MODEL_LOAD_FAILED: 'micModelUnavailable',
  UNQUALIFIED_SOURCE_RATE: 'micSourceRateUnavailable', ANALYSIS_FAILED: 'micAnalysisFailed',
  RECORDER_UNAVAILABLE: 'micRecorderUnavailable', RESOURCE_CLEANUP_FAILED: 'micCleanupFailed',
} as const satisfies Record<ContinuousErrorCode, string>;
