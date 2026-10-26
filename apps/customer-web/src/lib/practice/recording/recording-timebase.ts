export type RecordingActiveSegment = Readonly<{
  perfStartMs: number; perfEndMs: number; mediaStartMs: number; mediaEndMs: number;
}>;
export type RecordingTimebaseMapping = Readonly<{
  activeSegments: readonly RecordingActiveSegment[];
  nominalMediaDurationMs: number;
}>;

/** Container duration metadata tolerates one millisecond of rounding. */
const TIMEBASE_TOLERANCE_MS = 1;
export function assertRecordingTimebase(mapping: RecordingTimebaseMapping): void {
  const nonnegative = (value: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!mapping || !nonnegative(mapping.nominalMediaDurationMs) || !Array.isArray(mapping.activeSegments)
    || Object.keys(mapping).sort().join() !== 'activeSegments,nominalMediaDurationMs') {
    throw new Error('recording_timebase_invalid');
  }
  let previous: RecordingActiveSegment | undefined;
  for (const segment of mapping.activeSegments) {
    if (!segment || Object.keys(segment).sort().join() !== 'mediaEndMs,mediaStartMs,perfEndMs,perfStartMs'
      || ![segment.perfStartMs, segment.perfEndMs, segment.mediaStartMs, segment.mediaEndMs].every(nonnegative)) {
      throw new Error('recording_timebase_segment_invalid');
    }
    if (segment.perfEndMs < segment.perfStartMs || segment.mediaEndMs < segment.mediaStartMs) {
      throw new Error('recording_timebase_segment_order_invalid');
    }
    if (!previous && segment.mediaStartMs !== 0) throw new Error('recording_timebase_first_media_segment_invalid');
    if (previous && segment.perfStartMs < previous.perfEndMs) throw new Error('recording_timebase_segments_overlap');
    if (previous && (segment.mediaStartMs < previous.mediaStartMs
      || Math.abs(segment.mediaStartMs - previous.mediaEndMs) > TIMEBASE_TOLERANCE_MS)) {
      throw new Error('recording_timebase_media_segments_not_continuous');
    }
    previous = segment;
  }
  if (!previous && mapping.nominalMediaDurationMs !== 0
    || Math.abs((previous?.mediaEndMs ?? 0) - mapping.nominalMediaDurationMs) > TIMEBASE_TOLERANCE_MS) {
    throw new Error('recording_timebase_nominal_duration_mismatch');
  }
}
export function immutableRecordingTimebase(mapping: RecordingTimebaseMapping): RecordingTimebaseMapping {
  assertRecordingTimebase(mapping);
  return Object.freeze({ nominalMediaDurationMs: mapping.nominalMediaDurationMs,
    activeSegments: Object.freeze(mapping.activeSegments.map(segment => Object.freeze({ ...segment }))) });
}

/**
 * Maps audio media playback time (ms) to practice performanceTimeMs (ms).
 * Takes into account recording start offset, pause/resume intervals, and actual media duration scaling.
 * Returns null if synchronization cannot be reliably determined (allowing explicit degradation).
 */
export function mediaTimeToPerformanceTimeMs(
  mediaTimeMs: number,
  timebase?: RecordingTimebaseMapping | null,
  actualMediaDurationMs?: number | null
): number | null {
  if (!timebase || timebase.activeSegments.length === 0) {
    return null;
  }

  const { activeSegments, nominalMediaDurationMs } = timebase;

  let scaledMediaTimeMs = mediaTimeMs;
  if (
    actualMediaDurationMs &&
    actualMediaDurationMs > 0 &&
    nominalMediaDurationMs > 0
  ) {
    scaledMediaTimeMs = (mediaTimeMs / actualMediaDurationMs) * nominalMediaDurationMs;
  }

  const firstSeg = activeSegments[0];
  const lastSeg = activeSegments[activeSegments.length - 1];

  if (scaledMediaTimeMs <= firstSeg.mediaStartMs) {
    return firstSeg.perfStartMs;
  }
  if (scaledMediaTimeMs >= lastSeg.mediaEndMs) {
    return lastSeg.perfEndMs;
  }

  for (let i = 0; i < activeSegments.length; i++) {
    const seg = activeSegments[i];
    if (scaledMediaTimeMs >= seg.mediaStartMs && scaledMediaTimeMs <= seg.mediaEndMs) {
      const offsetInSeg = scaledMediaTimeMs - seg.mediaStartMs;
      return seg.perfStartMs + offsetInSeg;
    }
  }

  return null;
}
