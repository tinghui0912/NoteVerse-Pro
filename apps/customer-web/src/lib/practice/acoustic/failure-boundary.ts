import { AcousticFailure, CaptureFailure, InferenceFailure, isPracticeCausalFailure } from '@/lib/practice/failure/causal-failure';
import { AcousticAnalysisError } from './model/model-contract';

export function acousticBoundaryFailure(cause: unknown): Error {
  if (isPracticeCausalFailure(cause)) return cause;
  if (cause instanceof AcousticAnalysisError) {
    switch (cause.code) {
      case 'SOURCE_SAMPLE_RATE_NOT_QUALIFIED': return new AcousticFailure('SOURCE_RATE_UNSUPPORTED', { cause });
      case 'ACOUSTIC_MODEL_ASSET_UNAVAILABLE': return new AcousticFailure('MODEL_ASSET_UNAVAILABLE', { cause });
      case 'ACOUSTIC_MODEL_IDENTITY_MISMATCH': case 'ACOUSTIC_IDENTITY_DRIFT': case 'FIR_IDENTITY_MISMATCH': case 'SOURCE_ADAPTER_IDENTITY_MISMATCH':
        return new AcousticFailure('MODEL_IDENTITY_INVALID', { cause });
      case 'ACOUSTIC_WEBGPU_UNAVAILABLE': return new AcousticFailure('WEBGPU_UNAVAILABLE', { cause });
      case 'ACOUSTIC_MODEL_LOAD_FAILED': return new AcousticFailure('MODEL_LOAD_FAILED', { cause });
      case 'ACOUSTIC_WORKER_CRASH': return new InferenceFailure('WORKER_CRASH', { cause });
      case 'ACOUSTIC_WORKER_RPC_TIMEOUT': return new InferenceFailure('WORKER_TIMEOUT', { cause });
      case 'ACOUSTIC_WORKER_MESSAGE_ERROR': case 'UNEXPECTED_WORKER_RESPONSE': case 'ACOUSTIC_WORKER_INTERNAL_FAILURE':
        return new InferenceFailure('PROTOCOL_INVALID', { cause });
      case 'ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED': return new InferenceFailure('BACKPRESSURE_EXCEEDED', { cause });
      case 'ACOUSTIC_INFERENCE_FAILED': return new InferenceFailure('RUNTIME_FAILED', { cause });
      case 'ACOUSTIC_PUBLICATION_SINK_FAILED': return isPracticeCausalFailure(cause.cause) ? cause.cause : cause;
      case 'CAPTURE_CHRONOLOGY_VIOLATION': case 'CAPTURE_CONTEXT_FRAME_GAP':
      case 'NONCHRONOLOGICAL_ACOUSTIC_SOURCE': case 'INVALID_ACOUSTIC_CAPTURE_BLOCK':
        return new CaptureFailure('SOURCE_MAPPING_INVALID', { cause });
    }
  }
  return cause instanceof Error ? cause : new Error('Unexpected acoustic boundary failure', { cause });
}
