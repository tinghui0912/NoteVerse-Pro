#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { REPO_ROOT } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, digest, fileSha, PHASE, DEPLOYMENTS } from './xc1_artifacts.mjs';
import { EDGE_PARITY_POLICY } from './xc1_edge_lane.mjs';

const json = async file => JSON.parse(await readFile(path.join(REPO_ROOT, file), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const dryRoot = process.argv[2] ?? 'backend/data/work/xc1_r3d_validation/dry_run_final';
const reports = path.join(REPO_ROOT, 'backend/research/reports');
const implementationCommit = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain'), '', 'clean implementation checkout required');
assert.equal(git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0], implementationCommit);
const dry = await json(`${dryRoot}/complete_dry_run_report.json`);
assert.equal(dry.status, 'R3D_PRODUCTION_PATH_COMPLETE_DRY_RUN_PASS');
const pcm = await json('backend/data/work/xc1_r3d_validation/canonical_pcm_verified.json');
assert.equal(pcm.passedTakeCount, 50);
const parity = await json('backend/data/work/xc1_r3d_validation/online_semantic_parity_stream.json');
assert.equal(parity.status, 'PASS');
const boundary = await json('backend/data/work/xc1_r3d_validation/browser_boundary/receipt.json');
assert.equal(boundary.decoderParity.equal, true);
assert.ok(Object.values(boundary.routes).every(status => status >= 400));
const f3Path = 'backend/research/reports/phase9g_xc1_r2_smd_take_manifest_f3_2026-10-14.json';
const f3 = await json(f3Path);
const candidates = {}, candidateReceipts = {};
for (const deployment of DEPLOYMENTS) {
  const artifact = await json(`${dryRoot}/matrix/predictions/${deployment}/non-smd-partial.json`);
  assert.equal(artifact.status, 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE');
  assert.ok(artifact.actualInferenceSessionRunCount > 0);
  for (const identity of [artifact.implementationIdentity.officialRegistry, artifact.implementationIdentity.realExecutor,
    artifact.implementationIdentity.sharedBrowserRuntime]) assert.equal(await fileSha(path.join(REPO_ROOT, identity.file)), identity.sha256);
  candidates[deployment] = artifact.xc1DeploymentIdentitySha256;
  candidateReceipts[deployment] = { deploymentIdentityContent: artifact.deploymentIdentityContent,
    xc1DeploymentIdentitySha256: artifact.xc1DeploymentIdentitySha256, implementationIdentity: artifact.implementationIdentity,
    sessionLoadCount: artifact.sessionLoadCount, actualInferenceSessionRunCount: artifact.actualInferenceSessionRunCount };
}
const sourceFiles = git('ls-files', 'backend/research/browser_runtime/*.mjs', 'backend/research/browser_runtime/xc1_ort120_runtime/*',
  'backend/scripts/*xc1*r3d*.py', 'backend/research/*xc1*.py', 'backend/scripts/bytedance_pcm_preprocessing.py',
  'apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts',
  'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts',
  'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts', 'docker/research/Dockerfile.xc1-r3d-science')
  .split('\n').filter(file => !file.includes('node_modules') && /\.(mjs|py|ts|json)$|Dockerfile/.test(file));
const sourceHashBoundary = {};
for (const file of sourceFiles) sourceHashBoundary[file] = await fileSha(path.join(REPO_ROOT, file));
const assetHashBoundary = {};
for (const directory of ['backend/research/browser_runtime/dr3r_browser_runtime/node_modules/onnxruntime-web/dist',
  'backend/research/browser_runtime/xc1_ort120_runtime/node_modules/onnxruntime-web/dist',
  'backend/data/work/phase9g_dr3r1h/fixtures', 'backend/data/work/basic_pitch_browser_feasibility/node_modules/@spotify/basic-pitch/esm']) {
  for (const entry of await readdir(path.join(REPO_ROOT, directory), { withFileTypes: true })) {
    if (entry.isFile() && /\.(js|mjs|wasm|npy)$/.test(entry.name) && (directory.includes('onnxruntime-web') || entry.name.startsWith('initial_') || entry.name === 'toMidi.js' || entry.name === 'inference.js')) {
      const file = `${directory}/${entry.name}`; assetHashBoundary[file] = await fileSha(path.join(REPO_ROOT, file));
    }
  }
}
for (const file of ['backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx',
  'backend/data/work/phase9g_dr3r1h/graphs/online_amt_grouped_k1_opset18.onnx',
  'backend/data/work/phase9g_dr3r1h/graphs/online_amt_grouped_k8_opset18.onnx',
  'backend/data/work/online_amt/model-180000.pt', 'backend/data/work/basic_pitch_browser_feasibility/package-lock.json',
  'backend/data/work/basic_pitch_browser_feasibility/node_modules/@spotify/basic-pitch/model/model.json',
  'backend/data/work/basic_pitch_browser_feasibility/node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin']) {
  assetHashBoundary[file] = await fileSha(path.join(REPO_ROOT, file));
}
const runRoot = 'backend/data/work/xc1_r3d_f5_stream';
async function predictionScan(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await predictionScan(file));
    else if (entry.name.endsWith('.json')) {
      const content = JSON.parse(await readFile(file, 'utf8'));
      if (content.stage?.includes('PREDICTION')) found.push(file);
    }
  }
  return found;
}
const existing = await predictionScan(path.join(REPO_ROOT, runRoot));
assert.equal(existing.length, 0, 'zero F5 predictions required');
const ordered = [...f3.takes].sort((a, b) => a.audioDurationSeconds - b.audioDurationSeconds || a.takeId.localeCompare(b.takeId));
function compactRuntime(report) {
  return { ...report, candidates: Object.fromEntries(Object.entries(report.candidates).map(([key, value]) => {
    const { steadyRows: _steady, terminalResidualRows: _terminal, ...summary } = value;
    return [key, summary];
  })) };
}
const runtimeSubsetTakeIds = [ordered[0], ordered[Math.floor(ordered.length / 2)], ordered.at(-1)].map(take => take.takeId);
const scoreableInteriorFor = take => ({ ...take.scoreableInterior, endMs: take.canonicalPcm.sampleCount / 16 - 220 });
const fullTakeManifest = { ...f3, phase: PHASE, candidateInferenceStarted: false,
  scoreableInteriorCoordinatePolicy: 'CANONICAL_16K_PCM_SAMPLE_COUNT',
  takes: f3.takes.map(take => ({ ...take, originalF3ScoreableInterior: take.scoreableInterior,
    canonicalAudioDurationSeconds: take.canonicalPcm.sampleCount / 16000, scoreableInterior: scoreableInteriorFor(take) })) };
const truthManifestName = 'phase9g_xc1_r3d_full_take_manifest_f5_stream_2026-10-15.json';
await atomicJson(path.join(reports, truthManifestName), fullTakeManifest);
const manifest = { phase: PHASE, fixtureClass: 'SMD_V2_REAL_ACOUSTIC_ONLY', implementationCommit,
  truthFieldsExcluded: true, midiPathsExcluded: true, candidateInferenceStarted: false, candidateIdentities: candidates,
  takes: f3.takes.map(take => ({ takeId: take.takeId, durationSeconds: take.audioDurationSeconds,
    workId: take.workId, sourceAcousticWavSha256: take.acousticWavSha256, scoreableInterior: scoreableInteriorFor(take),
    canonicalPcm: { sha256: take.canonicalPcm.sha256, byteSize: take.canonicalPcm.byteSize,
      sampleCount: take.canonicalPcm.sampleCount, sampleRateHz: 16000, dtype: 'float32-le-raw',
      sourceRelativePath: take.canonicalPcm.relativeStageAPath } })) };
const manifestName = 'phase9g_xc1_r3d_sanitized_stage_a_manifest_f5_stream_2026-10-15.json';
await atomicJson(path.join(reports, manifestName), manifest);
const freeze = { phase: PHASE, artifact: 'XC1_TRUE_EXECUTABLE_PROSPECTIVE_FREEZE_F5',
  startingRemoteHead: '00ab97996fbc16c73014b011f4ff1f8b0d974cce', implementationCommitI5: implementationCommit,
  implementationWorkingTreeCleanBeforePreparation: true,
  historicalF4: { commit: 'bea9098b3467876a077ff6bf8251ca446c4426df', status: 'PERMANENTLY_INVALIDATED',
    classification: 'XC1_R3C_EVALUATION_INVALIDATED_IMPLEMENTATION_DEFECT_AFTER_SMD_INFERENCE_START' },
  historicalFirstF5: { commit: 'a9011c8bfc872d700c53a5d04619593a67ebd6d5', status: 'PERMANENTLY_INVALIDATED',
    reason: 'Online-AMT bridge originally ran at take end; raw hop availability was mislabeled as acoustic publication availability.',
    completedPrimaryCells: (await json('backend/data/work/xc1_r3d_f5/primary_chrome/summary/matrix.json')).cells.length,
    summarySha256: await fileSha(path.join(REPO_ROOT, 'backend/data/work/xc1_r3d_f5/primary_chrome/summary/matrix.json')),
    truthRevealed: false, predictionReuseAllowed: false },
  r3cReclassifications: {
    semanticAcceptance: 'FULL_TAKE_BROWSER_EXECUTION_ACCEPTANCE_WITH_PARTIAL_SEMANTIC_TESTING',
    truePipelineDryRun: 'REAL_SCIENTIFIC_CORE_SCORER_DRY_RUN_BUT_NOT_PRODUCTION_ORCHESTRATION_PARITY' },
  candidateIdentities: candidateReceipts, sourceHashBoundary, assetHashBoundary, candidateInferenceStarted: false,
  zeroPredictionScan: { runRoot, scannedRoots: ['primary_chrome', 'edge', 'runtime'], predictionCount: existing.length },
  runRoot, stageAManifestPath: `backend/research/reports/${manifestName}`,
  stageAManifestSha256: await fileSha(path.join(reports, manifestName)),
  truthManifestPath: `backend/research/reports/${truthManifestName}`, truthManifestSha256: await fileSha(path.join(reports, truthManifestName)),
  scoreableInteriorCoordinatePolicy: 'CANONICAL_16K_PCM_SAMPLE_COUNT',
  scoreableInteriorMetadataCorrections: fullTakeManifest.takes.filter(take => take.scoreableInterior.endMs !== take.originalF3ScoreableInterior.endMs)
    .map(take => ({ takeId: take.takeId, originalEndMs: take.originalF3ScoreableInterior.endMs, canonicalEndMs: take.scoreableInterior.endMs })),
  archivePath: 'backend/data/work/smd_v2/SMD-piano_v2.zip', archiveSha256: pcm.archiveIdentity.sha256,
  canonicalPcmVerification: { reportSha256: await fileSha(path.join(REPO_ROOT, 'backend/data/work/xc1_r3d_validation/canonical_pcm_verified.json')), passedTakeCount: 50 },
  semanticParity: parity, productionPathDryRun: { receiptSha256: await fileSha(path.join(REPO_ROOT, `${dryRoot}/complete_dry_run_report.json`)), status: dry.status },
  truthIsolation: { routes: boundary.routes, browserReceiptSha256: await fileSha(path.join(REPO_ROOT, 'backend/data/work/xc1_r3d_validation/browser_boundary/receipt.json')) },
  robustSelectedOrtWebVersion: '1.20.1', robustAb: { version130: compactRuntime(await json('backend/data/work/xc1_r3d_validation/runtime_130/runtime_report.json')),
    version130Repeat: compactRuntime(await json('backend/data/work/xc1_r3d_validation/runtime_130_repeat/runtime_report.json')),
    selected120PreFreeze: compactRuntime(await json(`${dryRoot}/runtime_bound.json`)) },
  runtimeSubsetSelection: 'duration ascending: first, median, last; metadata only', runtimeSubsetTakeIds,
  edgeSubsetTakeIds: f3.edgeParitySubsetTakeIds, edgePolicy: EDGE_PARITY_POLICY,
  scoringPolicy: { primaryToleranceMs: 50, sensitivityToleranceMs: [25, 100], matching: 'MAX_CARDINALITY_MIN_TOTAL_ABSOLUTE_ERROR_STABLE_SEQUENCE_TIE',
    bootstrapPrimaryUnit: 'performance_take', draws: 5000, seed: 13371, performerClustering: 'unavailable', repeatedPieceClustering: 'unavailable',
    duplicateDiagnosticMs: 50, chordCompleteness: 'NOT_AVAILABLE_IN_XC1_R3D', additionalMidiAlignmentMs: 0 },
  dockerScienceImageId: dry.dockerImageId, commercialQualificationStatus: 'NOT_PERFORMED' };
freeze.freezeSha256 = digest(freeze);
await atomicJson(path.join(reports, 'phase9g_xc1_r3d_true_prospective_freeze_f5_stream_2026-10-15.json'), freeze);
console.log(JSON.stringify({ implementationCommit, freezeSha256: freeze.freezeSha256, runtimeSubsetTakeIds, takeCount: manifest.takes.length }));
