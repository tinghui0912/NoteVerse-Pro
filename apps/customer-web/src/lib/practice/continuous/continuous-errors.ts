import { acousticFailureCode, type AcousticFailureCode } from '@/lib/practice/acoustic/source/microphone-errors';
export type ContinuousErrorCode =
  | Exclude<AcousticFailureCode, 'SOURCE_SAMPLE_RATE_NOT_QUALIFIED' | 'ACOUSTIC_WORKER_CRASH' | 'ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED' | 'ACOUSTIC_CAPTURE_FAILURE'>
  | 'UNQUALIFIED_SOURCE_RATE' | 'ANALYSIS_FAILED' | 'RECORDER_UNAVAILABLE' | 'RESOURCE_CLEANUP_FAILED';

/** Public categories never contain exception messages, URLs or stacks. */
export function continuousErrorCode(cause: unknown, fallback: ContinuousErrorCode): ContinuousErrorCode {
  const message = cause instanceof Error ? `${cause.name}:${cause.message}` : String(cause);
  const shared = acousticFailureCode(cause);
  if (shared === 'SOURCE_SAMPLE_RATE_NOT_QUALIFIED') return 'UNQUALIFIED_SOURCE_RATE';
  if (shared && !['ACOUSTIC_WORKER_CRASH', 'ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED', 'ACOUSTIC_CAPTURE_FAILURE'].includes(shared)) return shared as ContinuousErrorCode;
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
