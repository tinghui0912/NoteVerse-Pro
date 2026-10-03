import { describe, expect, it } from 'vitest';

import type { PerformancePcmSegment } from '../capture/performance-pcm-timeline';
import { batchTranscriptionWindows, planTranscriptionWindows } from './chunk-planner';
import { stitchObservedAttacks } from './event-stitcher';
import { reconcilePerformance, type ExpectedStrike } from './performance-reconciler';
import { ContinuousTranscriptionQueue } from './transcription-queue';
import type { ContinuousTranscriptionContract } from './transcription-contract';

const contract: ContinuousTranscriptionContract = {
  contractId: 'test-contract',
  sampleRateHz: 16_000,
  inputSamplesPerWindow: 16_000,
  windowStrideSamples: 4_000,
  trustedOutputStartSamples: 4_000,
  trustedOutputEndSamples: 8_000,
  futureContextSamples: 1_600,
  batchSize: 2,
};

const segment: PerformancePcmSegment = {
  segmentId: 'segment-0',
  performanceStartMs: 0,
  sampleStart: 0,
  sampleEnd: 24_000,
  contextTailEnd: 25_600,
};

describe('continuous transcription foundation', () => {
  it('plans ordered windows without dropping terminal partial batches', () => {
    const windows = planTranscriptionWindows({ segment, contract, sealed: true });
    const batches = batchTranscriptionWindows({ windows, batchSize: contract.batchSize });

    expect(windows.map((window) => [
      window.inputStartSample,
      window.trustedStartSample,
      window.trustedEndSample,
    ])).toEqual([
      [0, 4_000, 8_000],
      [4_000, 8_000, 12_000],
      [8_000, 12_000, 16_000],
    ]);
    expect(batches.map((batch) => batch.windows.length)).toEqual([2, 1]);
  });

  it('publishes transcription results in FIFO coverage order even when workers finish out of order', () => {
    const windows = planTranscriptionWindows({ segment, contract, sealed: true });
    const [first, second] = batchTranscriptionWindows({ windows, batchSize: 1 });
    const queue = new ContinuousTranscriptionQueue<string>();
    queue.enqueue(first);
    queue.enqueue(second);
    expect(queue.claimNext()?.sequence).toBe(0);
    expect(queue.claimNext()?.sequence).toBe(1);

    expect(queue.complete(1, 'second')).toEqual([]);
    expect(queue.complete(0, 'first')).toEqual(['first', 'second']);
    expect(queue.snapshot().queuedBatchCount).toBe(0);
  });

  it('deduplicates overlapping transcription attacks while preserving real retriggers', () => {
    const stitched = stitchObservedAttacks({
      previous: [{ observationId: 'a', pitch: 'C4', performanceTimeMs: 100, confidence: 0.7, source: 'ACOUSTIC' }],
      incoming: [
        { observationId: 'b', pitch: 'C4', performanceTimeMs: 105, confidence: 0.9, source: 'ACOUSTIC' },
        { observationId: 'c', pitch: 'C4', performanceTimeMs: 300, confidence: 0.8, source: 'ACOUSTIC' },
      ],
      duplicateWindowMs: 20,
    });

    expect(stitched.map((attack) => attack.observationId)).toEqual(['b', 'c']);
  });

  it('assigns dense repeated pitches one-to-one by minimum timing error', () => {
    const expected: ExpectedStrike[] = [
      strike('s1', 'C4', 0),
      strike('s2', 'C4', 300),
    ];
    const result = reconcilePerformance({
      expectedStrikes: expected,
      observedAttacks: [
        { observationId: 'o1', pitch: 'C4', performanceTimeMs: 180, confidence: 0.9, source: 'ACOUSTIC' },
        { observationId: 'o2', pitch: 'C4', performanceTimeMs: 320, confidence: 0.9, source: 'ACOUSTIC' },
      ],
      analyzedThroughPerformanceMs: 600,
      assignmentWindowMs: 250,
      completion: { kind: 'NATURAL', terminalPerformanceMs: 600 },
    });

    expect(result.strikes.map((item) => [item.strikeId, item.verdict, item.matchedObservationId])).toEqual([
      ['s1', 'MATCHED', 'o1'],
      ['s2', 'MATCHED', 'o2'],
    ]);
    expect(result.extras).toEqual([]);
  });

  it('derives partial chord and wrong-pitch feedback from strike assignments', () => {
    const expected: ExpectedStrike[] = [
      strike('c', 'C4', 0),
      strike('e', 'E4', 0),
      strike('g', 'G4', 0),
    ];
    const result = reconcilePerformance({
      expectedStrikes: expected,
      observedAttacks: [
        { observationId: 'o-c', pitch: 'C4', performanceTimeMs: 20, confidence: 0.9, source: 'ACOUSTIC' },
        { observationId: 'o-f', pitch: 'F#4', performanceTimeMs: 20, confidence: 0.9, source: 'ACOUSTIC' },
      ],
      analyzedThroughPerformanceMs: 300,
      assignmentWindowMs: 250,
      completion: { kind: 'NATURAL', terminalPerformanceMs: 300 },
    });

    expect(result.strikes.map((item) => [item.pitch, item.verdict])).toEqual([
      ['C4', 'MATCHED'],
      ['E4', 'MISSING'],
      ['G4', 'MISSING'],
    ]);
    expect(result.extras.map((attack) => attack.pitch)).toEqual(['F#4']);
  });

  it('keeps manual-stop tail strikes NOT_REACHED instead of MISSING', () => {
    const result = reconcilePerformance({
      expectedStrikes: [
        strike('old', 'C4', 0),
        strike('tail', 'D4', 900),
      ],
      observedAttacks: [],
      analyzedThroughPerformanceMs: 1_000,
      assignmentWindowMs: 250,
      completion: { kind: 'MANUAL', stoppedAtPerformanceMs: 1_000 },
    });

    expect(result.strikes.map((item) => [item.strikeId, item.verdict])).toEqual([
      ['old', 'MISSING'],
      ['tail', 'NOT_REACHED'],
    ]);
  });
});

function strike(strikeId: string, pitch: string, expectedPerformanceTimeMs: number): ExpectedStrike {
  return {
    strikeId,
    groupId: `group-${strikeId}`,
    pitch,
    expectedPerformanceTimeMs,
    renderNoteIds: [`note-${strikeId}`],
  };
}
