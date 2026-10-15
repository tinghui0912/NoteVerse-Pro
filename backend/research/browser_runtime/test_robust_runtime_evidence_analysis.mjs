import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows, describe } from './robust_runtime_evidence_analysis.mjs';

const rows = values => values.map((processingMs, index) => ({ processingMs, queueDelayMs: 0,
  scheduledReadyTimestamp: index * 600, receiveTimestamp: index * 600,
  publicationFinishTimestamp: index * 600 + processingMs, outstandingDepth: 1,
  readyMs: 1820 + index * 600, inputWindowEndMs: 1820 + index * 600,
  ownedStartMs: 1000 + index * 600, ownedEndMs: 1600 + index * 600 }));

test('quantiles use linear interpolation; thresholds are strict greater-than', () => {
  assert.equal(describe([0, 10]).p95, 9.5);
  const result = analyzeRows(rows([480, 540, 600, 608, 609, 480, 600, 601]));
  assert.equal(result.over480ms.count, 6);
  assert.equal(result.over600ms.count, 3);
  assert.equal(result.over608ms.count, 1);
  assert.equal(result.consecutiveOver600ms.longestWindows, 2);
});

test('reserve failure is separate from causal sustainability and source age', () => {
  const result = analyzeRows(rows(Array(100).fill(550)));
  assert.equal(result.conservativeHeadroom.status, 'ROBUST_20_PERCENT_HEADROOM_FAIL');
  assert.equal(result.cadenceSustainability.status, 'ROBUST_CADENCE_SUSTAINABLE');
  assert.equal(result.publicationLatency.captureReadyToPublicationMs.p50, 550);
  assert.equal(result.publicationLatency.oldestOwnedSourceTimeToPublicationMs.p50, 1370);
  assert.equal(result.publicationLatency.nearOwnedEndSourceTimeToPublicationMs.p50, 770);
});

test('queue episodes and long-session drift are computed from real row coordinates', () => {
  const data = rows(Array.from({ length: 400 }, (_, index) => 200 + index));
  data[5].queueDelayMs = 0.1; data[6].queueDelayMs = 9; data[7].queueDelayMs = 10;
  data[6].outstandingDepth = 2;
  const result = analyzeRows(data);
  assert.equal(result.queue.positiveDelayEpisodes.longestWindows, 3);
  assert.equal(result.queue.beyondExisting8msJitterEpisodes.longestWindows, 2);
  assert.equal(result.minuteBins.length, 4);
  assert.equal(result.temporalDrift.status, 'LONG_SESSION_RUNTIME_DRIFT_PRESENT');
  assert.equal(result.queue.finalQueueDelayMs, 0);
});
