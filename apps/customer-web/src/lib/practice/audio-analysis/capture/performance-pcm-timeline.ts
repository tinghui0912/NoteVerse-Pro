export type PerformancePcmSegment = {
  segmentId: string;
  performanceStartMs: number;
  sampleStart: number;
  sampleEnd: number;
  contextTailEnd: number;
};

type MutableSegment = PerformancePcmSegment & {
  blocks: PcmStorageBlock[];
};

type PcmStorageBlock = {
  startSample: number;
  samples: Float32Array;
  length: number;
};

export class PerformancePcmTimeline {
  private readonly segments: MutableSegment[] = [];
  private activeSegment: MutableSegment | null = null;
  private nextSegmentIndex = 0;
  private lastExtractVisitedBlockCount = 0;

  constructor(
    readonly sampleRateHz: number,
    private readonly storageBlockSizeSamples = 8_192
  ) {
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
      throw new Error('Performance PCM timeline requires a positive sample rate.');
    }
    if (!Number.isInteger(storageBlockSizeSamples) || storageBlockSizeSamples <= 0) {
      throw new Error('PCM storage block size must be a positive integer.');
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
    appendToSegmentBlocks(this.activeSegment, samples, this.storageBlockSizeSamples);
    this.activeSegment.sampleEnd += samples.length;
    this.activeSegment.contextTailEnd = this.activeSegment.sampleEnd;
    return this.readonlySegment(this.activeSegment);
  }

  appendContextTail(samples: Float32Array): PerformancePcmSegment {
    if (!this.activeSegment) {
      throw new Error('Post-roll context can only be appended before sealing the active segment.');
    }
    if (samples.length > 0) {
      appendToSegmentBlocks(this.activeSegment, samples, this.storageBlockSizeSamples);
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
    this.lastExtractVisitedBlockCount = 0;
    for (const block of segment.blocks) {
      const blockStart = block.startSample;
      const blockEnd = block.startSample + block.length;
      if (blockEnd <= startSample) {
        continue;
      }
      if (blockStart >= endSample) {
        break;
      }
      this.lastExtractVisitedBlockCount += 1;
      const overlapStart = Math.max(startSample, blockStart);
      const overlapEnd = Math.min(endSample, blockEnd);
      if (overlapEnd <= overlapStart) {
        continue;
      }
      output.set(
        block.samples.subarray(overlapStart - blockStart, overlapEnd - blockStart),
        writeOffset
      );
      writeOffset += overlapEnd - overlapStart;
    }
    return output;
  }

  debugSegmentBlockCount(segmentId: string): number {
    const segment = this.segments.find((item) => item.segmentId === segmentId);
    if (!segment) {
      throw new Error(`Unknown performance PCM segment '${segmentId}'.`);
    }
    return segment.blocks.length;
  }

  debugLastExtractVisitedBlockCount(): number {
    return this.lastExtractVisitedBlockCount;
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

function appendToSegmentBlocks(
  segment: MutableSegment,
  samples: Float32Array,
  storageBlockSizeSamples: number
) {
  let readOffset = 0;
  while (readOffset < samples.length) {
    let block = segment.blocks[segment.blocks.length - 1];
    if (!block || block.length >= storageBlockSizeSamples) {
      block = {
        startSample: segment.contextTailEnd + readOffset,
        samples: new Float32Array(storageBlockSizeSamples),
        length: 0,
      };
      segment.blocks.push(block);
    }
    const writable = storageBlockSizeSamples - block.length;
    const copied = Math.min(writable, samples.length - readOffset);
    block.samples.set(samples.subarray(readOffset, readOffset + copied), block.length);
    block.length += copied;
    readOffset += copied;
  }
}
