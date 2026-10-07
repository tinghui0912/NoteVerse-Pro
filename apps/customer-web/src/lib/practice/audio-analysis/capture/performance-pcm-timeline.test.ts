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
  it('preserves half-open source sample identity for valid PCM blocks', () => {
    const capture = block(100, [1, 2, 3, 4], 48_000);

    expect(() => validatePcmCaptureBlock(capture)).not.toThrow();
    expect(capture.sourceSampleRateHz).toBe(48_000);
    expect(capture.sourceStartSampleIndex).toBe(100);
    expect(capture.sourceEndSampleIndex).toBe(104);
    expect(capture.sourceEndSampleIndex - capture.sourceStartSampleIndex).toBe(capture.samples.length);
    expect(Array.from(capture.samples)).toEqual([1, 2, 3, 4]);
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
  it('maps source sample boundaries to performance time from the segment anchor', () => {
    const timeline = new PerformancePcmTimeline(4);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 500,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 10_000,
    });

    timeline.appendRunningPcm(block(10_000, [1, 2, 3, 4]));

    expect(timeline.sourceSampleBoundaryToPerformanceMs(segment.segmentId, 10_000)).toBe(500);
    expect(timeline.sourceSampleBoundaryToPerformanceMs(segment.segmentId, 10_003)).toBe(503);
    expect(timeline.sourceSampleBoundaryToPerformanceMs(segment.segmentId, 10_004)).toBe(504);
    expect(timeline.segmentPerformanceEndMs(segment.segmentId)).toBe(504);
    expect(timeline.performanceMsToSourceSampleBoundary(segment.segmentId, 500)).toBe(10_000);
    expect(timeline.performanceMsToSourceSampleBoundary(segment.segmentId, 503)).toBe(10_003);
  });

  it('uses deterministic rounding for performance/sample range conversions', () => {
    const timeline = new PerformancePcmTimeline(8);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 0,
    });
    timeline.appendRunningPcm(block(0, Array.from({ length: 20 }, (_, index) => index)));

    expect(timeline.performanceMsToSourceSampleBoundary(segment.segmentId, 1.2, 'floor')).toBe(1);
    expect(timeline.performanceMsToSourceSampleBoundary(segment.segmentId, 1.2, 'ceil')).toBe(2);
    expect(timeline.performanceMsToSourceSampleBoundary(segment.segmentId, 1.6, 'round')).toBe(2);
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

  it('accepts cross-segment source exact continuation and positive source gaps', () => {
    const exact = new PerformancePcmTimeline(4);
    exact.beginRunningSegment({ performanceStartMs: 0, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 1_000 });
    exact.appendRunningPcm(block(1_000, [1, 2]));
    exact.sealRunningSegment();
    expect(() => exact.beginRunningSegment({
      performanceStartMs: 2,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 1_002,
    })).not.toThrow();

    const gap = new PerformancePcmTimeline(4);
    gap.beginRunningSegment({ performanceStartMs: 0, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 1_000 });
    gap.appendRunningPcm(block(1_000, [1, 2]));
    gap.sealRunningSegment();
    expect(() => gap.beginRunningSegment({
      performanceStartMs: 2,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 8_000,
    })).not.toThrow();
  });

  it('rejects cross-segment source overlap and source counter rollback', () => {
    const overlap = new PerformancePcmTimeline(4);
    overlap.beginRunningSegment({ performanceStartMs: 0, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 1_000 });
    overlap.appendRunningPcm(block(1_000, [1, 2, 3]));
    overlap.sealRunningSegment();
    expect(() => overlap.beginRunningSegment({
      performanceStartMs: 3,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 1_002,
    })).toThrow(/cannot overlap or move backward/);

    const rollback = new PerformancePcmTimeline(4);
    rollback.beginRunningSegment({ performanceStartMs: 0, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 1_000 });
    rollback.appendRunningPcm(block(1_000, [1, 2]));
    rollback.sealRunningSegment();
    expect(() => rollback.beginRunningSegment({
      performanceStartMs: 2,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 0,
    })).toThrow(/cannot overlap or move backward/);
  });

  it('accepts exact and gapped performance-time continuation while rejecting overlap', () => {
    const exact = new PerformancePcmTimeline(4);
    exact.beginRunningSegment({ performanceStartMs: 10, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 0 });
    exact.appendRunningPcm(block(0, [1, 2, 3]));
    exact.sealRunningSegment();
    expect(() => exact.beginRunningSegment({
      performanceStartMs: 13,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 3,
    })).not.toThrow();

    const gap = new PerformancePcmTimeline(4);
    gap.beginRunningSegment({ performanceStartMs: 10, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 0 });
    gap.appendRunningPcm(block(0, [1, 2, 3]));
    gap.sealRunningSegment();
    expect(() => gap.beginRunningSegment({
      performanceStartMs: 25,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 100,
    })).not.toThrow();

    const overlap = new PerformancePcmTimeline(4);
    overlap.beginRunningSegment({ performanceStartMs: 10, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 0 });
    overlap.appendRunningPcm(block(0, [1, 2, 3]));
    overlap.sealRunningSegment();
    expect(() => overlap.beginRunningSegment({
      performanceStartMs: 12.999,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 3,
    })).toThrow(/cannot overlap in performance time/);
  });

  it('allows non-zero initial performance start and explicit empty RUNNING segments', () => {
    const timeline = new PerformancePcmTimeline(4);
    const empty = timeline.beginRunningSegment({
      performanceStartMs: 1_500,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 42,
    });
    expect(timeline.segmentPerformanceEndMs(empty.segmentId)).toBe(1_500);
    expect(timeline.sealRunningSegment()).toMatchObject({
      sourceStartSampleIndex: 42,
      sourcePerformanceEndSampleIndex: 42,
      sourceContextTailEndSampleIndex: 42,
    });
    expect(() => timeline.beginRunningSegment({
      performanceStartMs: 1_500,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 42,
    })).not.toThrow();
  });

  it('keeps context tail in source identity without extending performance-time ownership', () => {
    const timeline = new PerformancePcmTimeline(4);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 48_000,
      sourceStartSampleIndex: 0,
    });

    timeline.appendRunningPcm(block(0, [1, 2], 48_000));
    const withTail = timeline.appendContextTail(block(2, [9, 10, 11], 48_000));
    expect(withTail.sourcePerformanceEndSampleIndex).toBe(2);
    expect(withTail.sourceContextTailEndSampleIndex).toBe(5);
    expect(timeline.segmentPerformanceEndMs(segment.segmentId)).toBeCloseTo(2 / 48_000 * 1000);
    expect(() => timeline.sourceSampleBoundaryToPerformanceMs(segment.segmentId, 3)).toThrow(/performance-owned/);
    expect(() => timeline.performanceMsToSourceSampleBoundary(segment.segmentId, 3)).toThrow(/performance-owned/);
    timeline.sealRunningSegment();

    expect(() => timeline.beginRunningSegment({
      performanceStartMs: 2 / 48_000 * 1000,
      sourceSampleRateHz: 48_000,
      sourceStartSampleIndex: 4,
    })).toThrow(/cannot overlap or move backward/);
    expect(() => timeline.beginRunningSegment({
      performanceStartMs: 2 / 48_000 * 1000,
      sourceSampleRateHz: 48_000,
      sourceStartSampleIndex: 5,
    })).not.toThrow();
  });

  it('does not add context-tail duration to the next segment performance start requirement', () => {
    const timeline = new PerformancePcmTimeline(4);
    timeline.beginRunningSegment({ performanceStartMs: 0, sourceSampleRateHz: 1_000, sourceStartSampleIndex: 0 });
    timeline.appendRunningPcm(block(0, [1, 2]));
    timeline.appendContextTail(block(2, [9, 10, 11, 12]));
    timeline.sealRunningSegment();

    expect(() => timeline.beginRunningSegment({
      performanceStartMs: 2,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 6,
    })).not.toThrow();
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

  it('extracts half-open ranges without treating the end boundary as an extra sample', () => {
    const timeline = new PerformancePcmTimeline(4);
    const segment = timeline.beginRunningSegment({
      performanceStartMs: 0,
      sourceSampleRateHz: 1_000,
      sourceStartSampleIndex: 100,
    });
    timeline.appendRunningPcm(block(100, [0, 1, 2, 3]));

    expect(Array.from(timeline.extract(segment.segmentId, 100, 104))).toEqual([0, 1, 2, 3]);
    expect(timeline.extract(segment.segmentId, 104, 104)).toHaveLength(0);
    expect(() => timeline.extract(segment.segmentId, 100, 105)).toThrow(/outside the segment/);
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
