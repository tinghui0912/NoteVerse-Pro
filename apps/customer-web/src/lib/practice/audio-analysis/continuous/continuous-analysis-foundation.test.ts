import { describe, expect, it } from 'vitest';

import { PerformancePcmTimeline, type PerformancePcmSegment } from '../capture/performance-pcm-timeline';
import { batchTranscriptionWindows, ContinuousChunkPlanner } from './chunk-planner';
import { reconcilePerformance, type ExpectedStrike } from './performance-reconciler';
import { ContinuousTranscriptionQueue } from './transcription-queue';
import type { ContinuousTranscriptionContract } from './transcription-contract';

const contract: ContinuousTranscriptionContract = {
  contractId: 'test-contract',
  sampleRateHz: 16_000,
  inputSamplesPerWindow: 16_000,
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
  contextTailEnd: 32_000,
};

describe('continuous transcription foundation', () => {
  it('plans half-open trusted ownership from the segment start without dropping terminal partial batches', () => {
    const planner = new ContinuousChunkPlanner(contract);
    const windows = planner.planReadyWindows({ segment, sealed: true });
    const batches = batchTranscriptionWindows({ windows, batchSize: contract.batchSize });

    expect(windows.map((window) => [
      window.ownedTrustedStartSample,
      window.ownedTrustedEndSample,
      window.logicalInputStartSample,
      window.logicalInputEndSample,
      window.leftZeroPaddingSamples,
    ])).toEqual([
      [0, 4_000, -4_000, 12_000, 4_000],
      [4_000, 8_000, 0, 16_000, 0],
      [8_000, 12_000, 4_000, 20_000, 0],
      [12_000, 16_000, 8_000, 24_000, 0],
      [16_000, 20_000, 12_000, 28_000, 0],
      [20_000, 24_000, 16_000, 32_000, 0],
    ]);
    expect(windows.every((window, index) =>
      index === 0 || windows[index - 1].ownedTrustedEndSample === window.ownedTrustedStartSample
    )).toBe(true);
    expect(batches.map((batch) => [
      batch.windows.length,
      batch.ownedTrustedStartSample,
      batch.ownedTrustedEndSample,
    ])).toEqual([
      [2, 0, 8_000],
      [2, 8_000, 16_000],
      [2, 16_000, 24_000],
    ]);
  });

  it('only returns newly ready windows on later planning calls', () => {
    const planner = new ContinuousChunkPlanner(contract);
    const first = planner.planReadyWindows({
      segment: { ...segment, sampleEnd: 16_000, contextTailEnd: 16_000 },
      sealed: false,
    });
    const second = planner.planReadyWindows({
      segment: { ...segment, sampleEnd: 24_000, contextTailEnd: 24_000 },
      sealed: false,
    });
    expect(first.map((window) => window.ownedTrustedStartSample)).toEqual([0, 4_000]);
    expect(second.map((window) => window.ownedTrustedStartSample)).toEqual([8_000, 12_000]);
  });

  it('publishes transcription results in FIFO coverage order even when workers finish out of order', () => {
    const windows = new ContinuousChunkPlanner(contract).planReadyWindows({ segment, sealed: true });
    const [first, second] = batchTranscriptionWindows({ windows, batchSize: 1 });
    const queue = new ContinuousTranscriptionQueue<string>();
    queue.enqueue(first);
    queue.enqueue(second);
    expect(queue.claimNext()?.sequence).toBe(0);
    expect(queue.claimNext()?.sequence).toBe(1);

    expect(queue.complete(1, 'second')).toEqual([]);
    expect(queue.complete(0, 'first').map((published) => [
      published.result,
      published.ownedTrustedStartSample,
      published.ownedTrustedEndSample,
    ])).toEqual([
      ['first', 0, 4_000],
      ['second', 4_000, 8_000],
    ]);
    queue.seal();
    expect(queue.snapshot().lifecycle).toBe('DRAINED');
    expect(queue.snapshot().queuedBatchCount).toBe(0);
  });

  it('assigns global queue sequences across multiple planner enqueue calls', () => {
    const planner = new ContinuousChunkPlanner(contract);
    const firstWindows = planner.planReadyWindows({
      segment: { ...segment, sampleEnd: 16_000, contextTailEnd: 16_000 },
      sealed: false,
    });
    const secondWindows = planner.planReadyWindows({
      segment: { ...segment, sampleEnd: 24_000, contextTailEnd: 24_000 },
      sealed: false,
    });
    const queue = new ContinuousTranscriptionQueue<string>();
    for (const batch of batchTranscriptionWindows({ windows: firstWindows, batchSize: 1 })) {
      queue.enqueue(batch);
    }
    for (const batch of batchTranscriptionWindows({ windows: secondWindows, batchSize: 1 })) {
      queue.enqueue(batch);
    }

    expect([
      queue.claimNext()?.sequence,
      queue.claimNext()?.sequence,
      queue.claimNext()?.sequence,
      queue.claimNext()?.sequence,
    ]).toEqual([0, 1, 2, 3]);
  });

  it('stores tiny capture chunks in coarse PCM blocks and extracts from the tail without scanning all chunks', () => {
    const timeline = new PerformancePcmTimeline(16_000, 8_192);
    const active = timeline.beginRunningSegment(0);
    const chunk = new Float32Array(128);
    for (let index = 0; index < 4_688; index += 1) {
      chunk.fill(index);
      timeline.appendRunningPcm(chunk);
    }
    const sealed = timeline.sealRunningSegment() ?? active;
    expect(sealed.sampleEnd).toBe(600_064);
    expect(timeline.debugSegmentBlockCount(sealed.segmentId)).toBeLessThan(80);

    const tail = timeline.extract(sealed.segmentId, sealed.sampleEnd - 512, sealed.sampleEnd);
    expect(tail.length).toBe(512);
    expect(timeline.debugLastExtractVisitedBlockCount()).toBeLessThanOrEqual(2);
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

    expect(result.strikes.map((item) => [
      item.strikeId,
      item.verdict,
      item.verdict === 'MATCHED' ? item.matchedObservationId : null,
    ])).toEqual([
      ['s1', 'MATCHED', 'o1'],
      ['s2', 'MATCHED', 'o2'],
    ]);
    expect(result.extras).toEqual([]);
  });

  it('maximizes legitimate repeated-pitch matches before minimizing timing error', () => {
    const expected: ExpectedStrike[] = [
      strike('first', 'C4', 0),
      strike('second', 'C4', 100),
    ];
    const result = reconcilePerformance({
      expectedStrikes: expected,
      observedAttacks: [
        { observationId: 'late-for-first', pitch: 'C4', performanceTimeMs: 40, confidence: 0.9, source: 'MIDI' },
        { observationId: 'early-for-first', pitch: 'C4', performanceTimeMs: -50, confidence: 0.9, source: 'MIDI' },
      ],
      analyzedThroughPerformanceMs: 200,
      assignmentWindowMs: 60,
      completion: { kind: 'NATURAL', terminalPerformanceMs: 200 },
    });

    expect(result.strikes.map((item) => [
      item.strikeId,
      item.verdict,
      item.verdict === 'MATCHED' ? item.matchedObservationId : null,
    ])).toEqual([
      ['first', 'MATCHED', 'early-for-first'],
      ['second', 'MATCHED', 'late-for-first'],
    ]);
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
