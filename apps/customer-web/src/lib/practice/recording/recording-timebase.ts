import {
  assertRecordingTimebaseStructure,
  isRecordingCoordinate,
} from "./generated/recording-timebase-contract";
import type {
  RecordingActiveSegment,
  RecordingTimebase,
} from "./generated/recording-timebase-contract";

export type {
  RecordingActiveSegment,
  RecordingTimebase,
} from "./generated/recording-timebase-contract";

export function assertRecordingTimebase(
  value: unknown,
): asserts value is RecordingTimebase {
  assertRecordingTimebaseStructure(value);
  let previous: RecordingActiveSegment | undefined;
  for (const segment of value.activeSegments) {
    if (
      segment.performanceEndUs <= segment.performanceStartUs ||
      segment.mediaEndUs <= segment.mediaStartUs ||
      segment.performanceEndUs - segment.performanceStartUs !==
        segment.mediaEndUs - segment.mediaStartUs
    ) {
      throw new Error("recording_timebase_invalid_segment");
    }
    if (
      (!previous && segment.mediaStartUs !== 0) ||
      (previous &&
        (segment.performanceStartUs < previous.performanceEndUs ||
          segment.mediaStartUs !== previous.mediaEndUs))
    ) {
      throw new Error("recording_timebase_invalid_chronology");
    }
    previous = segment;
  }
  if (previous!.mediaEndUs !== value.nominalMediaDurationUs)
    throw new Error("recording_timebase_invalid_duration");
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
  if (!Number.isFinite(ms) || ms < 0) throw new Error("recording_time_invalid");
  const us = Math.round(ms * 1000);
  if (!isRecordingCoordinate(us)) throw new Error("recording_time_unsafe");
  return us;
}
export function microsecondsToMilliseconds(us: number): number {
  if (!isRecordingCoordinate(us)) throw new Error("recording_time_invalid");
  return us / 1000;
}

/** Integer core. Shared media joins belong to the preceding active segment's endpoint. */
export function mediaTimeUsToPerformanceTimeUs(
  mediaTimeUs: number,
  timebase: RecordingTimebase,
  actualMediaDurationUs?: number,
): number {
  if (
    !isRecordingCoordinate(mediaTimeUs) ||
    (actualMediaDurationUs !== undefined &&
      (!isRecordingCoordinate(actualMediaDurationUs) ||
        actualMediaDurationUs === 0))
  ) {
    throw new Error("recording_time_invalid");
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
