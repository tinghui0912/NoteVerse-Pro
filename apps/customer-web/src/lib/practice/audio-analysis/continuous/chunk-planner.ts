import type { PerformancePcmSegment } from '../capture/performance-pcm-timeline';
import { assertContinuousTranscriptionContract, type ContinuousTranscriptionContract } from './transcription-contract';

export type TranscriptionWindow = {
  windowId: string;
  segmentId: string;
  ownedTrustedStartSample: number;
  ownedTrustedEndSample: number;
  modelAnchorSample: number;
  logicalInputStartSample: number;
  logicalInputEndSample: number;
  realInputStartSample: number;
  realInputEndSample: number;
  leftZeroPaddingSamples: number;
  futureContextEndSample: number;
};

export type TranscriptionBatchJob = {
  ownedTrustedStartSample: number;
  ownedTrustedEndSample: number;
  windows: readonly TranscriptionWindow[];
};

export class ContinuousChunkPlanner {
  private readonly cursors = new Map<string, number>();

  constructor(private readonly contract: ContinuousTranscriptionContract) {
    assertContinuousTranscriptionContract(contract);
  }

  planReadyWindows(input: {
    segment: PerformancePcmSegment;
    sealed: boolean;
  }): TranscriptionWindow[] {
    const windows: TranscriptionWindow[] = [];
    const segmentStart = input.segment.sampleStart;
    const availableEnd = input.sealed ? input.segment.contextTailEnd : input.segment.sampleEnd;
    const trustedWidth =
      this.contract.trustedOutputEndSamples - this.contract.trustedOutputStartSamples;
    let ownedTrustedStartSample = this.cursors.get(input.segment.segmentId) ?? segmentStart;

    while (ownedTrustedStartSample < input.segment.sampleEnd) {
      const ownedTrustedEndSample = Math.min(
        ownedTrustedStartSample + trustedWidth,
        input.segment.sampleEnd
      );
      const futureContextEndSample = ownedTrustedEndSample + this.contract.futureContextSamples;
      if (futureContextEndSample > availableEnd) {
        break;
      }
      const logicalInputStartSample = ownedTrustedStartSample - this.contract.trustedOutputStartSamples;
      const logicalInputEndSample = logicalInputStartSample + this.contract.inputSamplesPerWindow;
      if (logicalInputEndSample > availableEnd) {
        break;
      }
      const realInputStartSample = Math.max(segmentStart, logicalInputStartSample);
      const realInputEndSample = Math.min(logicalInputEndSample, availableEnd);
      windows.push({
        windowId: `${input.segment.segmentId}:${ownedTrustedStartSample}`,
        segmentId: input.segment.segmentId,
        ownedTrustedStartSample,
        ownedTrustedEndSample,
        modelAnchorSample: logicalInputStartSample + this.contract.trustedOutputStartSamples,
        logicalInputStartSample,
        logicalInputEndSample,
        realInputStartSample,
        realInputEndSample,
        leftZeroPaddingSamples: realInputStartSample - logicalInputStartSample,
        futureContextEndSample,
      });
      ownedTrustedStartSample = ownedTrustedEndSample;
    }

    this.cursors.set(input.segment.segmentId, ownedTrustedStartSample);
    return windows;
  }
}

export function batchTranscriptionWindows(input: {
  windows: readonly TranscriptionWindow[];
  batchSize: number;
}): TranscriptionBatchJob[] {
  if (!Number.isInteger(input.batchSize) || input.batchSize <= 0) {
    throw new Error('Transcription batch size must be a positive integer.');
  }
  const batches: TranscriptionBatchJob[] = [];
  for (let index = 0; index < input.windows.length; index += input.batchSize) {
    const windows = input.windows.slice(index, index + input.batchSize);
    if (windows.length === 0) {
      continue;
    }
    batches.push({
      ownedTrustedStartSample: windows[0].ownedTrustedStartSample,
      ownedTrustedEndSample: windows[windows.length - 1].ownedTrustedEndSample,
      windows,
    });
  }
  return batches;
}
