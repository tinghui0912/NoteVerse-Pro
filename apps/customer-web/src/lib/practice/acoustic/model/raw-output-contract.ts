import { ACOUSTIC_RUNTIME_CONTRACT } from '../generated/runtime-contract';
/** Raw piano-head values are transaction-local, never application state. */
export type PianoRawOutputs = Readonly<{
  onset: Float32Array;
  onsetShape: readonly number[];
  frame: Float32Array;
  frameShape: readonly number[];
}>;
export const PIANO_OUTPUT_FRAME_RATE_HZ = ACOUSTIC_RUNTIME_CONTRACT.decoder.outputFrameRateHz;
export const PIANO_PITCH_COUNT = ACOUSTIC_RUNTIME_CONTRACT.outputs[0].shape[2];
