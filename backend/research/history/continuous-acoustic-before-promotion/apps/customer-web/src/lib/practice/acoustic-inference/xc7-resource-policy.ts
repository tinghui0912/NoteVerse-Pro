import { validatePcmCaptureBlock, type PcmCaptureBlock, type PerformancePcmSegment } from '../audio-analysis/capture/performance-pcm-timeline';

export const MAX_OUTSTANDING_ACOUSTIC_WINDOWS = 4;
export const MAX_DIAGNOSTIC_WINDOWS = 32;
export const MAX_ACOUSTIC_EVENTS_PER_WINDOW = 183 * 88;
export const MODEL_INPUT_BYTES = 29120 * Float32Array.BYTES_PER_ELEMENT;

/** One acoustic session segment, identities only. Deliberately has no PCM/extract API. */
export class AcousticSegmentMetadataLedger {
  readonly retainedPcmBytes = 0;
  private segment: PerformancePcmSegment | null = null;
  private sealed = false;

  beginRunningSegment(input: { performanceStartMs: number; sourceSampleRateHz: number; sourceStartSampleIndex: number }) {
    if (this.segment || !Number.isFinite(input.performanceStartMs) || input.performanceStartMs < 0
      || !Number.isSafeInteger(input.sourceStartSampleIndex) || input.sourceStartSampleIndex < 0
      || !Number.isFinite(input.sourceSampleRateHz) || input.sourceSampleRateHz <= 0) throw new Error('XC7_SEGMENT_IDENTITY');
    this.segment = { ...input, segmentId: 'segment-0', sourcePerformanceEndSampleIndex: input.sourceStartSampleIndex,
      sourceContextTailEndSampleIndex: input.sourceStartSampleIndex };
    return { ...this.segment };
  }
  appendRunningPcm(block: PcmCaptureBlock) { return this.append(block, false); }
  appendContextTail(block: PcmCaptureBlock) { return this.append(block, true); }
  sealRunningSegment() { this.sealed = true; return this.segment ? { ...this.segment } : null; }
  snapshot(): readonly PerformancePcmSegment[] { return this.segment ? [{ ...this.segment }] : []; }

  private append(block: PcmCaptureBlock, tail: boolean) {
    validatePcmCaptureBlock(block);
    const s = this.segment;
    if (!s || this.sealed || block.sourceSampleRateHz !== s.sourceSampleRateHz
      || block.sourceStartSampleIndex !== s.sourceContextTailEndSampleIndex
      || (!tail && s.sourceContextTailEndSampleIndex !== s.sourcePerformanceEndSampleIndex)) throw new Error('XC7_SEGMENT_CHRONOLOGY');
    if (!tail) s.sourcePerformanceEndSampleIndex = block.sourceEndSampleIndex;
    s.sourceContextTailEndSampleIndex = block.sourceEndSampleIndex;
    return { ...s };
  }
}

export function retainDiagnostic<T>(ring: T[], item: T): void {
  if (ring.length === MAX_DIAGNOSTIC_WINDOWS) ring.shift();
  ring.push(item);
}
