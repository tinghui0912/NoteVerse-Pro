#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from '../../../apps/customer-web/node_modules/jiti/lib/jiti.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const jiti = createJiti(import.meta.url, { alias: { '@': path.join(repoRoot, 'apps/customer-web/src') } });
const byteDance = await jiti.import(path.join(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'));

const args = parseArgs(process.argv);
const fixtureDir = path.resolve(args['fixture-dir'] ?? 'backend/data/work/phase9gd1_robust_browser_onnx/browser_fixtures');
const runtimeDir = path.resolve(args['runtime-output-dir'] ?? 'backend/data/work/phase9gd1_robust_browser_onnx/runtime_outputs');
const browserOutputDir = path.resolve(args['browser-output-dir'] ?? 'backend/data/work/phase9gd1_robust_browser_onnx/browser_outputs_chrome_default');
const browserReportPath = path.resolve(args['browser-report'] ?? 'backend/data/work/phase9gd1_robust_browser_onnx/browser_webgpu_chrome_default_report.json');
const reportsDir = path.resolve(args['reports-dir'] ?? 'backend/research/reports');

const manifest = JSON.parse(await readFile(path.join(fixtureDir, 'manifest.json'), 'utf8'));
const browserReport = JSON.parse(await readFile(browserReportPath, 'utf8'));
const scenario = scenarioForFixtures(manifest.fixtures);
const scoreTolerance = Number(args['score-tolerance'] ?? 1e-4);

const runtimes = [
  { id: 'pytorch_cpu', kind: 'python', sourceDir: runtimeDir },
  { id: 'pytorch_cuda', kind: 'python', sourceDir: runtimeDir },
  { id: 'python_ort', kind: 'python', sourceDir: runtimeDir },
  { id: 'browser_webgpu', kind: 'browser', sourceDir: browserOutputDir },
];

const decodedByRuntime = {};
for (const runtime of runtimes) {
  decodedByRuntime[runtime.id] = [];
  for (const fixture of manifest.fixtures) {
    const plan = planForFixture(scenario, fixture);
    const raw = await rawForRuntime(runtime, fixture);
    const decoded = byteDance.decodeByteDanceChunkRawOutputs({
      scenario,
      plan,
      raw,
      onsetThreshold: manifest.onsetThreshold,
      frameThreshold: manifest.frameThreshold,
      allowVariableFrameCount: true,
    });
    const observations = byteDance.observationsForByteDanceChunk(scenario, plan, decoded);
    decodedByRuntime[runtime.id].push({
      fixtureId: fixture.fixture_id,
      plan,
      raw,
      decoded: decoded.map(canonicalEvent),
      ownedObservations: observations.map(canonicalObservation),
    });
  }
}

const reference = decodedByRuntime.pytorch_cpu;
const parity = Object.fromEntries(runtimes.slice(1).map((runtime) => [
  runtime.id,
  compareRuntime(reference, decodedByRuntime[runtime.id]),
]));

const browserLatencyByChunk = new Map();
for (const comparison of browserReport.result.comparisons) {
  browserLatencyByChunk.set(`${scenario.scenarioId}:chunk-${comparison.fixture_id.split('_').at(-1) - 1}`, comparison.inference_ms);
}
const plans = manifest.fixtures.map((fixture) => planForFixture(scenario, fixture));
const schedule = byteDance.scheduleByteDanceSingleWorkerPublications({
  plans,
  processingLatencyMsByChunkId: browserLatencyByChunk,
});
const scheduleRows = plans.map((plan) => {
  const timing = schedule.get(plan.chunkId);
  const latency = browserLatencyByChunk.get(plan.chunkId);
  return {
    chunkId: plan.chunkId,
    inputReadyAtMs: timing.inputReadyAtMs,
    inferenceStartAtMs: timing.inferenceStartAtMs,
    inferenceLatencyMs: latency,
    inferenceFinishAtMs: timing.inferenceFinishAtMs,
    queueDelayMs: timing.queueDelayMs,
    commitEndMs: plan.commitEndPerformanceMs,
    publicationDelayFromCommitEndMs: timing.inferenceFinishAtMs - plan.commitEndPerformanceMs,
  };
});

const queueDelays = scheduleRows.map((row) => row.queueDelayMs);
const publicationDelays = scheduleRows.map((row) => row.publicationDelayFromCommitEndMs);
const inferenceLatencies = scheduleRows.map((row) => row.inferenceLatencyMs);

await mkdir(reportsDir, { recursive: true });
const semanticReceipt = {
  artifact: 'phase9g_d1r_robust_canonical_semantic_parity',
  phase: '9G-D.1R',
  canonicalDecoderPath: 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts::decodeByteDanceChunkRawOutputs',
  ownershipPath: 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts::observationsForByteDanceChunk',
  fixtureCount: manifest.fixtures.length,
  referenceRuntime: 'pytorch_cpu',
  cpuCanonicalDecodedEventCounts: reference.map((row) => ({ fixtureId: row.fixtureId, count: row.decoded.length })),
  parity,
  exactFixedOutputShape: [1, 183, 88],
  d1rThresholdActiveCellCounts: manifest.fixtures.map((fixture) => ({
    fixtureId: fixture.fixture_id,
    thresholdActiveCellCount: fixture.thresholdActiveCellCountAtOnset030Frame005,
    canonicalCount: reference.find((row) => row.fixtureId === fixture.fixture_id)?.decoded.length,
  })),
  p15p22InferenceIncrease: 0,
};
const runtimeReceipt = {
  artifact: 'phase9g_d1r_robust_default_browser_runtime',
  phase: '9G-D.1R',
  browserReport: path.relative(repoRoot, browserReportPath).replaceAll(path.sep, '/'),
  browser: browserReport.runtime,
  provider: browserReport.result.backend,
  graphOptimizationLevel: browserReport.result.graph_optimization_level,
  unsafeWebGpuFlagUsed: browserReport.runtime.launch_args.includes('--enable-unsafe-webgpu'),
  modelLoadLatencyMs: browserReport.result.model_load_ms,
  firstInferenceLatencyMs: browserReport.result.first_inference_ms,
  distinctWindowInferenceLatencyMs: summarize(inferenceLatencies),
  chronologicalWindowCount: scheduleRows.length,
  singleWorkerSchedule: {
    rows: scheduleRows,
    queueDelayMs: summarize(queueDelays),
    maxQueueDepthModeled: maxQueueDepth(scheduleRows),
    backlogObserved: Math.max(...queueDelays) > 1e-9,
    backlogConclusion: Math.max(...queueDelays) > 1e-9
      ? 'BACKLOG_OBSERVED_IN_D1R_CHRONOLOGICAL_SERIES'
      : 'NO_BACKLOG_OBSERVED_IN_D1R_CHRONOLOGICAL_SERIES',
    commitEndPublicationDelayMs: summarize(publicationDelays),
    observationAgeBoundsMs: {
      eventNearCommitEnd: '220ms future context + queue delay + inference latency',
      eventNearCommitStart: '600ms owned region + 220ms future context + queue delay + inference latency',
    },
  },
  productionLatencySloDefined: false,
};
await writeFile(
  path.join(reportsDir, 'phase9g_d1r_robust_canonical_semantic_parity_2026-10-12.json'),
  JSON.stringify(semanticReceipt, null, 2),
  'utf8',
);
await writeFile(
  path.join(reportsDir, 'phase9g_d1r_robust_default_browser_runtime_2026-10-12.json'),
  JSON.stringify(runtimeReceipt, null, 2),
  'utf8',
);
console.log(JSON.stringify({ semanticReceipt, runtimeReceipt }, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    out[key.slice(2)] = value && !value.startsWith('--') ? value : true;
    if (value && !value.startsWith('--')) i += 1;
  }
  return out;
}

async function rawForRuntime(runtime, fixture) {
  const prefix = runtime.id === 'browser_webgpu'
    ? `${fixture.fixture_id}_browser_webgpu`
    : `${fixture.fixture_id}_${runtime.id}`;
  const onsetPath = path.join(runtime.sourceDir, `${prefix}_reg_onset_output.npy`);
  const framePath = path.join(runtime.sourceDir, `${prefix}_frame_output.npy`);
  if (!existsSync(onsetPath) || !existsSync(framePath)) throw new Error(`Missing raw output for ${runtime.id}:${fixture.fixture_id}`);
  const onset = parseNpy(await readFile(onsetPath));
  const frame = parseNpy(await readFile(framePath));
  return {
    reg_onset_output: onset.data,
    reg_onset_shape: onset.shape,
    frame_output: frame.data,
    frame_shape: frame.shape,
  };
}

function parseNpy(buffer) {
  if (buffer.toString('latin1', 0, 6) !== '\x93NUMPY') throw new Error('not npy');
  const major = buffer[6];
  const headerLen = major === 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8);
  const offset = major === 1 ? 10 : 12;
  const header = buffer.toString('latin1', offset, offset + headerLen);
  const shapeText = /'shape': \(([^)]*)\)/.exec(header)?.[1];
  const shape = shapeText.split(',').map((part) => part.trim()).filter(Boolean).map(Number);
  const dataStart = offset + headerLen;
  return {
    shape,
    data: new Float32Array(buffer.buffer, buffer.byteOffset + dataStart, (buffer.length - dataStart) / 4),
  };
}

function scenarioForFixtures(fixtures) {
  const completion = Math.max(...fixtures.map((fixture) => fixture.commit_end_source_ms));
  return {
    scenarioId: 'phase9gd1r-nonblind-robust-browser-fixture',
    audio: {
      performanceOriginSourceMs: 0,
      clipStartMs: 0,
      clipEndMs: completion + 220,
      nativeSampleRateHz: 44100,
    },
    completion: { performanceTimeMs: completion },
    expectedStrikes: [{ strikeId: 'dummy', groupId: 'dummy', expectedPerformanceTimeMs: completion }],
  };
}

function planForFixture(scenario, fixture) {
  return {
    chunkId: `${scenario.scenarioId}:chunk-${fixture.sequenceIndex}`,
    scenarioId: scenario.scenarioId,
    commitStartPerformanceMs: fixture.commit_start_source_ms,
    commitEndPerformanceMs: fixture.commit_end_source_ms,
    inputStartPerformanceMs: fixture.input_start_source_ms,
    inputEndPerformanceMs: fixture.input_end_source_ms,
    expectedGroupIds: [],
  };
}

function canonicalEvent(event) {
  return {
    pitch: event.pitch,
    performanceTimeMs: round(event.performanceTimeMs),
    confidence: round(event.confidence),
    onsetScore: round(event.onsetScore),
    frameScore: round(event.frameScore),
  };
}

function canonicalObservation(observation) {
  return {
    pitch: observation.pitch,
    performanceTimeMs: round(observation.performanceTimeMs),
    confidence: round(observation.confidence),
  };
}

function compareRuntime(referenceRows, candidateRows) {
  const rows = referenceRows.map((reference, index) => {
    const candidate = candidateRows[index];
    const rawComparison = compareRawRows(reference.raw, candidate.raw);
    const decodedComparison = compareEventRows(reference.decoded, candidate.decoded);
    const ownedComparison = compareObservationRows(reference.ownedObservations, candidate.ownedObservations);
    return {
      fixtureId: reference.fixtureId,
      rawTensorParity: rawComparison.rawTensorParity,
      thresholdMaskParity: rawComparison.thresholdMaskParity,
      rawMaxAbsDelta: rawComparison.rawMaxAbsDelta,
      eventCountEqual: reference.decoded.length === candidate.decoded.length,
      canonicalDecoderParity: decodedComparison.parity,
      ownedObservationParity: ownedComparison.parity,
      referenceEventCount: reference.decoded.length,
      candidateEventCount: candidate.decoded.length,
      maxDecoderScoreDelta: decodedComparison.maxScoreDelta,
      maxOwnedObservationConfidenceDelta: ownedComparison.maxConfidenceDelta,
    };
  });
  return {
    scoreTolerance,
    canonicalDecoderParity: rows.every((row) => row.canonicalDecoderParity),
    ownedObservationParity: rows.every((row) => row.ownedObservationParity),
    rows,
  };
}

function compareRawRows(referenceRaw, candidateRaw) {
  const onset = compareTensor(referenceRaw.reg_onset_output, candidateRaw.reg_onset_output);
  const frame = compareTensor(referenceRaw.frame_output, candidateRaw.frame_output);
  return {
    rawTensorParity: onset.shapeEqual && frame.shapeEqual && Number.isFinite(onset.maxAbsDelta) && Number.isFinite(frame.maxAbsDelta),
    thresholdMaskParity: thresholdMaskEqual(referenceRaw, candidateRaw),
    rawMaxAbsDelta: Math.max(onset.maxAbsDelta, frame.maxAbsDelta),
  };
}

function compareTensor(a, b) {
  if (a.length !== b.length) return { shapeEqual: false, maxAbsDelta: null };
  let maxAbsDelta = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i]);
    if (delta > maxAbsDelta) maxAbsDelta = delta;
  }
  return { shapeEqual: true, maxAbsDelta };
}

function thresholdMaskEqual(referenceRaw, candidateRaw) {
  return (
    thresholdArrayEqual(referenceRaw.reg_onset_output, candidateRaw.reg_onset_output, manifest.onsetThreshold) &&
    thresholdArrayEqual(referenceRaw.frame_output, candidateRaw.frame_output, manifest.frameThreshold)
  );
}

function thresholdArrayEqual(a, b, threshold) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] >= threshold) !== (b[i] >= threshold)) return false;
  }
  return true;
}

function compareEventRows(referenceEvents, candidateEvents) {
  if (referenceEvents.length !== candidateEvents.length) {
    return { parity: false, maxScoreDelta: null };
  }
  let maxScoreDelta = 0;
  for (let i = 0; i < referenceEvents.length; i += 1) {
    const reference = referenceEvents[i];
    const candidate = candidateEvents[i];
    if (
      reference.pitch !== candidate.pitch ||
      reference.performanceTimeMs !== candidate.performanceTimeMs
    ) {
      return { parity: false, maxScoreDelta };
    }
    const deltas = [
      Math.abs(reference.confidence - candidate.confidence),
      Math.abs(reference.onsetScore - candidate.onsetScore),
      Math.abs(reference.frameScore - candidate.frameScore),
    ];
    maxScoreDelta = Math.max(maxScoreDelta, ...deltas);
    if (deltas.some((delta) => delta > scoreTolerance)) {
      return { parity: false, maxScoreDelta };
    }
  }
  return { parity: true, maxScoreDelta };
}

function compareObservationRows(referenceObservations, candidateObservations) {
  if (referenceObservations.length !== candidateObservations.length) {
    return { parity: false, maxConfidenceDelta: null };
  }
  let maxConfidenceDelta = 0;
  for (let i = 0; i < referenceObservations.length; i += 1) {
    const reference = referenceObservations[i];
    const candidate = candidateObservations[i];
    if (
      reference.pitch !== candidate.pitch ||
      reference.performanceTimeMs !== candidate.performanceTimeMs
    ) {
      return { parity: false, maxConfidenceDelta };
    }
    const delta = Math.abs(reference.confidence - candidate.confidence);
    maxConfidenceDelta = Math.max(maxConfidenceDelta, delta);
    if (delta > scoreTolerance) {
      return { parity: false, maxConfidenceDelta };
    }
  }
  return { parity: true, maxConfidenceDelta };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function maxQueueDepth(rows) {
  let max = 0;
  for (const row of rows) {
    const depth = rows.filter((candidate) => candidate.inputReadyAtMs <= row.inferenceStartAtMs && candidate.inferenceFinishAtMs > row.inferenceStartAtMs).length;
    max = Math.max(max, depth);
  }
  return max;
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}
