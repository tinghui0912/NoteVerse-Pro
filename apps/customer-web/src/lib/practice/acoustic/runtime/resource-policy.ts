export const ACOUSTIC_RESOURCES = Object.freeze({
  maxOutstandingWindows: 4,
  maxSourceBlockSamples: 2048,
  diagnosticWindows: 32,
  targetRingSamples: 65536,
  inputBytes: 29120 * 4,
  maxEventsPerWindow: 183 * 88,
  // Bounds rapid control changes as well as PCM; failure never changes transport.
  maxScheduledBoundaries: 8,
} as const);

export function retainCompact<T>(ring: T[], entry: T): void {
  if (ring.length === ACOUSTIC_RESOURCES.diagnosticWindows) ring.shift();
  ring.push(entry);
}
