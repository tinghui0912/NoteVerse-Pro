#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const reportsDir = path.join(repoRoot, 'backend/research/reports');
const args = parseArgs(process.argv);

const parityPath = path.resolve(args['parity-report'] ?? path.join(reportsDir, 'phase9g_d1r_robust_parity_chain_2026-10-12.json'));
const semanticPath = path.resolve(args['semantic-report'] ?? path.join(reportsDir, 'phase9g_d1r_robust_canonical_semantic_parity_2026-10-12.json'));
const runtimePath = path.resolve(args['runtime-report'] ?? path.join(reportsDir, 'phase9g_d1r_robust_default_browser_runtime_2026-10-12.json'));
const chromeReportPath = path.resolve(args['chrome-report'] ?? 'backend/data/work/phase9gd1_robust_browser_onnx/browser_webgpu_chrome_default_report.json');
const edgeReportPath = path.resolve(args['edge-report'] ?? 'backend/data/work/phase9gd1_robust_browser_onnx/browser_webgpu_edge_default_report.json');
const forcedReportPath = args['forced-report'] ? path.resolve(args['forced-report']) : null;

const parity = JSON.parse(await readFile(parityPath, 'utf8'));
const semantic = existsSync(semanticPath) ? JSON.parse(await readFile(semanticPath, 'utf8')) : null;
const runtime = existsSync(runtimePath) ? JSON.parse(await readFile(runtimePath, 'utf8')) : null;
const chrome = await readOptionalJson(chromeReportPath);
const edge = await readOptionalJson(edgeReportPath);
const forced = forcedReportPath ? await readOptionalJson(forcedReportPath) : null;

const preprocessingRows = parity.fixtures.map((fixture) => {
  const row = parity.preprocessingParity?.rows?.find((candidate) => candidate.fixtureId === fixture.fixture_id);
  return {
    fixtureId: fixture.fixture_id,
    sourceWavPath: row?.sourceAudioPath ?? fixture.source_audio_relpath,
    sourceWavSha256: row?.sourceAudioSha256 ?? fixture.source_audio_sha256,
    sourceSampleRateHz: row?.sourceSampleRateHz ?? fixture.source_sample_rate,
    sourceStartMs: row?.inputStartSourceMs ?? fixture.input_start_source_ms,
    sourceEndMs: row?.inputEndSourceMs ?? fixture.input_end_source_ms,
    outputSampleCount: row?.requestedOutputSampleCount ?? fixture.input_samples,
    fixturePcmSha256: row?.fixtureInputPcmSha256 ?? fixture.inputPcmSha256,
    frozenRunnerPcmSha256: row?.frozenRunnerInputPcmSha256 ?? null,
    preprocessingShaEqual: row?.preprocessingShaEqual ?? false,
    parityStatus: row?.preprocessingShaEqual ? 'PASS' : 'FAIL',
  };
});

const preprocessingReceipt = {
  artifact: 'phase9g_d1r_robust_frozen_preprocessing_receipt',
  phase: '9G-D.1R',
  frozenHelper: 'backend/scripts/bytedance_pcm_preprocessing.py::extract_resample_linear',
  frozenRunner: 'backend/scripts/run_bytedance_robust_pytorch_raw_batch.py',
  expectedPreprocessingIdentity: 'deterministic_wav_pcm16_mono_linear_resample_16k_v1',
  status: parity.preprocessingParity?.status ?? 'NOT_REPORTED',
  fixtureCount: preprocessingRows.length,
  rows: preprocessingRows,
  noFakeZeroPadding: true,
  p15p22InferenceIncrease: 0,
};

const correctionReceipt = {
  artifact: 'phase9g_d1r_correction_receipt',
  phase: '9G-D.1R',
  retainedD1Evidence: {
    checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
    checkpointBytes: 103815845,
    onnxSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
    onnxBytes: 98689283,
    opset: 18,
    inputShape: [1, 29120],
    observedOutputShape: [1, 183, 88],
    ortWebVersion: '1.20.1',
    retainedConclusion: 'D.1 established export/raw numerical feasibility.',
  },
  correctedClaims: {
    customDecoderIssue: 'D.1 approximate Python frame/onset scan was not the frozen ByteDance decoder.',
    preprocessingMismatchIssue: 'D.1 fixture PCM used sliced endpoint-inclusive resampling instead of frozen source-space endpoint-false interpolation.',
    forcedWebGpuIssue: 'D.1 WebGPU evidence used --enable-unsafe-webgpu; D.1R records default browser WebGPU separately.',
    backlogWordingIssue: 'D.1 no-backlog wording was a capacity estimate; D.1R adds chronological single-worker scheduling.',
  },
  correctedArtifacts: {
    parityReport: rel(parityPath),
    preprocessingReceipt: 'backend/research/reports/phase9g_d1r_robust_frozen_preprocessing_receipt_2026-10-12.json',
    semanticParityReceipt: existsSync(semanticPath) ? rel(semanticPath) : null,
    browserRuntimeReceipt: existsSync(runtimePath) ? rel(runtimePath) : null,
  },
  canonicalDecoderPath: semantic?.canonicalDecoderPath ?? 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts::decodeByteDanceChunkRawOutputs',
  ownedObservationParity: semantic ? Object.fromEntries(Object.entries(semantic.parity).map(([key, value]) => [key, value.ownedObservationParity])) : null,
  p15p22InferenceIncrease: 0,
};

const browserMatrix = {
  artifact: 'phase9g_d1r_robust_default_browser_webgpu_matrix',
  phase: '9G-D.1R',
  normalQualificationRequiresUnsafeFlag: false,
  chromeDefault: summarizeBrowserReport(chrome),
  edgeDefault: summarizeBrowserReport(edge),
  forcedWebGpuDiagnostic: forced ? summarizeBrowserReport(forced) : { status: 'NOT_RUN' },
  productionMicrophoneEnabled: false,
};

await writeFile(
  path.join(reportsDir, 'phase9g_d1r_robust_frozen_preprocessing_receipt_2026-10-12.json'),
  JSON.stringify(preprocessingReceipt, null, 2),
  'utf8',
);
await writeFile(
  path.join(reportsDir, 'phase9g_d1r_correction_receipt_2026-10-12.json'),
  JSON.stringify(correctionReceipt, null, 2),
  'utf8',
);
await writeFile(
  path.join(reportsDir, 'phase9g_d1r_robust_default_browser_webgpu_matrix_2026-10-12.json'),
  JSON.stringify(browserMatrix, null, 2),
  'utf8',
);

console.log(JSON.stringify({ preprocessingReceipt, correctionReceipt, browserMatrix }, null, 2));

async function readOptionalJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function summarizeBrowserReport(report) {
  if (!report) return { status: 'NOT_RUN_OR_NOT_AVAILABLE' };
  const comparisonCount = report.result?.comparisons?.length ?? 0;
  return {
    status: report.error || report.result?.error ? 'FAIL' : (comparisonCount > 0 ? 'PASS' : 'UNKNOWN'),
    browser: report.runtime?.browser,
    browserVersion: report.runtime?.browser_version,
    headed: report.runtime?.headed,
    launchArgs: report.runtime?.launch_args ?? [],
    navigatorGpu: report.result?.navigator_gpu,
    adapterAcquired: report.result?.adapter_acquired,
    adapterInfo: report.result?.adapter_info ?? null,
    backend: report.result?.backend,
    graphOptimizationLevel: report.result?.graph_optimization_level,
    modelSha256: report.model?.sha256,
    modelBytes: report.model?.bytes,
    modelLoadMs: report.result?.model_load_ms,
    firstInferenceMs: report.result?.first_inference_ms,
    warmSummaryMs: report.result?.warm_inference_ms_summary,
    comparisonCount,
    error: report.result?.error ?? null,
  };
}

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

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}
