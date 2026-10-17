import type { AcousticNoteEvent } from '../bytedance-contract';
import type { AcousticWindow } from './window-planner';

export type AcousticInferenceInput = Readonly<{ window: AcousticWindow; pcm: Float32Array }>;
export type AcousticInferenceResult = Readonly<{
  events: readonly AcousticNoteEvent[]; inferenceMs: number; decodeMs: number;
  actualSessionRunCount: number;
}>;
export interface AcousticInferencePort {
  run(input: AcousticInferenceInput): Promise<AcousticInferenceResult>;
  dispose(): Promise<void>;
  onFailure?(listener: (error: Error) => void): () => void;
}
