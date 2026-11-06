import { ACOUSTIC_RUNTIME_CONTRACT as M } from '../generated/runtime-contract';
import { fail } from '../errors';
import type { AcousticWindow } from '../runtime/window-planner';

export function assertWindowGeometry(w: AcousticWindow): void {
  // Repeat the planner construction from the stored operand, not a recovered residual.
  const expectedEndSample = Math.round(w.ownedEndTarget + M.window.futureContextSamples);
  if(w.ownedEndTarget <= w.ownedStartTarget || w.ownedEndTarget > w.ownedStartTarget + M.window.ownedSamples
    || w.endSample - w.startSample !== M.input.shape[1]
    || w.endSample !== expectedEndSample) fail('ACOUSTIC_WORKER_WINDOW_MISMATCH');
}

export function assertModelNames(inputNames: readonly string[] | undefined, outputNames: readonly string[] | undefined): void {
  if(inputNames?.join() !== M.input.name || outputNames?.join() !== M.outputs.map(output => output.name).join()) fail('ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH');
}
export function checkedOutput(tensor: { dims: readonly number[]; data: ArrayLike<number> } | undefined): Float32Array {
  if(!tensor || tensor.dims.join() !== M.outputs[0].shape.join() || tensor.data.length !== M.outputs[0].shape.reduce<number>((size, dimension) => size * dimension, 1)) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  const data = Float32Array.from(tensor.data);
  if (data.some(v => !Number.isFinite(v))) fail('ACOUSTIC_NONFINITE_OUTPUT');
  return data;
}
