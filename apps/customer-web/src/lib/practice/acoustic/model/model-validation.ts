import { ACOUSTIC_MODEL as M, ACOUSTIC_TARGET_SAMPLES_PER_MS, fail } from './model-contract';
import type { AcousticWindow } from '../runtime/window-planner';

export function assertWindowGeometry(w: AcousticWindow): void {
  // Compare constructed endpoints, not a cancellation-sensitive recovered width.
  if (w.ownedEndTarget <= w.ownedStartTarget || w.ownedEndTarget > w.ownedStartTarget + M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS
    || w.endSample - w.startSample !== M.inputSamples
    || Math.abs(w.endSample - w.ownedEndTarget - M.futureMs * ACOUSTIC_TARGET_SAMPLES_PER_MS) > 1) fail('ACOUSTIC_WORKER_WINDOW_MISMATCH');
}

export function assertModelNames(inputNames: readonly string[] | undefined, outputNames: readonly string[] | undefined): void {
  if (inputNames?.join() !== 'audio' || outputNames?.join() !== 'reg_onset_output,frame_output') fail('ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH');
}
export function checkedOutput(tensor: { dims: readonly number[]; data: ArrayLike<number> } | undefined): Float32Array {
  if (!tensor || tensor.dims.join() !== '1,183,88' || tensor.data.length !== 183 * 88) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  const data = Float32Array.from(tensor.data);
  if (data.some(v => !Number.isFinite(v))) fail('ACOUSTIC_NONFINITE_OUTPUT');
  return data;
}
