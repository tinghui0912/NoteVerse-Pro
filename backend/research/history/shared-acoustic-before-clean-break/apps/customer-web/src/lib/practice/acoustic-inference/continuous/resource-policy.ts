export const ACOUSTIC_RESOURCES = Object.freeze({
  maxOutstandingWindows: 4,
  maxUnacknowledgedBlocks: 32,
  maxSourceBlockSamples: 2048,
  diagnosticWindows: 32,
  targetRingSamples: 65536,
  inputBytes: 29120 * 4,
  maxEventsPerWindow: 183 * 88,
  // Bounds rapid control changes as well as PCM; failure never changes transport.
  maxPendingSegments: 4,
  maxScheduledBoundaries: 8,
} as const);

export type AcousticWindowDiagnostic = Readonly<{
  jobIndex: number; segmentIndex: number; ownedStartMs: number; ownedEndMs: number;
  inputStartSample: number; inputEndSample: number;
  queueDelayMs: number; inferenceMs: number; decodeMs: number; publicationMs: number;
  eventCount: number; outstandingAtEnqueue: number;
  actualSessionRunCount: number;
  sourceSegmentStartSample: number; sourceSegmentEndSample: number | null;
  performanceSegmentStartMs: number; performanceSegmentEndMs: number | null;
}>;

export function retainCompact<T>(ring: T[], entry: T): void {
  if (ring.length === ACOUSTIC_RESOURCES.diagnosticWindows) ring.shift();
  ring.push(entry);
}
