import { fail } from './model-contract';

export function assertModelNames(inputNames: readonly string[] | undefined, outputNames: readonly string[] | undefined): void {
  if (inputNames?.join() !== 'audio' || outputNames?.join() !== 'reg_onset_output,frame_output') fail('ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH');
}
export function checkedOutput(tensor: { dims: readonly number[]; data: ArrayLike<number> } | undefined): Float32Array {
  if (!tensor || tensor.dims.join() !== '1,183,88' || tensor.data.length !== 183 * 88) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  const data = Float32Array.from(tensor.data);
  if (data.some(v => !Number.isFinite(v))) fail('ACOUSTIC_NONFINITE_OUTPUT');
  return data;
}
