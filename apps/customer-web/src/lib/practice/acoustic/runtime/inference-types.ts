import type { AcousticWindow } from './window-planner';

export type AcousticInferenceInput = Readonly<{ window: AcousticWindow; pcm: Float32Array }>;
export type DecodedAcousticEvent = Readonly<{
  pitch: string; midiPitch: number; targetSample: number;
  confidence: number; onsetScore: number; frameScore: number;
}>;
export type AcousticInferenceResult = Readonly<{
  events: readonly DecodedAcousticEvent[]; inferenceMs: number; decodeMs: number;
  actualSessionRunCount: number;
}>;
export interface AcousticInferencePort {
  run(input: AcousticInferenceInput): Promise<AcousticInferenceResult>;
  dispose(): Promise<void>;
  onFailure?(listener: (error: Error) => void): () => void;
}
