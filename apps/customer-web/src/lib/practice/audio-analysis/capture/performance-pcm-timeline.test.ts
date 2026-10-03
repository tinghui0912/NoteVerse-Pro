import { describe, expect, it } from 'vitest';

import { PerformancePcmTimeline } from './performance-pcm-timeline';

describe('PerformancePcmTimeline', () => {
  it('records RUNNING PCM only and starts a new segment after pause/resume', () => {
    const timeline = new PerformancePcmTimeline(16_000);

    const first = timeline.beginRunningSegment(0);
    expect(first.sampleStart).toBe(0);
    timeline.appendRunningPcm(Float32Array.from([1, 2, 3]));
    const sealedFirst = timeline.sealRunningSegment();

    const second = timeline.beginRunningSegment(1000);
    timeline.appendRunningPcm(Float32Array.from([4, 5]));
    const sealedSecond = timeline.sealRunningSegment();

    expect(sealedFirst?.sampleEnd).toBe(3);
    expect(sealedSecond?.sampleStart).toBe(16_000);
    expect(timeline.snapshot()).toHaveLength(2);
    expect(Array.from(timeline.extract('segment-0', 0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(timeline.extract('segment-1', 16_000, 16_002))).toEqual([4, 5]);
  });

  it('keeps final post-roll as context without extending performance duration', () => {
    const timeline = new PerformancePcmTimeline(16_000);

    timeline.beginRunningSegment(0);
    timeline.appendRunningPcm(Float32Array.from([1, 2]));
    const withTail = timeline.appendContextTail(Float32Array.from([9, 10, 11]));
    const sealed = timeline.sealRunningSegment();

    expect(withTail.sampleEnd).toBe(2);
    expect(withTail.contextTailEnd).toBe(5);
    expect(sealed?.sampleEnd).toBe(2);
    expect(sealed?.contextTailEnd).toBe(5);
    expect(Array.from(timeline.extract('segment-0', 0, 5))).toEqual([1, 2, 9, 10, 11]);
  });

  it('fails closed when PCM is appended outside a RUNNING segment', () => {
    const timeline = new PerformancePcmTimeline(16_000);

    expect(() => timeline.appendRunningPcm(Float32Array.from([1]))).toThrow(/RUNNING/);
    expect(() => timeline.appendContextTail(Float32Array.from([1]))).toThrow(/Post-roll/);
  });
});
