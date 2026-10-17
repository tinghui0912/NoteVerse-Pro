/** Raw piano-head values are transaction-local, never application state. */
export type PianoRawOutputs = Readonly<{
  reg_onset_output: Float32Array;
  reg_onset_shape: readonly number[];
  frame_output: Float32Array;
  frame_shape: readonly number[];
}>;
export const PIANO_OUTPUT_FRAME_RATE_HZ = 100;
export const PIANO_PITCH_COUNT = 88;
