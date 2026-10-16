import { ContinuousAcousticRuntime } from './acoustic-runtime';
import { fail, onlyFields, safeIndex } from './model-contract';
import { ACOUSTIC_RESOURCES as R } from './resource-policy';

export type CaptureChunk = Readonly<{
  type: 'pcm-chunk'; sequence: number; sourceSampleRateHz: number;
  sourceStartSampleIndex: number; sourceEndSampleIndex: number;
  audioContextStartFrame: number; inputChannelCount: number; captureTimeSeconds: number;
  samples: Float32Array;
}>;
export type AcousticBoundary = Readonly<{
  type: 'BEGIN' | 'PAUSE' | 'TERMINAL'; sourceSampleIndex: number; performanceTimeMs: number;
}>;

/** Source chronology only. Transport supplies boundaries; analysis cannot mutate transport. */
export class ContinuousCaptureBridge {
  private nextSequence = 0;
  private nextSource = 0;
  private contextOriginFrame: number | null = null;
  private readonly boundaries: AcousticBoundary[] = [];
  private failed = false;
  private readonly chunkSizes: Record<string, number> = {};
  private blocks = 0;
  constructor(readonly runtime: ContinuousAcousticRuntime, private readonly rate: number) {}
  schedule(boundary: AcousticBoundary): void {
    try {
      onlyFields(boundary, ['type', 'sourceSampleIndex', 'performanceTimeMs']); safeIndex(boundary.sourceSampleIndex);
      if (this.failed || boundary.sourceSampleIndex < this.nextSource
        || !Number.isFinite(boundary.performanceTimeMs) || boundary.performanceTimeMs < 0
        || !['BEGIN', 'PAUSE', 'TERMINAL'].includes(boundary.type)) fail('INVALID_CAPTURE_BOUNDARY');
      if (this.boundaries.length >= R.maxScheduledBoundaries) fail('CAPTURE_BOUNDARY_LIMIT_EXCEEDED');
      if (this.boundaries.length && boundary.sourceSampleIndex < this.boundaries[this.boundaries.length - 1].sourceSampleIndex) fail('NONCHRONOLOGICAL_CAPTURE_BOUNDARY');
      this.boundaries.push(Object.freeze({ ...boundary }));
      this.applyBoundaries();
    } catch (error) { this.abort(error); throw error; }
  }
  receive(chunk: CaptureChunk): void {
    try {
      if (this.failed) fail('ACOUSTIC_CAPTURE_FAILED');
      onlyFields(chunk, ['type', 'sequence', 'sourceSampleRateHz', 'sourceStartSampleIndex', 'sourceEndSampleIndex',
        'audioContextStartFrame', 'inputChannelCount', 'captureTimeSeconds', 'samples']);
      safeIndex(chunk.audioContextStartFrame); safeIndex(chunk.sourceStartSampleIndex); safeIndex(chunk.sourceEndSampleIndex);
      if (chunk.type !== 'pcm-chunk' || chunk.sequence !== this.nextSequence || chunk.sourceSampleRateHz !== this.rate
        || chunk.sourceStartSampleIndex !== this.nextSource || !(chunk.samples instanceof Float32Array)
        || chunk.samples.length <= 0 || chunk.samples.length > R.maxSourceBlockSamples
        || chunk.sourceEndSampleIndex - chunk.sourceStartSampleIndex !== chunk.samples.length
        || !Number.isInteger(chunk.inputChannelCount) || chunk.inputChannelCount < 1
        || !Number.isFinite(chunk.captureTimeSeconds)
        || Math.abs(chunk.captureTimeSeconds - chunk.audioContextStartFrame / this.rate) > 1e-5) fail('CAPTURE_CHRONOLOGY_VIOLATION');
      const origin = chunk.audioContextStartFrame - chunk.sourceStartSampleIndex;
      if (this.contextOriginFrame !== null && origin !== this.contextOriginFrame) fail('CAPTURE_CONTEXT_FRAME_GAP');
      this.contextOriginFrame = origin;
      let offset = 0;
      while (offset < chunk.samples.length) {
        this.applyBoundaries();
        const end = Math.min(chunk.sourceEndSampleIndex, this.boundaries[0]?.sourceSampleIndex ?? Infinity);
        const length = end - this.nextSource;
        this.runtime.append({ sourceSampleRateHz: this.rate, sourceStartSampleIndex: this.nextSource,
          sourceEndSampleIndex: end, samples: chunk.samples.subarray(offset, offset + length) });
        offset += length; this.nextSource = end;
      }
      this.applyBoundaries(); this.nextSequence++; this.blocks++;
      const key = String(chunk.samples.length);
      if (key in this.chunkSizes || Object.keys(this.chunkSizes).length < 32) this.chunkSizes[key] = (this.chunkSizes[key] ?? 0) + 1;
      else this.chunkSizes.OTHER = (this.chunkSizes.OTHER ?? 0) + 1;
    } catch (error) { this.abort(error); throw error; }
  }
  abort(error: unknown): void { this.failed = true; this.boundaries.length = 0; this.runtime.failAnalysis(error); }
  snapshot() { return Object.freeze({ nextSourceSampleIndex: this.nextSource, nextSequence: this.nextSequence,
    audioContextOriginFrame: this.contextOriginFrame, blocks: this.blocks, chunkSizes: Object.freeze({ ...this.chunkSizes }), failed: this.failed }); }
  private applyBoundaries(): void {
    while (this.boundaries[0]?.sourceSampleIndex === this.nextSource) {
      const boundary = this.boundaries.shift()!;
      if (boundary.type === 'BEGIN') this.runtime.beginSegment(boundary.performanceTimeMs);
      else if (boundary.type === 'PAUSE') this.runtime.endSegment(boundary.performanceTimeMs);
      else this.runtime.requestTerminal(boundary.performanceTimeMs);
    }
  }
}
