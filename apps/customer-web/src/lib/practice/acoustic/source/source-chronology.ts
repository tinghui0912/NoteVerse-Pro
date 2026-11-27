import { fail } from '../errors';
import { onlyFields, safeIndex } from '../validation';
import { CAPTURE_TRANSPORT_BLOCK_SAMPLES } from './capture-transport-contract';
import type { CaptureChunk } from './capture-types';

/** Validates the Worklet source domain independently of any mode boundaries. */
export class SourceChronology {
  private nextSequence = 0;
  private nextSource = 0;
  private origin: number | null = null;
  private readonly sizes: Record<string, number> = {};
  constructor(private readonly rate: number) {}
  accept(chunk: CaptureChunk): void {
    onlyFields(chunk, ['type', 'sequence', 'sourceSampleRateHz', 'sourceStartSampleIndex', 'sourceEndSampleIndex',
      'audioContextStartFrame', 'inputChannelCount', 'captureTimeSeconds', 'samples']);
    safeIndex(chunk.audioContextStartFrame); safeIndex(chunk.sourceStartSampleIndex); safeIndex(chunk.sourceEndSampleIndex);
    if (chunk.type !== 'pcm-chunk' || chunk.sequence !== this.nextSequence || chunk.sourceSampleRateHz !== this.rate
      || chunk.sourceStartSampleIndex !== this.nextSource || !(chunk.samples instanceof Float32Array)
      || chunk.samples.length <= 0 || chunk.samples.length > CAPTURE_TRANSPORT_BLOCK_SAMPLES
      || chunk.sourceEndSampleIndex - chunk.sourceStartSampleIndex !== chunk.samples.length
      || !Number.isInteger(chunk.inputChannelCount) || chunk.inputChannelCount < 1 || !Number.isFinite(chunk.captureTimeSeconds)
      || Math.abs(chunk.captureTimeSeconds - chunk.audioContextStartFrame / this.rate) > 1e-5) fail('CAPTURE_CHRONOLOGY_VIOLATION');
    const origin = chunk.audioContextStartFrame - chunk.sourceStartSampleIndex;
    if (this.origin !== null && origin !== this.origin) fail('CAPTURE_CONTEXT_FRAME_GAP');
    this.origin = origin; this.nextSource = chunk.sourceEndSampleIndex; this.nextSequence++;
    const key = String(chunk.samples.length);
    if (key in this.sizes || Object.keys(this.sizes).length < 32) this.sizes[key] = (this.sizes[key] ?? 0) + 1;
    else this.sizes.OTHER = (this.sizes.OTHER ?? 0) + 1;
  }
  snapshot() { return Object.freeze({ nextSequence: this.nextSequence, audioContextOriginFrame: this.origin,
    blocks: this.nextSequence, chunkSizes: Object.freeze({ ...this.sizes }) }); }
}
