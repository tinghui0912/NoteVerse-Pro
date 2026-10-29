import { ACOUSTIC_MODEL as M } from '../model/model-contract';

export const ACOUSTIC_RESOURCES = Object.freeze({
  maxOutstandingWindows: 4,
  diagnosticWindows: 32,
  targetRingSamples: 65536,
  inputBytes: M.inputSamples * Float32Array.BYTES_PER_ELEMENT,
  maxEventsPerWindow: 183 * 88,
  // Bounds rapid control changes as well as PCM; failure never changes transport.
  maxScheduledBoundaries: 8,
} as const);

export function retainCompact<T>(ring: T[], entry: T): void {
  if (ring.length === ACOUSTIC_RESOURCES.diagnosticWindows) ring.shift();
  ring.push(entry);
}
