import type { PerformancePcmSegment } from '../capture/performance-pcm-timeline';
import { assertContinuousTranscriptionContract, type ContinuousTranscriptionContract } from './transcription-contract';

export type TranscriptionWindow = {
  windowId: string;
  segmentId: string;
  inputStartSample: number;
  inputEndSample: number;
  trustedStartSample: number;
  trustedEndSample: number;
};

export type TranscriptionBatchJob = {
  sequence: number;
  windows: readonly TranscriptionWindow[];
};

export function planTranscriptionWindows(input: {
  segment: PerformancePcmSegment;
  contract: ContinuousTranscriptionContract;
  sealed: boolean;
}): TranscriptionWindow[] {
  assertContinuousTranscriptionContract(input.contract);
  const windows: TranscriptionWindow[] = [];
  const {
    inputSamplesPerWindow,
    windowStrideSamples,
    trustedOutputStartSamples,
    trustedOutputEndSamples,
    futureContextSamples,
  } = input.contract;
  const availableEnd = input.sealed ? input.segment.contextTailEnd : input.segment.sampleEnd;
  for (
    let inputStartSample = input.segment.sampleStart;
    inputStartSample + inputSamplesPerWindow <= availableEnd;
    inputStartSample += windowStrideSamples
  ) {
    const inputEndSample = inputStartSample + inputSamplesPerWindow;
    const trustedStartSample = inputStartSample + trustedOutputStartSamples;
    const trustedEndSample = inputStartSample + trustedOutputEndSamples;
    const requiresFutureThrough = trustedEndSample + futureContextSamples;
    if (requiresFutureThrough > availableEnd) {
      break;
    }
    if (trustedStartSample >= input.segment.sampleEnd) {
      break;
    }
    windows.push({
      windowId: `${input.segment.segmentId}:${inputStartSample}`,
      segmentId: input.segment.segmentId,
      inputStartSample,
      inputEndSample,
      trustedStartSample,
      trustedEndSample: Math.min(trustedEndSample, input.segment.sampleEnd),
    });
  }
  return windows;
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
    batches.push({
      sequence: batches.length,
      windows: input.windows.slice(index, index + input.batchSize),
    });
  }
  return batches;
}
