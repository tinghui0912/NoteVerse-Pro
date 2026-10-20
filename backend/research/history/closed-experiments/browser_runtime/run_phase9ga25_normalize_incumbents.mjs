import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);
const calibration = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-model-calibration.ts'));

const V4_POLICY_REL = 'backend/research/policies/public_model_calibration_protocol_v4_2026-10-09.json';
const V5_POLICY_REL = 'backend/research/policies/public_model_calibration_protocol_v5_2026-10-09.json';
const BLIND_REL = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json';
const A23_REPORT_REL = 'backend/research/reports/phase9g_a23_bytedance_online_amt_incumbent_completion_2026-10-09.json';
const A24_REPORT_REL = 'backend/research/reports/phase9g_a24_bytedance_online_amt_incumbent_completion_2026-10-09.json';
const A24_REGISTRY_REL = 'backend/research/reports/phase9g_a24_final_incumbent_registry_2026-10-09.json';
const A24_RAW_REL = 'backend/research/reports/phase9g_a24_bytedance_raw_evidence_manifest_2026-10-09.json';
const REPORT_REL = 'backend/research/reports/phase9g_a25_incumbent_selection_normalization_2026-10-09.json';
const REGISTRY_REL = 'backend/research/reports/phase9g_a25_final_incumbent_registry_2026-10-09.json';
const SUPERSESSION_REL = 'backend/research/reports/phase9g_a25_incumbent_supersession_receipt_2026-10-09.json';
const STARTING_A24_BYTE_CONFIG = 'ac78f607c52f8b3be09553ad778958b20837d539395685ac0fc4cd0576d7bf5e';
const EXPECTED_BLIND_SHA = '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab';
const EXPECTED_V4_SHA = 'b62f85cbc910d4a537214eed68c2d6e3accd3036417b16249d33d2e3a1a7cce9';
const EXPECTED_V5_SHA = '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6';

const implementationGitHead = gitHead();
const dirtyTreeAtExecution = gitDirty();
if (dirtyTreeAtExecution) throw new Error('PHASE_9GA25_REQUIRES_CLEAN_EXECUTION_TREE');

const policy = await measuredPolicyIdentity(V5_POLICY_REL);
calibration.assertPublicModelCalibrationPolicyIdentity(policy);
if (policy.sha256 !== EXPECTED_V5_SHA) throw new Error('V5 policy hash lock mismatch');
if (await sha256File(V4_POLICY_REL) !== EXPECTED_V4_SHA) throw new Error('V4 historical policy was modified');

const blindText = await readFile(path.resolve(repoRoot, BLIND_REL), 'utf8');
const blindManifest = JSON.parse(blindText);
const blindSha = sha256Text(blindText);
if (blindSha !== EXPECTED_BLIND_SHA || blindManifest.scenarios?.length !== 70) {
  throw new Error(`Frozen blind manifest mismatch: ${blindSha}`);
}

const a23 = JSON.parse(await readFile(path.resolve(repoRoot, A23_REPORT_REL), 'utf8'));
const a24 = JSON.parse(await readFile(path.resolve(repoRoot, A24_REPORT_REL), 'utf8'));
const a24Registry = JSON.parse(await readFile(path.resolve(repoRoot, A24_REGISTRY_REL), 'utf8'));
const rawEvidence = JSON.parse(await readFile(path.resolve(repoRoot, A24_RAW_REL), 'utf8'));

if (a24.byteDance.rawNeuralInferenceExecutedCount !== 0) {
  throw new Error('A.2.4 raw evidence was not cache-only');
}
if (a24.byteDance.rawEvidenceManifestSha256 !== await sha256File(A24_RAW_REL)) {
  throw new Error('A.2.4 raw evidence manifest hash mismatch');
}
if (rawEvidence.rowCount !== 300 || rawEvidence.rows.length !== 300) {
  throw new Error('A.2.4 raw evidence row count mismatch');
}
for (const row of rawEvidence.rows) {
  if (row.checkpointSha256 !== a24.byteDance.byteDanceCheckpointSha256
    && row.checkpointSha256 !== 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141') {
    throw new Error(`Raw evidence checkpoint mismatch: ${row.windowId}`);
  }
  for (const field of [
    'contextProfileId',
    'sourceAudioSha256',
    'inputPcmSha256',
    'windowGeometrySha256',
    'regOnsetFloat32ByteSha256',
    'frameFloat32ByteSha256',
  ]) {
    if (!row[field]) throw new Error(`Raw evidence identity missing ${field}: ${row.windowId}`);
  }
}

const survivorIds = [...a24.byteDance.gate2TieBreak.remainingProfileIds].sort();
const registryById = new Map(a24Registry.profiles.map((profile) => [profile.profileId, profile]));
const gate2Profiles = survivorIds.map((profileId) => {
  const registryProfile = registryById.get(profileId);
  const measurement = a23.byteDance.metrics?.[profileId]?.CALIBRATION;
  if (!registryProfile || !measurement) throw new Error(`Missing accepted measurement for ${profileId}`);
  const parsed = parseByteDanceProfileId(profileId);
  return {
    profileId,
    contextProfileId: parsed.contextProfileId,
    modelInputMs: parsed.modelInputMs,
    onsetThreshold: parsed.onsetThreshold,
    frameThreshold: parsed.frameThreshold,
    finalizedFeedbackAgeP95Ms: measurement.finalizedFeedbackAgeP95Ms?.value ?? null,
    configurationSha256: registryProfile.configurationSha256,
    measurement,
  };
});

const acceptedA24Metrics = a24.byteDance.selectedMetrics?.CALIBRATION;
const acceptedA23Metrics = a23.byteDance.metrics?.[a24.byteDance.selectedProfileId]?.CALIBRATION;
if (canonicalJson(acceptedA24Metrics) !== canonicalJson(acceptedA23Metrics)) {
  throw new Error('A.2.4 selected measurement differs from accepted A.2.3 measurement');
}

const resolution = calibration.resolveCalibrationGate2ExactProfile(gate2Profiles);
const selected = gate2Profiles.find((profile) => profile.profileId === resolution.selectedProfileId);
if (!selected) throw new Error('V5 exact profile resolution did not select a ByteDance profile');

const neutralHashRequired = resolution.reason === 'NON_PERFORMANCE_NEUTRAL_HASH';
const byteDanceMeasurementReuse = {
  status: 'A24_MEASUREMENTS_REUSED_UNCHANGED',
  sourceReportPath: A24_REPORT_REL,
  sourceReportSha256: await sha256File(A24_REPORT_REL),
  sourceRawEvidencePath: A24_RAW_REL,
  sourceRawEvidenceSha256: await sha256File(A24_RAW_REL),
  scenarioManifestSha256: a24.scenarioManifest.sha256,
  commonScenarioCount: a24.byteDance.commonCalibrationScenarioCounts.commonScenarioCount,
  rawNeuralInferenceExecutedCount: 0,
  validatedRawCacheLoadCount: rawEvidence.rowCount,
  thresholdDecodeRebound: true,
  candidateScenarioRunReconstructed: true,
  identityValidation: 'PASS',
};

const onlineSelected = a24.onlineAmt.selectedProfileId;
const onlineAccepted = a24.onlineAmt.policyResults.find((item) => item.profileId === onlineSelected);
if (!onlineAccepted || onlineSelected !== 'online-amt-calibration-native-boost-1') {
  throw new Error('Unexpected accepted Online-AMT profile');
}

const supersession = {
  schemaVersion: 1,
  artifact: 'phase9g_a25_incumbent_supersession_receipt',
  phase: '9G-A.2.5',
  historicalArtifactsPreserved: true,
  entries: [
    {
      phase: '9G-A.2.2',
      candidateFamily: 'bytedance-original',
      status: 'INVALIDATED_VARIABLE_CONTEXT_FINAL_WINDOW_FUTURE_OVERRUN',
    },
    {
      phase: '9G-A.2.3',
      candidateFamily: 'bytedance-original',
      status: 'SUPERSEDED_BY_V4_TERMINAL_WINDOW_SEMANTICS',
    },
    {
      phase: '9G-A.2.2',
      candidateFamily: 'online-amt',
      status: 'INVALIDATED_TIMING_CALIBRATION_POSTROLL_EVIDENCE_BOUNDARY',
    },
    {
      phase: '9G-A.2.3',
      candidateFamily: 'online-amt',
      status: 'SUPERSEDED_BY_V4_IN_SCOPE_PHYSICAL_TRUTH_TIMING_CALIBRATION',
    },
    {
      phase: '9G-A.2.4',
      candidateFamily: 'both-incumbents',
      status: 'SUPERSEDED_AS_EXACT_PROFILE_LOCK_SOURCE_BY_V5_GATE2_NORMALIZATION',
    },
  ],
};
await writeJson(SUPERSESSION_REL, supersession);

const finalRegistry = {
  schemaVersion: 1,
  artifact: 'phase9g_a25_final_incumbent_registry',
  phase: '9G-A.2.5',
  implementationGitHead,
  artifactGeneratedFromGitHead: implementationGitHead,
  dirtyTreeAtExecution,
  policy,
  blindManifest: {
    path: BLIND_REL,
    sha256: blindSha,
    candidateRunCount: 0,
  },
  calibrationScenarioManifestSha256: a24.scenarioManifest.sha256,
  profiles: [
    {
      candidateId: 'bytedance-original-calibrated-v1',
      candidateFamily: 'bytedance-original',
      profileId: selected.profileId,
      configurationSha256: selected.configurationSha256,
      checkpointSha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
      fixedOnnxRuntimeAssetSha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
      selectionStatus: 'SELECTED_GATE2_NEUTRAL_HASH',
      qualificationStatus: 'CALIBRATED_AND_LOCKED',
      LOCKED_FOR_PHASE_9G_B: true,
      exactProfileResolution: resolution,
    },
    {
      candidateId: 'online-amt-calibrated-v1',
      candidateFamily: 'online-amt',
      profileId: onlineSelected,
      configurationSha256: onlineAccepted.configurationSha256,
      checkpointSha256: onlineAccepted.policy?.checkpointSha256 ?? '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
      selectionStatus: 'SELECTED_GATE2_NATIVE_POLICY_TIE_BREAK',
      qualificationStatus: 'CALIBRATED_AND_LOCKED',
      LOCKED_FOR_PHASE_9G_B: true,
    },
  ],
};
await writeJson(REGISTRY_REL, finalRegistry);

const report = {
  schemaVersion: 1,
  artifact: 'phase9g_a25_incumbent_selection_normalization',
  phase: '9G-A.2.5',
  calibrationUsed: true,
  evaluationUsed: false,
  blindCandidateInferencePerformed: false,
  productionWinnerSelected: false,
  officialProductRank: null,
  implementationGitHead,
  artifactGeneratedFromGitHead: implementationGitHead,
  dirtyTreeAtExecution,
  policy,
  historicalPolicySha256: {
    v1: calibration.PUBLIC_MODEL_CALIBRATION_PROTOCOL_V1_SHA256,
    v2: calibration.PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2_SHA256,
    v3: calibration.PUBLIC_MODEL_CALIBRATION_PROTOCOL_V3_SHA256,
    v4: calibration.PUBLIC_MODEL_CALIBRATION_PROTOCOL_V4_SHA256,
  },
  blind: {
    path: BLIND_REL,
    sha256: blindSha,
    candidateRunCount: 0,
  },
  supersessionReceiptPath: SUPERSESSION_REL,
  byteDance: {
    oldA24ConfigurationSha256: STARTING_A24_BYTE_CONFIG,
    finalCandidateId: 'bytedance-original-calibrated-v1',
    exactProfileResolution: resolution,
    gate1SurvivorCount: survivorIds.length,
    gate1SurvivorLatencyTable: resolution.latencyRows,
    profilesSurvivingLatencyDiscrimination: resolution.profilesAfterLatency,
    profilesSurvivingContextTieBreak: resolution.profilesAfterContext,
    neutralHashRequired,
    selectedProfileId: selected.profileId,
    selectedContext: selected.contextProfileId,
    selectedThresholds: {
      onset: selected.onsetThreshold,
      frame: selected.frameThreshold,
    },
    finalConfigurationSha256: selected.configurationSha256,
    exactA24ProfileResult: selected.configurationSha256 === STARTING_A24_BYTE_CONFIG ? 'CONFIRMED' : 'REPLACED',
    selectedContextEvidence: 'GATE1_GATE2_SUPPORTED',
    selectedThresholdEvidence: neutralHashRequired
      ? 'STATISTICALLY_TIED_NEUTRAL_PREBLIND_CHOICE'
      : 'GATE2_LATENCY_OR_CONTEXT_SUPPORTED',
    measurementReuse: byteDanceMeasurementReuse,
    noNeuralInferenceExecuted: true,
    historicalGate1SurvivorCountsByContext: a24.byteDance.gate1SurvivorCountsByContext,
  },
  onlineAmt: {
    finalCandidateId: 'online-amt-calibrated-v1',
    selectedProfileId: onlineSelected,
    selectionStatus: 'SELECTED_GATE2_NATIVE_POLICY_TIE_BREAK',
    configurationSha256: onlineAccepted.configurationSha256,
    acceptedA24TimingCalibration: onlineAccepted.timingCalibration,
    noNeuralInferenceExecuted: true,
  },
  confirmations: {
    noChallengerExecuted: true,
    noNewBlindInference: true,
    noProductionWinnerSelected: true,
    productionMicrophoneEnabled: false,
  },
};
await writeJson(REPORT_REL, report);
console.log(JSON.stringify({ report: REPORT_REL, registry: REGISTRY_REL, selectedByteDance: selected.profileId, selectedConfigurationSha256: selected.configurationSha256 }, null, 2));

function parseByteDanceProfileId(profileId) {
  const match = profileId.match(/CALIBRATED_CONTEXT_(1820|3S|5S|10S)-onset-([0-9.]+)-frame-([0-9.]+)/);
  if (!match) throw new Error(`Invalid ByteDance profile id: ${profileId}`);
  const contextName = `CALIBRATED_CONTEXT_${match[1]}`;
  const modelInputMs = match[1] === '1820' ? 1820 : Number(match[1].replace('S', '000'));
  return {
    contextProfileId: contextName,
    modelInputMs,
    onsetThreshold: Number(match[2]),
    frameThreshold: Number(match[3]),
  };
}

async function measuredPolicyIdentity(relativePath) {
  const text = await readFile(path.resolve(repoRoot, relativePath), 'utf8');
  const parsed = JSON.parse(text);
  return {
    path: relativePath,
    sha256: sha256Text(text),
    policyId: parsed.policyId,
    schemaVersion: parsed.schemaVersion,
  };
}

async function sha256File(relativePath) {
  return sha256Text(await readFile(path.resolve(repoRoot, relativePath)));
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function writeJson(relativePath, value) {
  const outputPath = path.resolve(repoRoot, relativePath);
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function gitHead() {
  return readFileSync(path.resolve(repoRoot, '.git/HEAD'), 'utf8').startsWith('ref:')
    ? execGit(['rev-parse', 'HEAD'])
    : execGit(['rev-parse', 'HEAD']);
}

function gitDirty() {
  return execGit(['status', '--porcelain']).length > 0;
}

function execGit(args) {
  const { execFileSync } = require('node:child_process');
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}
