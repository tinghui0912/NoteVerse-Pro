import { ACOUSTIC_RUNTIME_CONTRACT as M } from '../generated/runtime-contract';

export const ACOUSTIC_RESOURCES = Object.freeze({
  maxOutstandingWindows: 4,
  diagnosticWindows: 32,
  targetRingSamples: 65536,
  inputBytes: M.input.shape[1] * Float32Array.BYTES_PER_ELEMENT,
  maxEventsPerWindow: M.outputs[0].shape[1] * M.outputs[0].shape[2],
  // Bounds rapid control changes as well as PCM; failure never changes transport.
  maxScheduledBoundaries: 8,
} as const);

export function retainCompact<T>(ring: T[], entry: T): void {
  if (ring.length === ACOUSTIC_RESOURCES.diagnosticWindows) ring.shift();
  ring.push(entry);
}
