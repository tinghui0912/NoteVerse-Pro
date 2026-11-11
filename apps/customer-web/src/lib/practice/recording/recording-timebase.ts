import type {
  RecordingTimebase as RecordingTimebaseDto,
  RecordingActiveSegment as RecordingActiveSegmentDto,
} from '@/generated/api/types.gen';

export type RecordingActiveSegment = Readonly<RecordingActiveSegmentDto>;
export type RecordingTimebase = Readonly<
  Omit<RecordingTimebaseDto, 'activeSegments'> & {
    activeSegments: readonly RecordingActiveSegment[];
  }
>;

function safeCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertRecordingTimebase(
  value: unknown,
): asserts value is RecordingTimebase {
  if (
    !record(value) ||
    Object.keys(value).sort().join() !==
      'activeSegments,nominalMediaDurationUs' ||
    !safeCoordinate(value.nominalMediaDurationUs) ||
    value.nominalMediaDurationUs === 0 ||
    !Array.isArray(value.activeSegments) ||
    value.activeSegments.length === 0
  ) {
    throw new Error('recording_timebase_invalid');
  }
  let previous: RecordingActiveSegment | undefined;
  for (const segment of value.activeSegments) {
    if (
      !record(segment) ||
      Object.keys(segment).sort().join() !==
        'mediaEndUs,mediaStartUs,performanceEndUs,performanceStartUs' ||
      !safeCoordinate(segment.performanceStartUs) ||
      !safeCoordinate(segment.performanceEndUs) ||
      !safeCoordinate(segment.mediaStartUs) ||
      !safeCoordinate(segment.mediaEndUs) ||
      segment.performanceEndUs <= segment.performanceStartUs ||
      segment.mediaEndUs <= segment.mediaStartUs ||
      segment.performanceEndUs - segment.performanceStartUs !==
        segment.mediaEndUs - segment.mediaStartUs
    ) {
      throw new Error('recording_timebase_invalid_segment');
    }
    if (
      (!previous && segment.mediaStartUs !== 0) ||
      (previous &&
        (segment.performanceStartUs < previous.performanceEndUs ||
          segment.mediaStartUs !== previous.mediaEndUs))
    ) {
      throw new Error('recording_timebase_invalid_chronology');
    }
    previous = segment as RecordingActiveSegment;
  }
  if (previous!.mediaEndUs !== value.nominalMediaDurationUs)
    throw new Error('recording_timebase_invalid_duration');
}

/** Creates only the immutable coordinate projection; media bytes have their own owner. */
export function decodeRecordingTimebase(value: unknown): RecordingTimebase {
  assertRecordingTimebase(value);
  return Object.freeze({
    nominalMediaDurationUs: value.nominalMediaDurationUs,
    activeSegments: Object.freeze(
      value.activeSegments.map((segment) => Object.freeze({ ...segment })),
    ),
  });
}

/** Nonnegative runtime milliseconds round to the nearest microsecond, with ties upward. */
export function millisecondsToMicroseconds(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) throw new Error('recording_time_invalid');
  const us = Math.round(ms * 1000);
  if (!safeCoordinate(us)) throw new Error('recording_time_unsafe');
  return us;
}
export function microsecondsToMilliseconds(us: number): number {
  if (!safeCoordinate(us)) throw new Error('recording_time_invalid');
  return us / 1000;
}

/** Integer core. Shared media joins belong to the preceding active segment's endpoint. */
export function mediaTimeUsToPerformanceTimeUs(
  mediaTimeUs: number,
  timebase: RecordingTimebase,
  actualMediaDurationUs?: number,
): number {
  if (
    !safeCoordinate(mediaTimeUs) ||
    (actualMediaDurationUs !== undefined &&
      (!safeCoordinate(actualMediaDurationUs) || actualMediaDurationUs === 0))
  ) {
    throw new Error('recording_time_invalid');
  }
  const nominal = timebase.nominalMediaDurationUs;
  const actual = actualMediaDurationUs ?? nominal;
  const bounded = Math.min(mediaTimeUs, actual);
  // Nearest integer, ties upward; products remain exact even at the safe-integer boundary.
  const scaled = Number(
    (2n * BigInt(bounded) * BigInt(nominal) + BigInt(actual)) /
      (2n * BigInt(actual)),
  );
  for (const segment of timebase.activeSegments) {
    if (scaled <= segment.mediaEndUs)
      return segment.performanceStartUs + (scaled - segment.mediaStartUs);
  }
  return timebase.activeSegments[timebase.activeSegments.length - 1]
    .performanceEndUs;
}

/** Browser-only adaptation of decoded container time to the exact nominal recording axis. */
export function recordingMediaTimeMsToPerformanceTimeMs(
  mediaTimeMs: number,
  timebase?: RecordingTimebase | null,
  actualMediaDurationMs?: number | null,
): number | null {
  if (!timebase) return null;
  const actualUs =
    actualMediaDurationMs != null &&
    Number.isFinite(actualMediaDurationMs) &&
    actualMediaDurationMs > 0
      ? millisecondsToMicroseconds(actualMediaDurationMs)
      : undefined;
  return microsecondsToMilliseconds(
    mediaTimeUsToPerformanceTimeUs(
      millisecondsToMicroseconds(Math.max(0, mediaTimeMs)),
      timebase,
      actualUs,
    ),
  );
}
