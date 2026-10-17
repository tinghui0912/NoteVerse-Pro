import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

// Evidence-only pre-implementation gate. Never imports an inference implementation.
const START = '527b3a87b29dd37a05f985ed1a5cb158284b8c5d';
const BRANCH = 'codex/customer-web-delivery-boundary';
const PHASE = 'PRACTICE_STEP_MICROPHONE_BOUNDED_ATTEMPT_PRODUCT_INTEGRATION_DISABLED';
const OUT = 'backend/research/reports/step_bounded_attempt_promotion_blocked_2026-10-17.json';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function receipt(path) {
  const bytes = await readFile(path);
  const tracked = git('ls-files', '--', path) !== '';
  return { path, bytes: bytes.length, sha256: sha(bytes), tracked,
    ...(tracked ? { gitBlob: git('rev-parse', `${START}:${path}`) } : {}) };
}
async function optionalReceipt(path) {
  try { return { available: true, ...await receipt(path) }; }
  catch (error) { if (error.code === 'ENOENT') return { path, available: false }; throw error; }
}
async function writeNew(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
function remoteHead() {
  return git('ls-remote', 'origin', `refs/heads/${BRANCH}`).split(/\s+/)[0];
}

async function audit() {
  assert.equal(git('rev-parse', 'HEAD'), START);
  assert.equal(remoteHead(), START);
  const policyPath = 'backend/research/policies/step_microphone_bytedance_v1.json';
  const corePath = 'apps/customer-web/src/lib/practice/acoustic-inference/continuous/acoustic-core-identity.json';
  const originalPath = 'backend/research/reports/phase9g_a22_bytedance_same_weight_provenance_2026-10-09.json';
  const robustPath = 'backend/research/reports/phase9g_d1_robust_browser_candidate_identity_export_2026-10-12.json';
  const policy = await json(policyPath), core = await json(corePath);
  const original = await json(originalPath), robust = await json(robustPath);
  assert.equal(policy.policy_identity.checkpoint_sha256, original.originalPyTorchCheckpoint.actualSha256);
  assert.equal(core.model.checkpointSha256, robust.checkpointIdentity.sha256);
  assert.equal(core.model.onnxSha256, robust.onnxExport.sha256);
  assert.notEqual(policy.policy_identity.checkpoint_sha256, core.model.checkpointSha256);

  const artifacts = [];
  for (const [path, expectedBytes, expectedSha256] of [
    [original.originalPyTorchCheckpoint.path, original.originalPyTorchCheckpoint.actualBytes, original.originalPyTorchCheckpoint.actualSha256],
    [original.currentFixedOnnxAsset.path, original.currentFixedOnnxAsset.actualBytes, original.currentFixedOnnxAsset.actualSha256],
    [robust.checkpointIdentity.path, robust.checkpointIdentity.byteSize, robust.checkpointIdentity.sha256],
    [robust.onnxExport.path, robust.onnxExport.byteSize, robust.onnxExport.sha256],
  ]) {
    const actual = await receipt(path);
    assert.equal(actual.bytes, expectedBytes);
    assert.equal(actual.sha256, expectedSha256);
    artifacts.push({ ...actual, identityVerifiedNowWithoutInference: true });
  }
  const evidencePaths = [policyPath, corePath, originalPath, robustPath,
    original.parityReceiptPath,
    'backend/research/reports/phase9g_d1r_robust_parity_chain_2026-10-12.json',
    'backend/research/reports/bytedance_browser_runtime_feasibility.md',
    'backend/research/reports/rtt_bytedance_candidate_handoff.md',
    'backend/research/reports/bytedance_score_aware_rolling_step.md',
    'backend/scripts/evaluate_causal_physical_strike_trigger.py',
    'apps/customer-web/src/lib/api/model-assets.ts',
    'apps/customer-web/src/lib/api/continuous-model-asset.ts',
    'backend/app/modules/model_assets/service.py',
    'backend/app/modules/model_assets/schemas.py',
    'apps/customer-web/src/lib/practice/acoustic-inference/continuous/acoustic-model-manifest.ts',
    'apps/customer-web/src/lib/practice/acoustic-inference/continuous/model-inference.ts',
    'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-contract.ts',
    'apps/customer-web/src/lib/practice/local-core/step-evidence-session.ts',
    'apps/customer-web/src/lib/practice/local-core/step-runtime.ts',
    'apps/customer-web/src/lib/practice/input-capability.ts'];
  const evidence = [];
  for (const path of evidencePaths) evidence.push(await receipt(path));
  const historicalInputs = [];
  for (const entry of Object.values(policy.input_manifests)) {
    const actual = await optionalReceipt(entry.path);
    historicalInputs.push({ ...actual, expectedSha256: entry.sha256,
      hashMatches: actual.available ? actual.sha256 === entry.sha256 : null,
      use: 'FILE_IDENTITY_ONLY_NO_CASE_REPLAY_OR_MEDIA_READ' });
  }
  const capability = await readFile('apps/customer-web/src/lib/practice/input-capability.ts', 'utf8');
  assert.match(capability, /const CONTINUOUS_ACOUSTIC_ANALYSIS_CAPABILITY[^=]*=\s*\{\s*status: 'MODEL_NOT_VALIDATED'/);
  assert.match(capability, /const STEP_ACOUSTIC_ANALYSIS_CAPABILITY[^=]*=\s*\{\s*status: 'ATTEMPT_ANALYZER_NOT_VALIDATED'/);
  assert.equal(git('diff', START, '--', 'apps/customer-web', 'backend/app'), '');
  await writeNew(OUT, {
    schemaVersion: 1, phase: PHASE, recordedAt: new Date().toISOString(),
    startingHead: START, observedRemoteHead: remoteHead(),
    disposition: 'STEP_MICROPHONE_BOUNDED_ATTEMPT_INTEGRATION_BLOCKED',
    stoppedAt: 'PRE_IMPLEMENTATION_BROWSER_MODEL_EQUIVALENCE_GATE',
    reasons: ['FROZEN_STEP_CHECKPOINT_DIFFERS_FROM_CURRENT_CONTINUOUS_DELIVERY',
      'CROSS_CHECKPOINT_FROZEN_STEP_POLICY_EQUIVALENCE_NOT_ESTABLISHED'],
    interpretation: 'This is an identity/evidence blocker, not a measured failure of Robust on STEP. Shared tensor conventions do not establish interchangeable neural values or frozen-policy fidelity.',
    frozenPolicy: { ...policy.policy_identity, policy: policy.policy, window: policy.benchmark_window,
      trackedCopyRevision: git('log', '-1', '--format=%H', '--', policyPath),
      copiedAfterFrozenEvaluation: policy.copied_after_frozen_evaluation_for_reproducibility,
      notPreEvaluationGitRegistration: policy.not_pre_evaluation_git_registration,
      historicalCalibrationScoresAreNotCurrentProductQualification: true },
    modelEquivalence: {
      originalCheckpointSha256: policy.policy_identity.checkpoint_sha256,
      originalOnnxSha256: original.currentFixedOnnxAsset.actualSha256,
      currentCheckpointSha256: core.model.checkpointSha256,
      currentOnnxSha256: core.model.onnxSha256,
      directlyVerifiedLocalArtifacts: artifacts,
      waveform: 'Both historical exports document mono float32 16kHz, [1,29120]. No new waveform transformation or inference was performed.',
      heads: 'Both expose reg_onset_output and frame_output [1,183,88].',
      frameAndPitchConvention: '100Hz output frames; 88 piano keys MIDI21..108. Convention agreement is not raw-value equivalence.',
      temporalConvention: 'Original fixed-anchor export uses anchor1600ms/future220ms. Current Continuous uses real-context owned600/past1050/future170; these are not interchangeable attempt lifecycles.',
      rawParityScope: 'Original checkpoint-to-original ONNX and Robust checkpoint-to-Robust ONNX parity are separate same-weight evidence chains. Neither establishes cross-checkpoint STEP equivalence.',
      rawCrossCheckpointComparison: 'NOT_ESTABLISHED_NO_NEW_INFERENCE_PERFORMED',
      decoderBoundary: 'Current ContinuousModelInference explicitly decodes .30/.05 and returns Continuous-owned events; it is not a frozen .20/.20 STEP raw-policy implementation.',
      deliveryCaveat: 'The repository still declares a historical bytedance-note/access identity for the original ONNX as well as the promoted continuous-robust-browser-v1 identity. The former is not the same immutable bytes/cache identity and is not a permitted second-model workaround. No endpoint was downloaded or modified.'
    },
    triggerInventory: {
      policyDefinesTrigger: false,
      handcraftedRmsFlux: 'Historical feasibility report: stopped, no robust candidate selected; trigger unresolved.',
      rttCandidateHandoff: 'Research-only candidate exists. Handoff is not complete STEP progression; first advance uses oracle-initialized state establishment; not current product trigger qualification.',
      scoreAwareRolling: 'Historical periodic neural rolling study exists; explicitly not an allowed bounded-attempt fallback.',
      newTrigger: 'NOT_IMPLEMENTED_FIRST_IDENTITY_GATE_BLOCKED',
      missingProductContract: 'No established promoted score-free bounded-attempt trigger identity/evidence was found in the audited sources. No thresholds were proposed or tuned.'
    },
    stepEvidenceBoundaryAudit: {
      existingProperties: ['Session domain check', 'stepId/activationGeneration-bound observation',
        'strict onset after activation boundary', 'exact expected attack pitch-set equality'],
      remainingIfFutureGateAuthorized: 'Existing pending-event publication is not an attempt-ID/generation-isolated capture/analyze/reset owner. It was not modified or claimed complete.'
    },
    historicalInputs, authoritativeFrozenEvaluationForCurrentRobustStepPolicy: 'NOT_ESTABLISHED',
    historicalEvidenceLimitation: 'The policy names prior frozen evaluation and late tracked reproducibility copying. That is not a tracked current-Robust STEP qualification receipt. Historical results remain unchanged; no frozen evaluation was replayed.',
    evidence,
    verification: {
      performed: ['Read-only source/provenance audit', 'SHA256 and size checks of two local checkpoints and two local ONNX exports', 'Capability source and zero product diff assertions'],
      vitest: 'NOT_RUN_PRE_IMPLEMENTATION_STOP', typecheck: 'NOT_RUN_PRE_IMPLEMENTATION_STOP',
      eslint: 'NOT_RUN_PRE_IMPLEMENTATION_STOP', nextBuild: 'NOT_RUN_PRE_IMPLEMENTATION_STOP',
      dockerModelAssetTests: 'NOT_RUN_PRE_IMPLEMENTATION_STOP',
      continuousBrowserRegression: 'NOT_RUN_PRE_IMPLEMENTATION_STOP',
      stepWorkerReplay: 'NOT_RUN_PRE_IMPLEMENTATION_STOP',
      freeze: 'NOT_CREATED_NO_PRODUCT_IMPLEMENTATION_OR_ACCEPTANCE_REPLAY'
    },
    counters: { newNeuralModelRuns: 0, newDatasetDownloads: 0, newModelExports: 0,
      newModelDeliveries: 0, thresholdSweeps: 0, realMicrophoneProbes: 0 },
    protections: { continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED',
      productionMicrophone: false, D4: false, continuousSourceChanged: false,
      midiStepChanged: false, archivedExecutablePipelineRestored: false,
      commercialQualification: 'NOT_PERFORMED', productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN' },
    nextAction: 'STOP for independent review. No model substitution, duplicate model, trigger research, Continuous fallback, or STEP product wiring was attempted.'
  });
  console.log(JSON.stringify({ path: OUT, sha256: sha(await readFile(OUT)) }));
}

async function githubReceipt() {
  const head = remoteHead();
  assert.equal(head, git('rev-parse', 'HEAD'));
  const credential = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8'
  });
  const token = credential.split('\n').find(line => line.startsWith('password='))?.slice(9).trim();
  if (!token) throw new Error('GITHUB_CREDENTIAL_UNAVAILABLE');
  const api = async endpoint => {
    const response = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'NoteVerse-STEP-identity-audit' }
    });
    if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
    return response.json();
  };
  const combined = await api(`commits/${head}/status`);
  const statuses = await api(`commits/${head}/statuses?per_page=100`);
  const runs = await api(`actions/runs?head_sha=${head}&per_page=100`);
  const report = { phase: PHASE, queriedAt: new Date().toISOString(), remoteHead: head,
    combinedState: combined.state, statuses, workflowRuns: runs.workflow_runs,
    interpretation: statuses.length === 0 && runs.workflow_runs.length === 0 ? 'NOT CI PASS' : 'ACTUAL_GITHUB_STATE_NOT_INFERRED_FROM_LOCAL_AUDIT' };
  const output = process.argv[3];
  assert.ok(output?.startsWith('backend/research/reports/step_bounded_attempt_'));
  await writeNew(output, report);
  console.log(JSON.stringify(report));
}

if (process.argv[2] === 'github') await githubReceipt();
else if (process.argv[2] === 'audit') await audit();
else throw new Error('Expected audit or github <new-receipt-path>');
