import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyBacklog } from './xc1_browser_semantics.mjs';
import { atomicJson } from './xc1_artifacts.mjs';

export function describe(values) {
  if (values.some(value => !Number.isFinite(value))) throw new Error('NON_FINITE_RUNTIME_EVIDENCE');
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, mean: null, p25: null, p50: null, p75: null, p90: null, p95: null, p99: null, p99_5: null, max: null };
  const q = fraction => {
    const at = (sorted.length - 1) * fraction, low = Math.floor(at), high = Math.ceil(at);
    return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
  };
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p95: q(0.95), p99: q(0.99), p99_5: q(0.995), max: sorted.at(-1) };
}

export function consecutiveEpisodes(rows, predicate) {
  const episodes = [];
  let start = null;
  const close = end => {
    if (start === null) return;
    const first = rows[start], last = rows[end];
    episodes.push({ startRow: start, endRow: end, count: end - start + 1,
      sourceReadyStartMs: first.readyMs, sourceReadyEndMs: last.readyMs,
      producerSpanMs: last.scheduledReadyTimestamp - first.scheduledReadyTimestamp + 600,
      receiveToLastCompletionMs: last.publicationFinishTimestamp - first.receiveTimestamp });
    start = null;
  };
  rows.forEach((row, index) => { if (predicate(row)) start ??= index; else close(index - 1); });
  close(rows.length - 1);
  return { count: episodes.length, longestWindows: Math.max(0, ...episodes.map(episode => episode.count)),
    longestEpisode: episodes.reduce((best, episode) => !best || episode.count > best.count ? episode : best, null) };
}

export function analyzeRows(rows) {
  if (!rows.length) throw new Error('NO_RUNTIME_ROWS');
  const processing = rows.map(row => row.processingMs), queue = rows.map(row => row.queueDelayMs);
  const over = threshold => { const count = processing.filter(value => value > threshold).length; return { count, fraction: count / rows.length }; };
  const origin = rows[0].scheduledReadyTimestamp;
  const bins = new Map();
  for (const row of rows) {
    const index = Math.floor((row.scheduledReadyTimestamp - origin) / 60000);
    if (!bins.has(index)) bins.set(index, []);
    bins.get(index).push(row);
  }
  const minuteBins = [...bins].map(([index, group]) => ({ startSeconds: index * 60, endSeconds: (index + 1) * 60,
    processingMs: describe(group.map(row => row.processingMs)), queueDelayMs: describe(group.map(row => row.queueDelayMs)),
    over600msCount: group.filter(row => row.processingMs > 600).length }));
  const quartileCount = Math.max(1, Math.floor(rows.length / 4));
  const firstQuartile = describe(processing.slice(0, quartileCount)), lastQuartile = describe(processing.slice(-quartileCount));
  const binTimes = minuteBins.map(bin => bin.startSeconds / 60), binMedians = minuteBins.map(bin => bin.processingMs.p50);
  const meanX = binTimes.reduce((a, b) => a + b, 0) / binTimes.length;
  const meanY = binMedians.reduce((a, b) => a + b, 0) / binMedians.length;
  const denominator = binTimes.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  const slope = denominator ? binTimes.reduce((sum, x, index) => sum + (x - meanX) * (binMedians[index] - meanY), 0) / denominator : null;
  const backlog = classifyBacklog(rows, 600);
  const inputReadyAge = rows.map(row => row.publicationFinishTimestamp - row.scheduledReadyTimestamp);
  const oldestAge = rows.map((row, index) => inputReadyAge[index] + row.inputWindowEndMs - row.ownedStartMs);
  const nearOwnedEndAge = rows.map((row, index) => inputReadyAge[index] + row.inputWindowEndMs - row.ownedEndMs);
  const drift = minuteBins.length >= 4 && slope > 0 && lastQuartile.p25 > firstQuartile.p75
    ? 'LONG_SESSION_RUNTIME_DRIFT_PRESENT' : 'INCONCLUSIVE';
  return { processingMs: describe(processing), over480ms: over(480), over540ms: over(540), over600ms: over(600), over608ms: over(608),
    consecutiveOver600ms: consecutiveEpisodes(rows, row => row.processingMs > 600),
    queue: { delayMs: describe(queue), nonzeroWindowCount: queue.filter(value => value > 0).length,
      positiveDelayEpisodes: consecutiveEpisodes(rows, row => row.queueDelayMs > 0),
      beyondExisting8msJitterEpisodes: consecutiveEpisodes(rows, row => row.queueDelayMs > 8),
      outstandingBacklogEpisodes: consecutiveEpisodes(rows, row => row.outstandingDepth > 1),
      maxOutstandingDepth: Math.max(...rows.map(row => row.outstandingDepth)), finalQueueDelayMs: queue.at(-1) },
    frozenBacklogDiagnostic: backlog, minuteBins,
    temporalDrift: { status: drift, rule: 'At least four 60s bins, positive bin-median OLS slope, and last-quartile P25 greater than first-quartile P75; otherwise INCONCLUSIVE.',
      firstQuartile, lastQuartile, binMedianSlopeMsPerMinute: slope,
      hardwareCause: 'NOT_ESTABLISHED_NO_TEMPERATURE_POWER_OR_GPU_CLOCK_TELEMETRY',
      confounders: ['Audio content and decoder workload vary with source time.', 'Host/GPU contention was not experimentally controlled.'] },
    conservativeHeadroom: { thresholdMs: 480, status: describe(processing).p95 <= 480 ? 'ROBUST_20_PERCENT_HEADROOM_PASS' : 'ROBUST_20_PERCENT_HEADROOM_FAIL' },
    cadenceSustainability: { status: backlog.noSustainedBacklog && queue.at(-1) <= 8 ? 'ROBUST_CADENCE_SUSTAINABLE' : 'ROBUST_CADENCE_NOT_SUSTAINABLE',
      rule: 'Existing frozen bounded-backlog diagnostic plus final receive-to-start queue delay within the existing 8ms jitter allowance.',
      scope: 'Observed finite-session causal cadence only; not a proof of indefinite operation.' },
    publicationLatency: { captureReadyToPublicationMs: describe(inputReadyAge),
      oldestOwnedSourceTimeToPublicationMs: describe(oldestAge), nearOwnedEndSourceTimeToPublicationMs: describe(nearOwnedEndAge),
      definitions: { captureReady: 'Full real acoustic window is available; excludes context/group fill before that point.',
        oldestOwned: 'Input-ready age plus inputWindowEndMs minus ownedStartMs.',
        nearOwnedEnd: 'Limiting age as event time approaches the half-open ownedEndMs from below.' },
      productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN' } };
}

export function analyzeReceipt(receipt) {
  if (receipt.schedulingMode !== 'causal') throw new Error('CAUSAL_EVIDENCE_REQUIRED');
  const rows = receipt.steadyRows ?? receipt.runtimeRows.filter(row => !row.shiftedFinalWindow);
  return { takeId: receipt.takeId, steady: analyzeRows(rows),
    terminalPartialWindow: (receipt.terminalResidualRows ?? receipt.runtimeRows?.filter(row => row.shiftedFinalWindow) ?? [])
      .map(row => ({ processingMs: row.processingMs, queueDelayMs: row.queueDelayMs, outstandingDepth: row.outstandingDepth,
        captureReadyToPublicationMs: row.publicationFinishTimestamp - row.scheduledReadyTimestamp,
        oldestOwnedSourceTimeToPublicationMs: row.publicationFinishTimestamp - row.scheduledReadyTimestamp + row.inputWindowEndMs - row.ownedStartMs })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].slice(2)] = process.argv[index + 1];
  const input = JSON.parse(await readFile(args.input, 'utf8'));
  const receipt = input.candidates?.['robust-browser-v1']?.receipts.find(row => row.takeId === args['take-id']) ?? input;
  await atomicJson(args.output, analyzeReceipt(receipt));
}
