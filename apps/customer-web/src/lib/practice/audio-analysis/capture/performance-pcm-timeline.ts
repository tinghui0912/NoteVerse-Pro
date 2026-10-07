export type PcmCaptureBlock = {
  sourceSampleRateHz: number;
  sourceStartSampleIndex: number;
  sourceEndSampleIndex: number;
  samples: Float32Array;
};

export type PerformancePcmSegment = {
  segmentId: string;
  performanceStartMs: number;
  sourceSampleRateHz: number;
  sourceStartSampleIndex: number;
  sourcePerformanceEndSampleIndex: number;
  sourceContextTailEndSampleIndex: number;
};

type MutableSegment = PerformancePcmSegment & {
  blocks: PcmStorageBlock[];
};

type PcmStorageBlock = {
  sourceStartSampleIndex: number;
  samples: Float32Array;
  length: number;
};

export class PerformancePcmTimeline {
  private readonly segments: MutableSegment[] = [];
  private activeSegment: MutableSegment | null = null;
  private sourceSampleRateHz: number | null = null;
  private nextSegmentIndex = 0;
  private lastExtractVisitedBlockCount = 0;

  constructor(private readonly storageBlockSizeSamples = 8_192) {
    if (!Number.isInteger(storageBlockSizeSamples) || storageBlockSizeSamples <= 0) {
      throw new Error('PCM storage block size must be a positive integer.');
    }
  }

  beginRunningSegment(input: {
    performanceStartMs: number;
    sourceSampleRateHz: number;
    sourceStartSampleIndex: number;
  }): PerformancePcmSegment {
    if (this.activeSegment) {
      throw new Error('Performance PCM timeline already has an active RUNNING segment.');
    }
    validateSourceSampleRate(input.sourceSampleRateHz);
    validateSourceSampleIndex(input.sourceStartSampleIndex, 'sourceStartSampleIndex');
    this.validateStableSourceSampleRate(input.sourceSampleRateHz);
    if (!Number.isFinite(input.performanceStartMs) || input.performanceStartMs < 0) {
      throw new Error('Performance segment start must be finite and non-negative.');
    }
    const segment: MutableSegment = {
      segmentId: `segment-${this.nextSegmentIndex}`,
      performanceStartMs: input.performanceStartMs,
      sourceSampleRateHz: input.sourceSampleRateHz,
      sourceStartSampleIndex: input.sourceStartSampleIndex,
      sourcePerformanceEndSampleIndex: input.sourceStartSampleIndex,
      sourceContextTailEndSampleIndex: input.sourceStartSampleIndex,
      blocks: [],
    };
    this.nextSegmentIndex += 1;
    this.segments.push(segment);
    this.activeSegment = segment;
    return this.readonlySegment(segment);
  }

  appendRunningPcm(block: PcmCaptureBlock): PerformancePcmSegment {
    const segment = this.requireActiveSegment('Performance PCM can only be appended while RUNNING.');
    this.validateBlockForActiveSegment(block);
    if (segment.sourceContextTailEndSampleIndex !== segment.sourcePerformanceEndSampleIndex) {
      throw new Error('Running PCM cannot be appended after context-only tail samples.');
    }
    appendToSegmentBlocks(segment, block.samples, this.storageBlockSizeSamples);
    segment.sourcePerformanceEndSampleIndex = block.sourceEndSampleIndex;
    segment.sourceContextTailEndSampleIndex = block.sourceEndSampleIndex;
    return this.readonlySegment(segment);
  }

  appendContextTail(block: PcmCaptureBlock): PerformancePcmSegment {
    const segment = this.requireActiveSegment('Post-roll context can only be appended before sealing the active segment.');
    this.validateBlockForActiveSegment(block);
    appendToSegmentBlocks(segment, block.samples, this.storageBlockSizeSamples);
    segment.sourceContextTailEndSampleIndex = block.sourceEndSampleIndex;
    return this.readonlySegment(segment);
  }

  sealRunningSegment(): PerformancePcmSegment | null {
    const segment = this.activeSegment;
    this.activeSegment = null;
    return segment ? this.readonlySegment(segment) : null;
  }

  snapshot(): readonly PerformancePcmSegment[] {
    return this.segments.map((segment) => this.readonlySegment(segment));
  }

  extract(segmentId: string, sourceStartSampleIndex: number, sourceEndSampleIndex: number): Float32Array {
    const segment = this.segmentById(segmentId);
    validateSourceSampleIndex(sourceStartSampleIndex, 'sourceStartSampleIndex');
    validateSourceSampleIndex(sourceEndSampleIndex, 'sourceEndSampleIndex');
    if (
      sourceStartSampleIndex < segment.sourceStartSampleIndex
      || sourceEndSampleIndex > segment.sourceContextTailEndSampleIndex
      || sourceEndSampleIndex < sourceStartSampleIndex
    ) {
      throw new Error('Requested PCM range is outside the segment retained samples.');
    }
    const output = new Float32Array(sourceEndSampleIndex - sourceStartSampleIndex);
    let writeOffset = 0;
    this.lastExtractVisitedBlockCount = 0;
    const firstBlockIndex = Math.max(
      0,
      Math.floor((sourceStartSampleIndex - segment.sourceStartSampleIndex) / this.storageBlockSizeSamples)
    );
    for (let blockIndex = firstBlockIndex; blockIndex < segment.blocks.length; blockIndex += 1) {
      const block = segment.blocks[blockIndex];
      this.lastExtractVisitedBlockCount += 1;
      const blockStart = block.sourceStartSampleIndex;
      const blockEnd = block.sourceStartSampleIndex + block.length;
      if (blockEnd <= sourceStartSampleIndex) {
        continue;
      }
      if (blockStart >= sourceEndSampleIndex) {
        break;
      }
      const overlapStart = Math.max(sourceStartSampleIndex, blockStart);
      const overlapEnd = Math.min(sourceEndSampleIndex, blockEnd);
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

  sourceSampleIndexToPerformanceMs(segmentId: string, sourceSampleIndex: number): number {
    const segment = this.segmentById(segmentId);
    validateSourceSampleIndex(sourceSampleIndex, 'sourceSampleIndex');
    if (
      sourceSampleIndex < segment.sourceStartSampleIndex
      || sourceSampleIndex > segment.sourcePerformanceEndSampleIndex
    ) {
      throw new Error('Source sample is outside the segment performance-owned range.');
    }
    return segment.performanceStartMs
      + (sourceSampleIndex - segment.sourceStartSampleIndex) / segment.sourceSampleRateHz * 1000;
  }

  performanceMsToSourceSampleIndex(
    segmentId: string,
    performanceMs: number,
    rounding: 'floor' | 'ceil' | 'round' = 'floor'
  ): number {
    const segment = this.segmentById(segmentId);
    if (!Number.isFinite(performanceMs) || performanceMs < segment.performanceStartMs) {
      throw new Error('Performance time is outside the segment performance-owned range.');
    }
    const performanceEndMs = this.sourceSampleIndexToPerformanceMs(
      segmentId,
      segment.sourcePerformanceEndSampleIndex
    );
    if (performanceMs > performanceEndMs) {
      throw new Error('Performance time is outside the segment performance-owned range.');
    }
    const exact = segment.sourceStartSampleIndex
      + (performanceMs - segment.performanceStartMs) / 1000 * segment.sourceSampleRateHz;
    if (rounding === 'ceil') return Math.ceil(exact);
    if (rounding === 'round') return Math.round(exact);
    return Math.floor(exact);
  }

  performanceRangeToSourceSampleRange(
    segmentId: string,
    performanceStartMs: number,
    performanceEndMs: number
  ): { sourceStartSampleIndex: number; sourceEndSampleIndex: number } {
    if (performanceEndMs < performanceStartMs) {
      throw new Error('Performance range end must not precede start.');
    }
    return {
      sourceStartSampleIndex: this.performanceMsToSourceSampleIndex(segmentId, performanceStartMs, 'floor'),
      sourceEndSampleIndex: this.performanceMsToSourceSampleIndex(segmentId, performanceEndMs, 'ceil'),
    };
  }

  debugSegmentBlockCount(segmentId: string): number {
    return this.segmentById(segmentId).blocks.length;
  }

  debugLastExtractVisitedBlockCount(): number {
    return this.lastExtractVisitedBlockCount;
  }

  private requireActiveSegment(message: string): MutableSegment {
    if (!this.activeSegment) {
      throw new Error(message);
    }
    return this.activeSegment;
  }

  private segmentById(segmentId: string): MutableSegment {
    const segment = this.segments.find((item) => item.segmentId === segmentId);
    if (!segment) {
      throw new Error(`Unknown performance PCM segment '${segmentId}'.`);
    }
    return segment;
  }

  private validateStableSourceSampleRate(sourceSampleRateHz: number): void {
    if (this.sourceSampleRateHz === null) {
      this.sourceSampleRateHz = sourceSampleRateHz;
      return;
    }
    if (this.sourceSampleRateHz !== sourceSampleRateHz) {
      throw new Error('PCM source sample rate cannot change within one capture timeline.');
    }
  }

  private validateBlockForActiveSegment(block: PcmCaptureBlock): void {
    const segment = this.requireActiveSegment('Performance PCM can only be appended while RUNNING.');
    validatePcmCaptureBlock(block);
    this.validateStableSourceSampleRate(block.sourceSampleRateHz);
    if (block.sourceSampleRateHz !== segment.sourceSampleRateHz) {
      throw new Error('PCM block sample rate must match its RUNNING segment.');
    }
    if (block.sourceStartSampleIndex !== segment.sourceContextTailEndSampleIndex) {
      throw new Error('PCM block source samples must be chronological and non-overlapping.');
    }
  }

  private readonlySegment(segment: MutableSegment): PerformancePcmSegment {
    return {
      segmentId: segment.segmentId,
      performanceStartMs: segment.performanceStartMs,
      sourceSampleRateHz: segment.sourceSampleRateHz,
      sourceStartSampleIndex: segment.sourceStartSampleIndex,
      sourcePerformanceEndSampleIndex: segment.sourcePerformanceEndSampleIndex,
      sourceContextTailEndSampleIndex: segment.sourceContextTailEndSampleIndex,
    };
  }
}

export function validatePcmCaptureBlock(block: PcmCaptureBlock): void {
  validateSourceSampleRate(block.sourceSampleRateHz);
  validateSourceSampleIndex(block.sourceStartSampleIndex, 'sourceStartSampleIndex');
  validateSourceSampleIndex(block.sourceEndSampleIndex, 'sourceEndSampleIndex');
  if (block.sourceEndSampleIndex < block.sourceStartSampleIndex) {
    throw new Error('PCM block end sample must not precede start sample.');
  }
  if (block.samples.length !== block.sourceEndSampleIndex - block.sourceStartSampleIndex) {
    throw new Error('PCM block sample length must match its source sample range.');
  }
}

function validateSourceSampleRate(sourceSampleRateHz: number): void {
  if (!Number.isFinite(sourceSampleRateHz) || sourceSampleRateHz <= 0) {
    throw new Error('PCM source sample rate must be finite and positive.');
  }
}

function validateSourceSampleIndex(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`PCM ${label} must be a non-negative integer.`);
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
        sourceStartSampleIndex: segment.sourceContextTailEndSampleIndex + readOffset,
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
