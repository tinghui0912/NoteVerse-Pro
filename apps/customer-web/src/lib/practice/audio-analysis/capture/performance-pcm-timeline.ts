export type PerformancePcmSegment = {
  segmentId: string;
  performanceStartMs: number;
  sampleStart: number;
  sampleEnd: number;
  contextTailEnd: number;
};

type MutableSegment = PerformancePcmSegment & {
  blocks: Float32Array[];
};

export class PerformancePcmTimeline {
  private readonly segments: MutableSegment[] = [];
  private activeSegment: MutableSegment | null = null;
  private nextSegmentIndex = 0;

  constructor(readonly sampleRateHz: number) {
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
      throw new Error('Performance PCM timeline requires a positive sample rate.');
    }
  }

  beginRunningSegment(performanceStartMs: number): PerformancePcmSegment {
    if (this.activeSegment) {
      throw new Error('Performance PCM timeline already has an active RUNNING segment.');
    }
    const sampleStart = this.performanceMsToSampleIndex(performanceStartMs);
    const segment: MutableSegment = {
      segmentId: `segment-${this.nextSegmentIndex}`,
      performanceStartMs,
      sampleStart,
      sampleEnd: sampleStart,
      contextTailEnd: sampleStart,
      blocks: [],
    };
    this.nextSegmentIndex += 1;
    this.segments.push(segment);
    this.activeSegment = segment;
    return this.readonlySegment(segment);
  }

  appendRunningPcm(samples: Float32Array): PerformancePcmSegment {
    if (!this.activeSegment) {
      throw new Error('Performance PCM can only be appended while RUNNING.');
    }
    if (samples.length === 0) {
      return this.readonlySegment(this.activeSegment);
    }
    this.activeSegment.blocks.push(samples.slice());
    this.activeSegment.sampleEnd += samples.length;
    this.activeSegment.contextTailEnd = this.activeSegment.sampleEnd;
    return this.readonlySegment(this.activeSegment);
  }

  appendContextTail(samples: Float32Array): PerformancePcmSegment {
    if (!this.activeSegment) {
      throw new Error('Post-roll context can only be appended before sealing the active segment.');
    }
    if (samples.length > 0) {
      this.activeSegment.blocks.push(samples.slice());
      this.activeSegment.contextTailEnd += samples.length;
    }
    return this.readonlySegment(this.activeSegment);
  }

  sealRunningSegment(): PerformancePcmSegment | null {
    const segment = this.activeSegment;
    this.activeSegment = null;
    return segment ? this.readonlySegment(segment) : null;
  }

  snapshot(): readonly PerformancePcmSegment[] {
    return this.segments.map((segment) => this.readonlySegment(segment));
  }

  extract(segmentId: string, startSample: number, endSample: number): Float32Array {
    const segment = this.segments.find((item) => item.segmentId === segmentId);
    if (!segment) {
      throw new Error(`Unknown performance PCM segment '${segmentId}'.`);
    }
    if (startSample < segment.sampleStart || endSample > segment.contextTailEnd || endSample < startSample) {
      throw new Error('Requested PCM range is outside the segment retained samples.');
    }
    const output = new Float32Array(endSample - startSample);
    let writeOffset = 0;
    let cursor = segment.sampleStart;
    for (const block of segment.blocks) {
      const blockStart = cursor;
      const blockEnd = cursor + block.length;
      cursor = blockEnd;
      const overlapStart = Math.max(startSample, blockStart);
      const overlapEnd = Math.min(endSample, blockEnd);
      if (overlapEnd <= overlapStart) {
        continue;
      }
      output.set(
        block.subarray(overlapStart - blockStart, overlapEnd - blockStart),
        writeOffset
      );
      writeOffset += overlapEnd - overlapStart;
    }
    return output;
  }

  private performanceMsToSampleIndex(performanceMs: number): number {
    if (!Number.isFinite(performanceMs) || performanceMs < 0) {
      throw new Error('Performance segment start must be finite and non-negative.');
    }
    return Math.round(performanceMs / 1000 * this.sampleRateHz);
  }

  private readonlySegment(segment: MutableSegment): PerformancePcmSegment {
    return {
      segmentId: segment.segmentId,
      performanceStartMs: segment.performanceStartMs,
      sampleStart: segment.sampleStart,
      sampleEnd: segment.sampleEnd,
      contextTailEnd: segment.contextTailEnd,
    };
  }
}
