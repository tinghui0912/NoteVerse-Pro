import { describe, expect, it } from 'vitest';

import {
  PerformancePcmTimeline,
  type PcmCaptureBlock,
  validatePcmCaptureBlock,
} from './performance-pcm-timeline';

function block(
  sourceStartSampleIndex: number,
  values: readonly number[],
  sourceSampleRateHz = 1_000
): PcmCaptureBlock {
  return {
    sourceSampleRateHz,
    sourceStartSampleIndex,
    sourceEndSampleIndex: sourceStartSampleIndex + values.length,
    samples: Float32Array.from(values),
  };
}

describe('PcmCaptureBlock', () => {
  it('preserves source sample identity for valid PCM blocks', () => {
    const capture = block(10, [1, 2, 3], 48_000);

    expect(() => validatePcmCaptureBlock(capture)).not.toThrow();
    expect(capture.sourceSampleRateHz).toBe(48_000);
    expect(capture.sourceStartSampleIndex).toBe(10);
    expect(capture.sourceEndSampleIndex).toBe(13);
    expect(Array.from(capture.samples)).toEqual([1, 2, 3]);
  });

  it('fails closed on malformed sample length and range', () => {
    expect(() => validatePcmCaptureBlock({
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 10,
      sourceEndSampleIndex: 9,
      samples: new Float32Array(),
    })).toThrow(/end sample/);

    expect(() => validatePcmCaptureBlock({
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 10,
      sourceEndSampleIndex: 12,
      samples: Float32Array.from([1]),
    })).toThrow(/sample length/);
  });

  it('requires a finite positive source sample rate and integer non-negative sample indexes', () => {
    expect(() => validatePcmCaptureBlock(block(0, [1], 0))).toThrow(/sample rate/);
    expect(() => validatePcmCaptureBlock(block(0, [1], Number.POSITIVE_INFINITY))).toThrow(/sample rate/);
    expect(() => validatePcmCaptureBlock({
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 1.5,
      sourceEndSampleIndex: 2.5,
      samples: Float32Array.from([1]),
    })).toThrow(/non-negative integer/);
  });
});

describe('PerformancePcmTimeline', () => {
  it('maps source samples to performance time from the segment anchor', () => {
    const timeline = new PerformancePcmTimeline(4);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 500,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 10_000,
    });

    timeline.appendRunningPcm(block(10_000, [1, 2, 3, 4]));

    expect(timeline.sourceSampleIndexToPerformanceMs(segment.segmentId, 10_000)).toBe(500);
    expect(timeline.sourceSampleIndexToPerformanceMs(segment.segmentId, 10_003)).toBe(503);
    expect(timeline.performanceMsToSourceSampleIndex(segment.segmentId, 500)).toBe(10_000);
    expect(timeline.performanceMsToSourceSampleIndex(segment.segmentId, 503)).toBe(10_003);
  });

  it('uses deterministic rounding for performance/sample range conversions', () => {
    const timeline = new PerformancePcmTimeline(8);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 0,
    });
    timeline.appendRunningPcm(block(0, Array.from({ length: 20 }, (_, index) => index)));

    expect(timeline.performanceMsToSourceSampleIndex(segment.segmentId, 1.2, 'floor')).toBe(1);
    expect(timeline.performanceMsToSourceSampleIndex(segment.segmentId, 1.2, 'ceil')).toBe(2);
    expect(timeline.performanceMsToSourceSampleIndex(segment.segmentId, 1.6, 'round')).toBe(2);
    expect(timeline.performanceRangeToSourceSampleRange(segment.segmentId, 1.2, 5.1)).toEqual({
      sourceStartSampleIndex: 1,
      sourceEndSampleIndex: 6,
    });
  });

  it('keeps pause/resume as distinct RUNNING segments', () => {
    const timeline = new PerformancePcmTimeline(4);

    const first = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 0,
    });
    timeline.appendRunningPcm(block(0, [1, 2, 3]));
    timeline.sealRunningSegment();

    const second = timeline.beginRunningSegment({
      performanceStartMs: 1_000,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 10_000,
    });
    timeline.appendRunningPcm(block(10_000, [4, 5]));
    timeline.sealRunningSegment();

    expect(timeline.snapshot()).toEqual([
      {
        segmentId: first.segmentId,
        performanceStartMs: 0,
        sourceSampleRateHz: 1_000,
        sourceStartSampleIndex: 0,
        sourcePerformanceEndSampleIndex: 3,
        sourceContextTailEndSampleIndex: 3,
      },
      {
        segmentId: second.segmentId,
        performanceStartMs: 1_000,
        sourceSampleRateHz: 1_000,
        sourceStartSampleIndex: 10_000,
        sourcePerformanceEndSampleIndex: 10_002,
        sourceContextTailEndSampleIndex: 10_002,
      },
    ]);
    expect(Array.from(timeline.extract(first.segmentId, 0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(timeline.extract(second.segmentId, 10_000, 10_002))).toEqual([4, 5]);
  });

  it('does not implicitly extract across segment boundaries or paused wall-clock gaps', () => {
    const timeline = new PerformancePcmTimeline(4);
    const first = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 0,
    });
    timeline.appendRunningPcm(block(0, [1, 2]));
    timeline.sealRunningSegment();

    timeline.beginRunningSegment({
      performanceStartMs: 500,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 10_000,
    });
    timeline.appendRunningPcm(block(10_000, [3, 4]));

    expect(() => timeline.extract(first.segmentId, 0, 10_001)).toThrow(/outside the segment/);
  });

  it('retains context tail without extending performance-owned duration', () => {
    const timeline = new PerformancePcmTimeline(4);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 0,
    });

    timeline.appendRunningPcm(block(0, [1, 2]));
    const withTail = timeline.appendContextTail(block(2, [9, 10, 11]));

    expect(withTail.sourcePerformanceEndSampleIndex).toBe(2);
    expect(withTail.sourceContextTailEndSampleIndex).toBe(5);
    expect(Array.from(timeline.extract(segment.segmentId, 0, 5))).toEqual([1, 2, 9, 10, 11]);
    expect(() => timeline.sourceSampleIndexToPerformanceMs(segment.segmentId, 3)).toThrow(/performance-owned/);
    expect(() => timeline.performanceMsToSourceSampleIndex(segment.segmentId, 3)).toThrow(/performance-owned/);
  });

  it('extracts exact retained PCM across internal storage-block boundaries', () => {
    const timeline = new PerformancePcmTimeline(3);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 100,
    });
    timeline.appendRunningPcm(block(100, [0, 1, 2, 3, 4, 5, 6, 7]));

    expect(timeline.debugSegmentBlockCount(segment.segmentId)).toBe(3);
    expect(Array.from(timeline.extract(segment.segmentId, 103, 105))).toEqual([3, 4]);
    expect(timeline.debugLastExtractVisitedBlockCount()).toBeLessThan(3);
  });

  it('supports future chunk-style extraction from one segment without model-specific assumptions', () => {
    const timeline = new PerformancePcmTimeline(4);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 2_000,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 20_000,
    });
    timeline.appendRunningPcm(block(20_000, [0, 1, 2, 3, 4, 5]));
    timeline.appendContextTail(block(20_006, [6, 7]));

    const inputRange = timeline.performanceRangeToSourceSampleRange(segment.segmentId, 2_001, 2_004);
    expect(inputRange).toEqual({ sourceStartSampleIndex: 20_001, sourceEndSampleIndex: 20_004 });
    expect(Array.from(timeline.extract(segment.segmentId, inputRange.sourceStartSampleIndex, 20_008)))
      .toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('requires one stable sample rate and chronological non-overlapping source sample identity', () => {
    const timeline = new PerformancePcmTimeline(4);
    timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 0,
    });
    timeline.appendRunningPcm(block(0, [1, 2]));

    expect(() => timeline.appendRunningPcm(block(2, [3], 2_000))).toThrow(/sample rate/);
    expect(() => timeline.appendRunningPcm(block(1, [3]))).toThrow(/chronological/);
    expect(() => timeline.appendContextTail(block(3, [9]))).toThrow(/chronological/);
  });

  it('fails closed when PCM is appended outside a RUNNING segment', () => {
    const timeline = new PerformancePcmTimeline(4);

    expect(() => timeline.appendRunningPcm(block(0, [1]))).toThrow(/RUNNING/);
    expect(() => timeline.appendContextTail(block(0, [1]))).toThrow(/Post-roll/);
  });
});
