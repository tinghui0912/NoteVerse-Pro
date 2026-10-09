#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const calibration = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-model-calibration.ts'));
const publicContract = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-fixed-bpm-benchmark.ts'));
const byteDance = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'));
const onlineAmt = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));

const IMPLEMENTATION_HEAD = gitHead(repoRoot);
const DIRTY = gitDirty(repoRoot);
const POLICY_REL = 'backend/research/policies/public_model_calibration_protocol_v3_2026-10-09.json';
const SCENARIO_REL = 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json';
const BASELINE_REPORT_REL = 'backend/research/reports/phase9g_a1_vienna_calibration_baseline_reference_2026-10-09.json';
const BLIND_REL = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json';
const REPORT_REL = 'backend/research/reports/phase9g_a2_bytedance_online_amt_calibration_2026-10-09.json';
const PROFILE_REGISTRY_REL = 'backend/research/reports/phase9g_a2_calibrated_profile_registry_2026-10-09.json';
const BLIND_LOCK_REL = 'backend/research/reports/phase9g_a2_blind_lock_receipt_2026-10-09.json';
const V1V2_RECEIPT_REL = 'backend/research/reports/phase9g_a2_v1_v2_blind_semantic_equivalence_2026-10-09.json';
const ONLINE_AMT_IMAGE = 'noteverse-online-amt-modern:phase9e-b1';
const ONLINE_AMT_POLICIES = [
  { profileId: 'ONLINE_AMT_DISABLED_BOOST_2', pseudoIntensity: 'DISABLED', onsetBoost: 2.0 },
  { profileId: 'ONLINE_AMT_DISABLED_BOOST_1', pseudoIntensity: 'DISABLED', onsetBoost: 1.0 },
  { profileId: 'ONLINE_AMT_NATIVE_BOOST_2', pseudoIntensity: 'NATIVE', onsetBoost: 2.0 },
  { profileId: 'ONLINE_AMT_NATIVE_BOOST_1', pseudoIntensity: 'NATIVE', onsetBoost: 1.0 },
];

await mkdir(path.resolve(repoRoot, 'backend/research/reports'), { recursive: true });
await mkdir(path.resolve(repoRoot, 'backend/data/work/public_proxy/vienna-4x22/phase9ga2'), { recursive: true });

const policy = await measuredPolicyIdentity(POLICY_REL);
calibration.assertPublicModelCalibrationPolicyIdentity(policy);
calibration.assertViennaPublicProxyExecutionAllowed({
  phase: '9G-A',
  mode: 'CANDIDATE_INFERENCE',
  scenarioSplit: 'CALIBRATION',
  performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
  policy,
});

const blindManifestSha = await sha256File(path.resolve(repoRoot, BLIND_REL));
const blindManifest = JSON.parse(await readFile(path.resolve(repoRoot, BLIND_REL), 'utf8'));
const blindProjection = semanticProjection(blindManifest);
const blindLock = {
  schemaVersion: 1,
  artifact: 'phase9g_a2_blind_lock_receipt',
  phase: '9G-A.2',
  blindManifestPath: BLIND_REL,
  blindManifestSha256: blindManifestSha,
  expectedBlindManifestSha256: '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab',
  scenarioCount: blindManifest.scenarios.length,
  candidateRunCount: 0,
  blindPerformerIds: ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'],
  semanticTruthProjectionSha256: sha256Json(blindProjection),
};
if (blindLock.blindManifestSha256 !== blindLock.expectedBlindManifestSha256 || blindLock.scenarioCount !== 70) {
  throw new Error(`Blind lock mismatch: ${JSON.stringify(blindLock)}`);
}
await writeJson(BLIND_LOCK_REL, blindLock);

const v1Text = execFileSync('git', ['show', `b938fc49:${BLIND_REL}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const v1Manifest = JSON.parse(v1Text);
const v1Sha = sha256Text(v1Text);
const v2Text = await readFile(path.resolve(repoRoot, BLIND_REL), 'utf8');
const v2Manifest = JSON.parse(v2Text);
const v2Sha = sha256Text(v2Text);
const v1ProjectionSha = sha256Json(semanticProjection(v1Manifest));
const v2ProjectionSha = sha256Json(semanticProjection(v2Manifest));
await writeJson(V1V2_RECEIPT_REL, {
  schemaVersion: 1,
  artifact: 'phase9g_a2_v1_v2_blind_semantic_equivalence',
  v1ManifestGitObject: `b938fc49:${BLIND_REL}`,
  v1ManifestSha256: v1Sha,
  v2ManifestPath: BLIND_REL,
  v2ManifestSha256: v2Sha,
  v1SemanticProjectionSha256: v1ProjectionSha,
  v2SemanticProjectionSha256: v2ProjectionSha,
  equivalenceStatus: v1ProjectionSha === v2ProjectionSha ? 'PASS' : 'FAIL',
});

const scenarioManifest = JSON.parse(await readFile(path.resolve(repoRoot, SCENARIO_REL), 'utf8'));
const scenarioManifestSha = await sha256File(path.resolve(repoRoot, SCENARIO_REL));
const baselineReportSha = await sha256File(path.resolve(repoRoot, BASELINE_REPORT_REL));
const scenarios = scenarioManifest.scenarios;
const baseScenarios = scenarios.filter((scenario) => scenario.familyTags.includes('BASE_ORIGINAL'));
const counterfactualReceiptsByScenario = new Map((scenarioManifest.counterfactualReceipts ?? []).map((receipt) => [receipt.scenarioId, receipt]));

const byteDanceResult = await runByteDanceCalibration({ scenarios, baseScenarios, counterfactualReceiptsByScenario, scenarioManifestSha });
const onlineAmtResult = await runOnlineAmtCalibration({ scenarios, baseScenarios, counterfactualReceiptsByScenario, scenarioManifestSha });

const registry = {
  schemaVersion: 1,
  artifact: 'phase9g_a2_calibrated_profile_registry',
  phase: '9G-A.2',
  policy,
  scenarioManifestSha256: scenarioManifestSha,
  profiles: [...byteDanceResult.profileRegistry, ...onlineAmtResult.profileRegistry],
};
await writeJson(PROFILE_REGISTRY_REL, registry);

const report = {
  schemaVersion: 1,
  artifact: 'phase9g_a2_bytedance_online_amt_calibration',
  phase: '9G-A.2',
  calibrationUsed: true,
  evaluationUsed: false,
  blindCandidateInferencePerformed: false,
  productionWinnerSelected: false,
  officialProductRank: null,
  implementationGitHead: IMPLEMENTATION_HEAD,
  artifactGeneratedFromGitHead: gitHead(repoRoot),
  dirtyTreeAtExecution: DIRTY,
  policy,
  historicalPolicies: {
    v1Sha256: calibration.PUBLIC_MODEL_CALIBRATION_PROTOCOL_V1_SHA256,
    v2Sha256: calibration.PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2_SHA256,
    v3Sha256: calibration.PUBLIC_MODEL_CALIBRATION_PROTOCOL_V3_SHA256,
  },
  frozenBlind: {
    manifestPath: BLIND_REL,
    manifestSha256: blindManifestSha,
    candidateRunCount: 0,
    lockReceiptPath: BLIND_LOCK_REL,
    semanticProjectionSha256: blindLock.semanticTruthProjectionSha256,
  },
  v1V2BlindSemanticEquivalenceReceiptPath: V1V2_RECEIPT_REL,
  scenarioManifest: {
    path: SCENARIO_REL,
    sha256: scenarioManifestSha,
    scenarioCount: scenarios.length,
    baseScenarioCount: baseScenarios.length,
  },
  acceptedAuditCleanBaselineMeasurements: {
    path: BASELINE_REPORT_REL,
    sha256: baselineReportSha,
    reuseStatus: 'MEASUREMENTS_REUSED_UNCHANGED_FROM_AUDIT_CLEAN_V1_RUN_FOR_HISTORICAL_BASELINE_CONTEXT',
  },
  byteDance: byteDanceResult.report,
  onlineAmt: onlineAmtResult.report,
  confirmations: {
    selectionWithinFamilyOnly: true,
    noTranskunAriaRttRobustByteDanceOrD3rmExecuted: true,
    noBlindCandidateOutputGenerated: true,
    noProductionWinnerSelected: true,
    productionMicrophoneEnabled: false,
  },
};
await writeJson(REPORT_REL, report);
console.log(REPORT_REL);

async function runByteDanceCalibration(input) {
  const executableContexts = [{
    profileId: 'CALIBRATED_CONTEXT_1820',
    modelInputMs: 1820,
    futureContextMs: 220,
    commitWidthMs: 600,
    status: 'EXECUTABLE_CURRENT_ONNX',
  }];
  const blockedContexts = ['CALIBRATED_CONTEXT_3S', 'CALIBRATED_CONTEXT_5S', 'CALIBRATED_CONTEXT_10S'].map((profileId) => ({
    profileId,
    status: 'BLOCKED_SAME_WEIGHT_CONTEXT_COMPARISON_UNPROVEN',
    reason: 'Only the fixed 29120-sample ONNX asset is present in local reproducible assets; no original PyTorch checkpoint/export provenance is available to prove same-weight longer-context execution.',
  }));
  const profiles = [];
  const candidateDefinitions = [];
  const runs = [];
  const failures = [];
  const rawCache = new Map();
  for (const onsetThreshold of calibration.BYTEDANCE_PHASE_9GA_THRESHOLD_GRID.onset) {
    for (const frameThreshold of calibration.BYTEDANCE_PHASE_9GA_THRESHOLD_GRID.frame) {
      const profile = bytedanceProfile({ context: executableContexts[0], onsetThreshold, frameThreshold });
      profiles.push(profile);
      candidateDefinitions.push(candidateDefinition({
        candidateId: profile.profileId,
        strategyKind: 'CHUNKED',
        runtime: 'ByteDance original ONNX current 1820ms family',
        checkpointSha: byteDance.BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelSha256,
        adapterVersion: 'phase9g-a2-threshold-calibration-v1',
        configurationSha256: profile.configurationSha256,
      }));
      for (const scenario of input.scenarios) {
        try {
          const baseScenarioId = input.counterfactualReceiptsByScenario.get(scenario.scenarioId)?.baseScenarioId ?? scenario.scenarioId;
          const raw = await loadByteDanceRaw(baseScenarioId, rawCache);
          runs.push(runByteDanceFromRaw({ scenario, raw, profile }));
        } catch (error) {
          failures.push({ profileId: profile.profileId, scenarioId: scenario.scenarioId, error: errorMessage(error) });
        }
      }
    }
  }
  const diagnostic = publicContract.buildPublicDiagnosticBakeoffReport({
    scenarios: input.scenarios,
    candidates: candidateDefinitions,
    runs,
  });
  const scores = calibrationScoresFromSummaries(diagnostic.scores);
  const selection = calibration.selectCalibrationProfile(scores);
  const selectorSuggestedProfileId = selection.selectedProfileId ?? fallbackProfileId(profiles, 'bytedance-original-calibrated-v1');
  const selectedProfileId = historicalByteDanceProfileId(profiles);
  return {
    profileRegistry: profiles.map((profile) => ({
      candidateFamily: 'bytedance-original',
      profileId: profile.profileId,
      selectedCandidateId: profile.profileId === selectedProfileId ? 'bytedance-original-calibrated-v1' : profile.profileId,
      configurationSha256: profile.configurationSha256,
      LOCKED_FOR_PHASE_9G_B: profile.profileId === selectedProfileId,
      selectionStatus: profile.profileId === selectedProfileId ? 'SELECTED_OR_GATE1_FALLBACK' : 'REJECTED_OR_NOT_SELECTED',
    })),
    report: {
      sameWeightParityStatus: 'SAME_WEIGHT_CONTEXT_COMPARISON_UNPROVEN',
      contexts: [...executableContexts, ...blockedContexts],
      commonCalibrationScenarioCounts: {
        totalCalibrationScenarios: input.scenarios.length,
        executableCurrentOnnxScenarios: input.scenarios.length,
        allFourContextCommonMatchedCount: 0,
        status: 'INSUFFICIENT_COMMON_CALIBRATION_COVERAGE_FOR_LONG_CONTEXT_SELECTION',
      },
      rawNeuralInferenceRunCount: rawCache.size,
      rawCacheReuseCount: input.scenarios.length * profiles.length - rawCache.size,
      thresholdProfileCount: profiles.length,
      blockedContextCount: blockedContexts.length,
      metrics: compactAggregateMetrics(diagnostic.aggregateMetrics),
      selectorTrace: selection,
      selectorSuggestedProfileId,
      selectionOverride: {
        status: 'PRESERVED_HISTORICAL_CURRENT_BASELINE_REFERENCE',
        reason: 'Longer-context same-weight comparison is unproven; Phase 9G-A.2 policy preserves the current ByteDance baseline instead of selecting a partially swept threshold-only variant.',
      },
      selectedProfileId,
      selectedContext: 'CALIBRATED_CONTEXT_1820',
      selectedThresholdPair: profiles.find((profile) => profile.profileId === selectedProfileId)?.thresholds ?? null,
      selectedConfigurationSha256: profiles.find((profile) => profile.profileId === selectedProfileId)?.configurationSha256 ?? null,
      historicalCurrentBaselineResult: profiles.find((profile) => profile.thresholds.onsetThreshold === 0.2 && profile.thresholds.frameThreshold === 0.2)?.profileId,
      upstreamNative10sResult: 'BLOCKED_SAME_WEIGHT_CONTEXT_COMPARISON_UNPROVEN',
      failures,
    },
  };
}

async function runOnlineAmtCalibration(input) {
  const profiles = [];
  const candidateDefinitions = [];
  const runs = [];
  const timingReports = [];
  const failures = [];
  for (const policy of ONLINE_AMT_POLICIES) {
    const batchArtifact = await runOnlineAmtBatch(policy, input.baseScenarios);
    const correction = timingCorrectionForPolicy({ policy, batchArtifact, baseScenarios: input.baseScenarios });
    const profile = onlineAmtProfile({ policy, timingCorrectionMs: correction.timingCorrectionMs });
    timingReports.push({ ...correction, profileId: profile.profileId });
    profiles.push(profile);
    candidateDefinitions.push(candidateDefinition({
      candidateId: profile.profileId,
      strategyKind: 'STREAMING',
      runtime: 'Online-AMT modern compatibility Docker CPU',
      checkpointSha: onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.checkpointSha256,
      adapterVersion: 'phase9g-a2-online-amt-policy-calibration-v1',
      configurationSha256: profile.configurationSha256,
    }));
    for (const scenario of input.scenarios) {
      try {
        const baseScenarioId = input.counterfactualReceiptsByScenario.get(scenario.scenarioId)?.baseScenarioId ?? scenario.scenarioId;
        const segment = segmentForScenario(batchArtifact, baseScenarioId);
        runs.push(onlineAmt.runOnlineAmtStreamingCandidateFromHopArtifact({
          scenario,
          artifact: { schemaVersion: 1, artifact: 'online_amt_real_hop_output', segments: [segment] },
          candidateId: profile.profileId,
          command: `docker run ${ONLINE_AMT_IMAGE} run_online_amt_modern_smoke.py --pseudo-intensity ${policy.pseudoIntensity} --onset-boost ${policy.onsetBoost}`,
          runtime: 'real-online-amt-modern-docker-phase9ga2',
          timingCorrectionMs: correction.timingCorrectionMs,
        }));
      } catch (error) {
        failures.push({ profileId: profile.profileId, scenarioId: scenario.scenarioId, error: errorMessage(error) });
      }
    }
  }
  const diagnostic = publicContract.buildPublicDiagnosticBakeoffReport({
    scenarios: input.scenarios,
    candidates: candidateDefinitions,
    runs,
  });
  const scores = calibrationScoresFromSummaries(diagnostic.scores);
  const selection = calibration.selectCalibrationProfile(scores);
  const selectedProfileId = selection.selectedProfileId ?? fallbackProfileId(profiles, 'online-amt-calibrated-v1');
  return {
    profileRegistry: profiles.map((profile) => ({
      candidateFamily: 'online-amt',
      profileId: profile.profileId,
      selectedCandidateId: profile.profileId === selectedProfileId ? 'online-amt-calibrated-v1' : profile.profileId,
      configurationSha256: profile.configurationSha256,
      LOCKED_FOR_PHASE_9G_B: profile.profileId === selectedProfileId,
      selectionStatus: profile.profileId === selectedProfileId ? 'SELECTED_OR_GATE1_FALLBACK' : 'REJECTED_OR_NOT_SELECTED',
    })),
    report: {
      policyResults: profiles.map((profile) => ({
        profileId: profile.profileId,
        policy: profile.policy,
        configurationSha256: profile.configurationSha256,
        timingCalibration: timingReports.find((item) => item.profileId === profile.profileId),
        metrics: compactAggregateMetrics(diagnostic.aggregateMetrics[profile.profileId]),
      })),
      selectorTrace: selection,
      selectedProfileId,
      selectedPseudoPolicy: profiles.find((profile) => profile.profileId === selectedProfileId)?.policy.pseudoIntensity ?? null,
      selectedBoost: profiles.find((profile) => profile.profileId === selectedProfileId)?.policy.onsetBoost ?? null,
      selectedTimingCorrectionMs: profiles.find((profile) => profile.profileId === selectedProfileId)?.timingCorrectionMs ?? null,
      selectedConfigurationSha256: profiles.find((profile) => profile.profileId === selectedProfileId)?.configurationSha256 ?? null,
      failures,
    },
  };
}

function runByteDanceFromRaw({ scenario, raw, profile }) {
  const plans = byteDance.planByteDanceScoreAwareChunks(scenario);
  const rawChunks = raw.chunks;
  const processingByChunk = new Map(plans.map((plan, index) => [plan.chunkId, rawChunks[index]?.inferenceLatencyMs ?? 0]));
  const schedule = byteDance.scheduleByteDanceSingleWorkerPublications({ plans, processingLatencyMsByChunkId: processingByChunk });
  const publications = plans.map((plan, index) => {
    const chunk = rawChunks[index];
    const decoded = byteDance.decodeByteDanceChunkRawOutputs({
      scenario,
      plan,
      raw: byteDance.byteDanceRawOutputsFromBrowserChunkArtifact(chunk),
      onsetThreshold: profile.thresholds.onsetThreshold,
      frameThreshold: profile.thresholds.frameThreshold,
    });
    const timing = schedule.get(plan.chunkId);
    return byteDance.publicationForByteDanceChunk({
      scenario,
      plan,
      observations: byteDance.observationsForByteDanceChunk(scenario, plan, decoded),
      inferenceLatencyMs: chunk.inferenceLatencyMs,
      candidateProcessingLatencyMs: chunk.inferenceLatencyMs,
      publicationAvailableAtMs: timing.inferenceFinishAtMs,
      inferenceStartAtMs: timing.inferenceStartAtMs,
      queueDelayMs: timing.queueDelayMs,
    });
  });
  return byteDance.candidateRunForByteDanceChunks({
    candidateId: profile.profileId,
    scenarioId: scenario.scenarioId,
    publications,
    command: 'phase9ga2 decode cached real ByteDance raw ONNX outputs',
    runtime: 'real-ort-web-wasm-cached-raw-phase9ga2',
  });
}

async function loadByteDanceRaw(scenarioId, cache) {
  if (cache.has(scenarioId)) return cache.get(scenarioId);
  const rawPath = path.resolve(repoRoot, `backend/data/work/public_proxy/vienna-4x22/runs/${sanitizeFile(scenarioId)}.bytedance.raw.json`);
  if (!existsSync(rawPath)) throw new Error(`Missing cached real ByteDance raw output: ${rawPath}`);
  const raw = JSON.parse(await readFile(rawPath, 'utf8'));
  cache.set(scenarioId, raw);
  return raw;
}

async function runOnlineAmtBatch(policy, baseScenarios) {
  const segments = [];
  for (const scenario of baseScenarios) {
    const wav = byteDance.decodeResearchWavToMonoFloat32(await readFile(path.resolve(repoRoot, scenario.source.sourceAudioPath)));
    const completion = scenario.completion.performanceTimeMs;
    const ownedSamples = Math.floor(completion / 1000 * onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz);
    const requirement = onlineAmt.onlineAmtSegmentTailRequirement(ownedSamples);
    segments.push({
      segmentId: `${scenario.scenarioId}:segment-0`,
      performanceStartMs: 0,
      performancePcm16k: Array.from(resampleLinear({
        sourcePcm: wav.pcm,
        sourceSampleRateHz: wav.sampleRateHz,
        sourceStartMs: scenario.audio.performanceOriginSourceMs,
        sampleCount: ownedSamples,
      })),
      contextTailPcm16k: Array.from(resampleLinear({
        sourcePcm: wav.pcm,
        sourceSampleRateHz: wav.sampleRateHz,
        sourceStartMs: scenario.audio.performanceOriginSourceMs + completion,
        sampleCount: requirement.requiredContextTailSamples,
      })),
    });
  }
  const safe = `${policy.profileId.toLowerCase()}`;
  const inputRel = `backend/data/work/public_proxy/vienna-4x22/phase9ga2/${safe}.segments.json`;
  const outputRel = `backend/data/work/public_proxy/vienna-4x22/phase9ga2/${safe}.hop-artifact.json`;
  await writeJson(inputRel, { segments });
  const run = spawnSync('docker', [
    'run', '--rm',
    '-v', `${repoRoot}:/workspace`,
    '-w', '/workspace',
    ONLINE_AMT_IMAGE,
    'python',
    'backend/research/online_amt/run_online_amt_modern_smoke.py',
    '--online-amt-repo', 'backend/data/work/online_amt',
    '--checkpoint', 'backend/data/work/online_amt/model-180000.pt',
    '--segment-input', inputRel,
    '--output', outputRel,
    '--pseudo-intensity', policy.pseudoIntensity,
    '--onset-boost', String(policy.onsetBoost),
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 20 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`Online-AMT batch failed for ${policy.profileId}: ${run.stderr || run.stdout}`);
  const artifact = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));
  if (artifact.runtimeSmoke?.status !== 'PASS' || !artifact.hopArtifact) throw new Error(`Online-AMT batch did not PASS for ${policy.profileId}`);
  return artifact.hopArtifact;
}

function timingCorrectionForPolicy({ policy, batchArtifact, baseScenarios }) {
  const offsets = [];
  for (const scenario of baseScenarios) {
    const segment = segmentForScenario(batchArtifact, scenario.scenarioId);
    const rawRun = onlineAmt.runOnlineAmtStreamingCandidateFromHopArtifact({
      scenario,
      artifact: { schemaVersion: 1, artifact: 'online_amt_real_hop_output', segments: [segment] },
      candidateId: policy.profileId,
      command: 'phase9ga2 raw timing calibration',
      runtime: 'real-online-amt-modern-docker-phase9ga2',
      timingCorrectionMs: 0,
    });
    const candidate = rawRun.publications.flatMap((publication) => publication.observations);
    offsets.push(...matchOffsets(candidate, scenario.physicalGroundTruth.attacks));
  }
  offsets.sort((left, right) => left - right);
  const timingCorrectionMs = median(offsets);
  const residuals = offsets.map((offset) => offset - timingCorrectionMs).sort((left, right) => left - right);
  return {
    profileId: policy.profileId,
    policy,
    matchedPairCount: offsets.length,
    timingCorrectionMs,
    signedResidualP05Ms: percentile(residuals, 0.05),
    signedResidualP50Ms: percentile(residuals, 0.50),
    signedResidualP95Ms: percentile(residuals, 0.95),
    absoluteResidualP50Ms: percentile(residuals.map(Math.abs).sort((left, right) => left - right), 0.50),
    absoluteResidualP95Ms: percentile(residuals.map(Math.abs).sort((left, right) => left - right), 0.95),
  };
}

function matchOffsets(candidateObservations, physicalAttacks) {
  const offsets = [];
  const pitches = new Set([...candidateObservations.map((item) => item.pitch), ...physicalAttacks.map((item) => item.pitch)]);
  for (const pitch of pitches) {
    const candidate = candidateObservations.filter((item) => item.pitch === pitch).map((item) => item.performanceTimeMs).sort((a, b) => a - b);
    const physical = physicalAttacks.filter((item) => item.pitch === pitch).map((item) => item.performanceTimeMs).sort((a, b) => a - b);
    offsets.push(...matchPitchOffsets(candidate, physical));
  }
  return offsets;
}

function matchPitchOffsets(candidate, physical) {
  const memo = new Map();
  const solve = (i, j) => {
    const key = `${i}|${j}`;
    if (memo.has(key)) return memo.get(key);
    if (i >= candidate.length || j >= physical.length) return { count: 0, cost: 0, offsets: [] };
    const options = [solve(i + 1, j), solve(i, j + 1)];
    const diff = physical[j] - candidate[i];
    if (Math.abs(diff) <= 250) {
      const next = solve(i + 1, j + 1);
      options.push({ count: next.count + 1, cost: next.cost + Math.abs(diff), offsets: [diff, ...next.offsets] });
    }
    const best = options.sort((a, b) => (b.count - a.count) || (a.cost - b.cost))[0];
    memo.set(key, best);
    return best;
  };
  return solve(0, 0).offsets;
}

function segmentForScenario(batchArtifact, scenarioId) {
  const segmentId = `${scenarioId}:segment-0`;
  const segment = batchArtifact.segments.find((item) => item.segmentId === segmentId);
  if (!segment) throw new Error(`Missing Online-AMT segment ${segmentId}`);
  return segment;
}

function calibrationScoresFromSummaries(scores) {
  return scores.map((score) => ({
    profileId: score.candidateId,
    scenarioId: score.scenarioId,
    family: score.scenarioId.includes('counterfactual_missing_note') ? 'COUNTERFACTUAL_MISSING_NOTE'
      : score.scenarioId.includes('counterfactual_extra_note') ? 'COUNTERFACTUAL_EXTRA_NOTE'
        : score.scenarioId.includes('counterfactual_wrong_semitone') ? 'COUNTERFACTUAL_WRONG_SEMITONE'
          : score.scenarioId.includes('counterfactual_incomplete_chord') ? 'COUNTERFACTUAL_INCOMPLETE_CHORD'
            : 'BASE_ORIGINAL',
    metrics: Object.fromEntries(Object.entries(score.metrics).flatMap(([key, metric]) =>
      metric.status === 'MEASURED'
        ? [[key, { value: metric.value, numerator: metric.numerator, denominator: metric.denominator }]]
        : []
    )),
  }));
}

function bytedanceProfile({ context, onsetThreshold, frameThreshold }) {
  const projection = {
    candidateFamily: 'bytedance-original',
    checkpointSha256: byteDance.BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelSha256,
    context,
    onsetThreshold,
    frameThreshold,
    decoderVersion: 'phase9g-a2-bytedance-threshold-grid-v1',
  };
  return {
    profileId: `bytedance-original-calibration-${context.profileId}-onset-${onsetThreshold.toFixed(2)}-frame-${frameThreshold.toFixed(2)}`,
    configurationSha256: sha256Json(projection),
    thresholds: { onsetThreshold, frameThreshold },
    projection,
  };
}

function onlineAmtProfile({ policy, timingCorrectionMs }) {
  const projection = {
    candidateFamily: 'online-amt',
    checkpointSha256: onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.checkpointSha256,
    sampleRateHz: 16000,
    hopSamples: 512,
    onsetStateIds: [3, 4],
    pseudoIntensity: policy.pseudoIntensity,
    onsetBoost: policy.onsetBoost,
    timingCorrectionMs,
  };
  return {
    profileId: `online-amt-calibration-${policy.pseudoIntensity.toLowerCase()}-boost-${String(policy.onsetBoost).replace('.', '_')}`,
    configurationSha256: sha256Json(projection),
    timingCorrectionMs,
    policy,
    projection,
  };
}

function candidateDefinition({ candidateId, strategyKind, runtime, checkpointSha, adapterVersion, configurationSha256 }) {
  return {
    candidateId,
    strategyKind,
    identity: {
      modelRuntime: runtime,
      modelCheckpointSha256: checkpointSha,
      adapterVersion,
      sourceGitHead: IMPLEMENTATION_HEAD,
      configurationSha256,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };
}

function compactAggregateMetrics(aggregateMetrics) {
  return aggregateMetrics ?? null;
}

function fallbackProfileId(profiles, selectedCandidateId) {
  const historical = profiles.find((profile) =>
    profile.thresholds?.onsetThreshold === 0.2
    && profile.thresholds?.frameThreshold === 0.2
  );
  return historical?.profileId ?? profiles[0]?.profileId ?? selectedCandidateId;
}

function historicalByteDanceProfileId(profiles) {
  return profiles.find((profile) =>
    profile.thresholds?.onsetThreshold === 0.2
    && profile.thresholds?.frameThreshold === 0.2
  )?.profileId ?? fallbackProfileId(profiles, 'bytedance-original-calibrated-v1');
}

function semanticProjection(manifest) {
  const receipts = new Map((manifest.scenarioReceipts ?? []).map((receipt) => [receipt.scenarioId, receipt]));
  return manifest.scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    family: scenario.familyTags.find((tag) => tag === 'BASE_ORIGINAL' || tag.startsWith('COUNTERFACTUAL_')) ?? null,
    audioSha: scenario.source.sourceAudioSha256,
    midiSha: scenario.source.sourceMidiSha256,
    practiceScoreArtifactSha: receipts.get(scenario.scenarioId)?.practiceScoreArtifactSha256 ?? null,
    scope: receipts.get(scenario.scenarioId)?.practiceScope ?? null,
    configuredBpm: receipts.get(scenario.scenarioId)?.configuredIntegerBpm ?? null,
    completion: scenario.completion,
    expectedStrikes: scenario.expectedStrikes.map((strike) => ({
      strikeId: strike.strikeId,
      groupId: strike.groupId,
      pitch: strike.pitch,
      t: strike.expectedPerformanceTimeMs,
    })),
    physicalAttacks: scenario.physicalGroundTruth.attacks.map((attack) => ({
      id: attack.physicalEventId,
      pitch: attack.pitch,
      t: attack.performanceTimeMs,
      velocity: attack.velocity,
    })),
  })).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

function resampleLinear({ sourcePcm, sourceSampleRateHz, sourceStartMs, sampleCount }) {
  const output = new Float32Array(sampleCount);
  const sourceStart = sourceStartMs / 1000 * sourceSampleRateHz;
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = sourceStart + index * sourceSampleRateHz / 16000;
    const left = Math.floor(sourcePosition);
    const right = Math.min(sourcePcm.length - 1, left + 1);
    const fraction = sourcePosition - left;
    output[index] = (sourcePcm[left] ?? 0) * (1 - fraction) + (sourcePcm[right] ?? 0) * fraction;
  }
  return output;
}

function median(values) {
  if (values.length === 0) return null;
  return percentile(values, 0.5);
}

function percentile(values, q) {
  if (values.length === 0) return null;
  const index = (values.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return values[lower] * (1 - fraction) + values[upper] * fraction;
}

async function measuredPolicyIdentity(rel) {
  const file = path.resolve(repoRoot, rel);
  const text = await readFile(file, 'utf8');
  const json = JSON.parse(text);
  return { path: rel, sha256: sha256Text(text), policyId: json.policyId, schemaVersion: json.schemaVersion };
}

async function writeJson(rel, value) {
  const file = path.resolve(repoRoot, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function sha256File(file) {
  return sha256Text(await readFile(file, 'utf8'));
}

function sha256Json(value) {
  return sha256Text(canonicalJson(value));
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sanitizeFile(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function gitHead(cwd) {
  return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function gitDirty(cwd) {
  return execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
