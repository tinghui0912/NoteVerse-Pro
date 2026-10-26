import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';

export interface StepMicrophonePlatform {
  acquireInference(signal: AbortSignal): Promise<AcousticInferencePort>;
  coefficients: typeof browserMicrophoneCapture.coefficients;
  workletUrl: string;
  connectCapture(options: Parameters<typeof browserMicrophoneCapture.connectCapture>[0]): Promise<{ stop(): void }>;
}
export function browserStepMicrophonePlatform(acquireInference: StepMicrophonePlatform['acquireInference']): StepMicrophonePlatform {
  return { ...browserMicrophoneCapture, acquireInference };
}
