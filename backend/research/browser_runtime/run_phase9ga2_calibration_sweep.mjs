#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
const REPORT_REL = 'backend/research/reports/phase9g_a23_bytedance_online_amt_incumbent_completion_2026-10-09.json';
const PROFILE_REGISTRY_REL = 'backend/research/reports/phase9g_a23_final_incumbent_registry_2026-10-09.json';
const CORRECTION_RECEIPT_REL = 'backend/research/reports/phase9g_a23_prior_artifact_status_receipt_2026-10-09.json';
const BYTEDANCE_PROVENANCE_REL = 'backend/research/reports/phase9g_a23_bytedance_same_weight_provenance_2026-10-09.json';
const BYTEDANCE_PARITY_REL = 'backend/research/reports/phase9g_a23_bytedance_checkpoint_onnx_decoded_parity_2026-10-09.json';
const BYTEDANCE_RAW_EVIDENCE_REL = 'backend/research/reports/phase9g_a23_bytedance_raw_evidence_manifest_2026-10-09.json';
const BYTEDANCE_FUTURE_OVERRUN_REL = 'backend/research/reports/phase9g_a23_bytedance_future_overrun_diagnostic_2026-10-09.json';
const BLIND_LOCK_REL = 'backend/research/reports/phase9g_a23_blind_lock_receipt_2026-10-09.json';
const V1V2_RECEIPT_REL = 'backend/research/reports/phase9g_a23_v1_v2_blind_semantic_equivalence_2026-10-09.json';
const A21_REPORT_REL = 'backend/research/reports/phase9g_a21_bytedance_online_amt_incumbent_completion_2026-10-09.json';
const A22_REPORT_REL = 'backend/research/reports/phase9g_a22_bytedance_online_amt_incumbent_completion_2026-10-09.json';
const ONLINE_AMT_IMAGE = 'noteverse-online-amt-modern:phase9e-b1';
const BYTEDANCE_IMAGE = 'noteverse-bytedance-calibration:phase9ga21';
const TIMING_CALIBRATION_REAL_POSTROLL_MS = 500;
const EXPECTED_BYTEDANCE_CHECKPOINT = {
  path: 'models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth',
  sha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
  bytes: 171966578,
};
const EXPECTED_BYTEDANCE_ONNX = {
  path: 'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx',
  sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
  bytes: 98691493,
};
const BYTEDANCE_HISTORICAL_PARITY_REPORTS = [
  'backend/research/reports/bytedance_browser_runtime_feasibility.md',
  'backend/research/reports/bytedance_continuous_batch_export_parity_2026-10-05.json',
  'backend/research/reports/bytedance_rolling_anchor_feasibility_2026-10-03.json',
  'backend/research/reports/bytedance_target_verifier_context_matrix_dev_bounded_2026-10-05.json',
];
const ONLINE_AMT_POLICIES = [
  { profileId: 'ONLINE_AMT_DISABLED_BOOST_2', pseudoIntensity: 'DISABLED', onsetBoost: 2.0 },
  { profileId: 'ONLINE_AMT_DISABLED_BOOST_1', pseudoIntensity: 'DISABLED', onsetBoost: 1.0 },
  { profileId: 'ONLINE_AMT_NATIVE_BOOST_2', pseudoIntensity: 'NATIVE', onsetBoost: 2.0 },
  { profileId: 'ONLINE_AMT_NATIVE_BOOST_1', pseudoIntensity: 'NATIVE', onsetBoost: 1.0 },
];

await mkdir(path.resolve(repoRoot, 'backend/research/reports'), { recursive: true });
await mkdir(path.resolve(repoRoot, 'backend/data/work/public_proxy/vienna-4x22/phase9ga23'), { recursive: true });

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
  artifact: 'phase9g_a23_blind_lock_receipt',
  phase: '9G-A.2.3',
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
  artifact: 'phase9g_a23_v1_v2_blind_semantic_equivalence',
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
const a21Report = existsSync(path.resolve(repoRoot, A21_REPORT_REL))
  ? JSON.parse(await readFile(path.resolve(repoRoot, A21_REPORT_REL), 'utf8'))
  : null;
const a21ReportSha = existsSync(path.resolve(repoRoot, A21_REPORT_REL))
  ? await sha256File(path.resolve(repoRoot, A21_REPORT_REL))
  : null;
const a22Report = existsSync(path.resolve(repoRoot, A22_REPORT_REL))
  ? JSON.parse(await readFile(path.resolve(repoRoot, A22_REPORT_REL), 'utf8'))
  : null;
const a22ReportSha = existsSync(path.resolve(repoRoot, A22_REPORT_REL))
  ? await sha256File(path.resolve(repoRoot, A22_REPORT_REL))
  : null;
const scenarios = scenarioManifest.scenarios;
const baseScenarios = scenarios.filter((scenario) => scenario.familyTags.includes('BASE_ORIGINAL'));
const counterfactualReceiptsByScenario = new Map((scenarioManifest.counterfactualReceipts ?? []).map((receipt) => [receipt.scenarioId, receipt]));
const byteDanceFutureOverrunDiagnostic = await writeByteDanceFutureOverrunDiagnostic(baseScenarios);

await ensureByteDanceParityReceipt();
const byteDanceResult = await runByteDanceCalibration({ scenarios, baseScenarios, counterfactualReceiptsByScenario, scenarioManifestSha });
const onlineAmtResult = await runOnlineAmtCalibration({ scenarios, baseScenarios, counterfactualReceiptsByScenario, scenarioManifestSha });
const prematureLockInvalidation = await writePrematureLockInvalidationReceipt();
const byteDanceSameWeightProvenance = await writeByteDanceSameWeightProvenance();

const registry = {
  schemaVersion: 1,
  artifact: 'phase9g_a23_final_incumbent_registry',
  phase: '9G-A.2.3',
  policy,
  scenarioManifestSha256: scenarioManifestSha,
  profiles: [...byteDanceResult.profileRegistry, ...onlineAmtResult.profileRegistry],
};
await writeJson(PROFILE_REGISTRY_REL, registry);

const report = {
  schemaVersion: 1,
  artifact: 'phase9g_a23_bytedance_online_amt_incumbent_completion',
  phase: '9G-A.2.3',
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
  byteDanceFutureOverrunDiagnostic: {
    path: BYTEDANCE_FUTURE_OVERRUN_REL,
    sha256: await sha256File(BYTEDANCE_FUTURE_OVERRUN_REL),
    correctedMaximumExcessFutureMs: byteDanceFutureOverrunDiagnostic.correctedMaximumExcessFutureMs,
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
  phase9gA21HistoricalComparison: {
    path: A21_REPORT_REL,
    sha256: a21ReportSha,
    preservedAsPartialEvidence: Boolean(a21Report),
  },
  phase9gA22InvalidatedComparison: {
    path: A22_REPORT_REL,
    sha256: a22ReportSha,
    preservedAsHistoricalEvidence: Boolean(a22Report),
    gate1SurvivorCountsByContext: a22Report ? byteDanceSurvivorCountsByContext(a22Report.byteDance?.selectorTrace?.remainingProfileIds ?? []) : null,
  },
  prematureLockInvalidationReceiptPath: CORRECTION_RECEIPT_REL,
  prematureLockInvalidation,
  byteDanceSameWeightProvenanceReceiptPath: BYTEDANCE_PROVENANCE_REL,
  byteDanceSameWeightProvenance,
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
  const parityReceipt = existsSync(path.resolve(repoRoot, BYTEDANCE_PARITY_REL))
    ? JSON.parse(await readFile(path.resolve(repoRoot, BYTEDANCE_PARITY_REL), 'utf8'))
    : null;
  const parityVerified = parityReceipt?.overallThresholdMaskParityAtOnset020Frame020 === true
    && parityReceipt?.overallAuthoritativeDecodedEventParityAtOnset020Frame020 === true
    && parityReceipt?.checkpointSha256 === EXPECTED_BYTEDANCE_CHECKPOINT.sha256
    && parityReceipt?.onnxSha256 === EXPECTED_BYTEDANCE_ONNX.sha256;
  const contexts = calibration.BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES;
  const contextEligibility = computeByteDanceContextEligibility(input.baseScenarios, contexts);
  const commonBaseScenarios = input.baseScenarios.filter((scenario) =>
    contextEligibility.byScenario[scenario.scenarioId]?.eligibleAllContexts
  );
  const commonScenarioIds = new Set([
    ...commonBaseScenarios.map((scenario) => scenario.scenarioId),
    ...input.scenarios
      .filter((scenario) => commonBaseScenarios.some((base) =>
        input.counterfactualReceiptsByScenario.get(scenario.scenarioId)?.baseScenarioId === base.scenarioId
      ))
      .map((scenario) => scenario.scenarioId),
  ]);
  const scoredScenarios = input.scenarios.filter((scenario) => commonScenarioIds.has(scenario.scenarioId));
  const coverage = familyCounts(scoredScenarios);
  const minimumCoveragePass = ['BASE_ORIGINAL', 'COUNTERFACTUAL_MISSING_NOTE', 'COUNTERFACTUAL_WRONG_SEMITONE', 'COUNTERFACTUAL_INCOMPLETE_CHORD']
    .every((family) => (coverage[family] ?? 0) >= 8);
  const rawBatchResult = parityVerified && minimumCoveragePass
    ? await runByteDancePyTorchBatches({ contexts, baseScenarios: commonBaseScenarios, contextEligibility })
    : { byContext: new Map(), evidenceManifest: null };
  const rawBatches = rawBatchResult.byContext;
  const profiles = [];
  const candidateDefinitions = [];
  const runs = [];
  const failures = [];
  if (parityVerified && minimumCoveragePass) {
    for (const context of contexts) {
      for (const onsetThreshold of calibration.BYTEDANCE_PHASE_9GA_THRESHOLD_GRID.onset) {
        for (const frameThreshold of calibration.BYTEDANCE_PHASE_9GA_THRESHOLD_GRID.frame) {
          const profile = bytedanceProfile({ context, onsetThreshold, frameThreshold });
          profiles.push(profile);
          candidateDefinitions.push(candidateDefinition({
            candidateId: profile.profileId,
            strategyKind: 'CHUNKED',
            runtime: 'ByteDance original PyTorch CPU variable-context calibration',
            checkpointSha: EXPECTED_BYTEDANCE_CHECKPOINT.sha256,
            adapterVersion: 'phase9g-a23-variable-context-threshold-calibration-v1',
            configurationSha256: profile.configurationSha256,
          }));
          for (const scenario of scoredScenarios) {
            try {
              const baseScenarioId = input.counterfactualReceiptsByScenario.get(scenario.scenarioId)?.baseScenarioId ?? scenario.scenarioId;
              const raw = rawBatches.get(context.profileId)?.get(baseScenarioId);
              if (!raw) throw new Error(`Missing ByteDance raw batch for ${context.profileId} ${baseScenarioId}`);
              runs.push(runByteDanceFromRaw({ scenario, raw, profile, context }));
            } catch (error) {
              failures.push({ profileId: profile.profileId, scenarioId: scenario.scenarioId, error: errorMessage(error) });
            }
          }
        }
      }
    }
  }
  const diagnostic = publicContract.buildPublicDiagnosticBakeoffReport({
    scenarios: scoredScenarios,
    candidates: candidateDefinitions,
    runs,
  });
  const scores = calibrationScoresFromSummaries(diagnostic.scores);
  const selection = scores.length > 0 ? calibration.selectCalibrationProfile(scores) : null;
  const gate2TieBreak = selection?.selectedProfileId ? null : byteDanceGate2TieBreak({
    selection,
    profiles,
    aggregateMetrics: diagnostic.aggregateMetrics ?? {},
  });
  const selectedProfileId = selection?.selectedProfileId ?? gate2TieBreak?.selectedProfileId ?? null;
  const locked = Boolean(selectedProfileId && parityVerified && minimumCoveragePass && failures.length === 0);
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? null;
  return {
    profileRegistry: locked ? profiles.map((profile) => ({
      candidateFamily: 'bytedance-original',
      profileId: profile.profileId,
      selectedCandidateId: profile.profileId === selectedProfileId ? 'bytedance-original-calibrated-v1' : profile.profileId,
      configurationSha256: profile.configurationSha256,
      qualificationStatus: profile.profileId === selectedProfileId ? 'CALIBRATED_AND_LOCKED' : 'REJECTED_OR_NOT_SELECTED',
      LOCKED_FOR_PHASE_9G_B: profile.profileId === selectedProfileId,
      selectionStatus: profile.profileId === selectedProfileId ? 'SELECTED' : 'REJECTED_OR_NOT_SELECTED',
    })) : [{
      candidateFamily: 'bytedance-original',
      profileId: 'bytedance-original-current-executable-representative-v1',
      sourceHistoricalProfileId: historicalByteDanceProfileIdFor1820(),
      configurationSha256: null,
      qualificationStatus: parityVerified && !minimumCoveragePass ? 'INSUFFICIENT_COMMON_CALIBRATION_COVERAGE' : 'PARITY_UNRESOLVED',
      LOCKED_FOR_PHASE_9G_B: false,
      selectionStatus: 'PROVISIONAL_CONTEXT_OPTIMUM_UNRESOLVED',
    }],
    report: {
      sameWeightParityStatus: parityVerified
        ? 'SAME_WEIGHT_1820_PYTORCH_ONNX_PARITY_VERIFIED'
        : 'LOCAL_ASSETS_VERIFIED_PYTORCH_ONNX_PARITY_EXECUTION_PENDING',
      parityReceiptPath: BYTEDANCE_PARITY_REL,
      parityReceiptSha256: parityReceipt ? await sha256File(BYTEDANCE_PARITY_REL) : null,
      paritySummary: parityReceipt ? {
        fixtureCount: parityReceipt.fixtureCount,
        maxRegOnsetAbsDelta: parityReceipt.maxRegOnsetAbsDelta,
        maxFrameAbsDelta: parityReceipt.maxFrameAbsDelta,
        overallThresholdMaskParityAtOnset020Frame020: parityReceipt.overallThresholdMaskParityAtOnset020Frame020,
        overallAuthoritativeDecodedEventParityAtOnset020Frame020: parityReceipt.overallAuthoritativeDecodedEventParityAtOnset020Frame020,
      } : null,
      contexts: contexts.map((context) => ({
        ...context,
        status: parityVerified && minimumCoveragePass ? 'EXECUTED_PYTORCH_VARIABLE_CONTEXT' : 'NOT_EXECUTED',
        eligibleBaseScenarioCount: contextEligibility.byContext[context.profileId]?.eligibleBaseScenarioCount ?? 0,
      })),
      commonCalibrationScenarioCounts: {
        totalCalibrationScenarios: input.scenarios.length,
        commonBaseScenarioCount: commonBaseScenarios.length,
        commonScenarioCount: scoredScenarios.length,
        familyCounts: coverage,
        status: minimumCoveragePass ? 'PASS' : 'INSUFFICIENT_COMMON_CALIBRATION_COVERAGE',
      },
      rawNeuralInferenceExecutedCount: [...rawBatches.values()].reduce((sum, byScenario) =>
        sum + [...byScenario.values()].reduce((inner, raw) => inner + raw.chunks.length, 0), 0),
      validatedRawArtifactReadbackCount: rawBatchResult.evidenceManifest?.rows?.length ?? 0,
      validatedRawCacheLoadCount: 0,
      rawCacheMemoryHitCount: 0,
      uniqueInferenceWindowCount: rawBatchResult.evidenceManifest?.rows?.length ?? 0,
      thresholdDecodeCount: runs.length,
      thresholdScenarioDecodeCount: runs.length,
      rawChunkDecodeCount: runs.reduce((sum, run) => sum + run.publications.length, 0),
      counterfactualRawReuseCount: scoredScenarios.filter((scenario) =>
        input.counterfactualReceiptsByScenario.has(scenario.scenarioId)
      ).length * profiles.length,
      rawEvidenceManifestPath: BYTEDANCE_RAW_EVIDENCE_REL,
      rawEvidenceManifestSha256: existsSync(path.resolve(repoRoot, BYTEDANCE_RAW_EVIDENCE_REL))
        ? await sha256File(BYTEDANCE_RAW_EVIDENCE_REL)
        : null,
      thresholdProfileCount: profiles.length,
      blockedContextCount: parityVerified && minimumCoveragePass ? 0 : contexts.length,
      metrics: compactAggregateMetrics(diagnostic.aggregateMetrics),
      selectorTrace: selection,
      gate1SurvivorCountsByContext: selection ? byteDanceSurvivorCountsByContext(selection.remainingProfileIds ?? []) : null,
      gate2TieBreak,
      selectedProfileId,
      selectedContext: selectedProfile?.projection.context.profileId ?? null,
      selectedThresholdPair: selectedProfile?.thresholds ?? null,
      selectedConfigurationSha256: selectedProfile?.configurationSha256 ?? null,
      lockedForPhase9gB: locked,
      earlier1820Onset015Frame015Reproduced: selectedProfileId?.includes('CALIBRATED_CONTEXT_1820-onset-0.15-frame-0.15') ?? false,
      contextQuestions: answerByteDanceContextQuestions({ profiles, selection, diagnostic, selectedProfileId }),
      failures,
    },
  };
}

async function ensureByteDanceParityReceipt() {
  const outputPath = path.resolve(repoRoot, BYTEDANCE_PARITY_REL);
  if (existsSync(outputPath)) return;
  const run = spawnSync('docker', [
    'run', '--rm',
    '--entrypoint', 'python',
    '-v', `${repoRoot}:/workspace`,
    '-w', '/workspace',
    'noteverse-bytedance-calibration:phase9ga21',
    'backend/scripts/verify_bytedance_checkpoint_onnx_parity.py',
    '--checkpoint', EXPECTED_BYTEDANCE_CHECKPOINT.path,
    '--onnx', EXPECTED_BYTEDANCE_ONNX.path,
    '--fixture-dir', 'backend/data/work/bytedance_browser_runtime_feasibility/golden_fixtures',
    '--output', BYTEDANCE_PARITY_REL,
    '--device', 'cpu',
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
  if (run.status !== 0) {
    throw new Error(`ByteDance checkpoint/ONNX parity failed: ${run.stderr || run.stdout}`);
  }
  const receipt = JSON.parse(await readFile(outputPath, 'utf8'));
  let authoritativePass = true;
  const comparisons = receipt.comparisons.map((item) => {
    const pytorchEvents = decodeParityEventsWithTypeScript(item.fixtureId, item.pytorchRawOutputs);
    const onnxEvents = decodeParityEventsWithTypeScript(item.fixtureId, item.onnxRawOutputs);
    const authoritativeDecodedEventParityAtOnset020Frame020 = canonicalJson(pytorchEvents) === canonicalJson(onnxEvents);
    authoritativePass = authoritativePass && authoritativeDecodedEventParityAtOnset020Frame020;
    const { pytorchRawOutputs: _pytorchRawOutputs, onnxRawOutputs: _onnxRawOutputs, ...compact } = item;
    return {
      ...compact,
      authoritativeDecodedEventParityAtOnset020Frame020,
      authoritativeDecodedEventSequenceSha256: sha256Json(pytorchEvents),
    };
  });
  await writeJson(BYTEDANCE_PARITY_REL, {
    ...receipt,
    artifact: 'phase9g_a23_bytedance_checkpoint_onnx_decoded_parity',
    phase: '9G-A.2.3',
    comparisons,
    overallAuthoritativeDecodedEventParityAtOnset020Frame020: authoritativePass,
  });
}

function decodeParityEventsWithTypeScript(fixtureId, rawOutputs) {
  const scenarioId = `phase9g-a23-parity:${fixtureId}`;
  const scenario = {
    scenarioId,
    schemaVersion: 1,
    split: 'DEVELOPMENT',
    familyTags: ['PARITY_FIXTURE'],
    source: { corpusId: 'phase9g-a23-parity', sourceAudioSha256: 'parity', sourceMidiSha256: 'parity' },
    audio: {
      sourceAudioSha256: 'parity',
      sourceSampleRateHz: 16000,
      channelCount: 1,
      sampleEncoding: 'PCM_FLOAT32',
      sourceDurationMs: 1820,
      performanceOriginSourceMs: 0,
      clipStartMs: 0,
      clipEndMs: 1820,
    },
    completion: { kind: 'NATURAL', performanceTimeMs: 1820 },
    expectedStrikes: [],
    physicalGroundTruth: { attacks: [] },
  };
  const plan = {
    chunkId: `${scenarioId}:chunk-0`,
    scenarioId,
    inputStartPerformanceMs: 0,
    inputEndPerformanceMs: 1820,
    commitStartPerformanceMs: 0,
    commitEndPerformanceMs: 600,
    expectedGroupIds: [],
  };
  const raw = byteDance.byteDanceRawOutputsFromBrowserChunkArtifact({
    chunkId: plan.chunkId,
    rawOutputs,
  }, { allowVariableFrameCount: true });
  return byteDance.decodeByteDanceChunkRawOutputs({
    scenario,
    plan,
    raw,
    onsetThreshold: 0.20,
    frameThreshold: 0.20,
    allowVariableFrameCount: true,
  }).map((event) => ({
    pitch: event.pitch,
    performanceTimeMs: event.performanceTimeMs,
    eventId: event.eventId,
  }));
}

async function runOnlineAmtCalibration(input) {
  const profiles = [];
  const candidateDefinitions = [];
  const runs = [];
  const timingReports = [];
  const failures = [];
  const timingSet = onlineAmtTimingCalibrationSet(input.baseScenarios);
  for (const policy of ONLINE_AMT_POLICIES) {
    const timingBatchArtifact = await runOnlineAmtBatch(policy, timingSet.includedScenarios, {
      phaseLabel: 'timing-500ms-real-postroll',
      fixedContextTailSamples: Math.ceil(TIMING_CALIBRATION_REAL_POSTROLL_MS / 1000 * onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz),
    });
    const correction = timingCorrectionForPolicy({ policy, batchArtifact: timingBatchArtifact, baseScenarios: timingSet.includedScenarios });
    const profile = onlineAmtProfile({ policy, timingCorrectionMs: correction.timingCorrectionMs });
    const finalBatchArtifact = await runOnlineAmtBatch(policy, input.baseScenarios, {
      phaseLabel: `final-correction-${correction.timingCorrectionMs.toFixed(6)}`,
      tailTimingCorrectionMs: correction.timingCorrectionMs,
    });
    const tailGeometry = onlineAmtTailGeometryDelta(input.baseScenarios, correction.timingCorrectionMs);
    timingReports.push({ ...correction, profileId: profile.profileId });
    profiles.push(profile);
    candidateDefinitions.push(candidateDefinition({
      candidateId: profile.profileId,
      strategyKind: 'STREAMING',
      runtime: 'Online-AMT modern compatibility Docker CPU',
      checkpointSha: onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.checkpointSha256,
      adapterVersion: 'phase9g-a23-online-amt-policy-calibration-v1',
      configurationSha256: profile.configurationSha256,
    }));
    for (const scenario of input.scenarios) {
      try {
        const baseScenarioId = input.counterfactualReceiptsByScenario.get(scenario.scenarioId)?.baseScenarioId ?? scenario.scenarioId;
        const segment = segmentForScenario(finalBatchArtifact, baseScenarioId);
        const candidateRun = onlineAmt.runOnlineAmtStreamingCandidateFromHopArtifact({
          scenario,
          artifact: { schemaVersion: 1, artifact: 'online_amt_real_hop_output', segments: [segment] },
          candidateId: profile.profileId,
          command: `docker run ${ONLINE_AMT_IMAGE} run_online_amt_modern_smoke.py --pseudo-intensity ${policy.pseudoIntensity} --onset-boost ${policy.onsetBoost}`,
          runtime: 'real-online-amt-modern-docker-phase9ga23-correction-aware',
          timingCorrectionMs: correction.timingCorrectionMs,
        });
        assertOnlineAmtTerminalCoverage({ scenario, candidateRun, profileId: profile.profileId });
        runs.push(candidateRun);
      } catch (error) {
        failures.push({ profileId: profile.profileId, scenarioId: scenario.scenarioId, error: errorMessage(error) });
      }
    }
    profile.tailGeometry = tailGeometry;
  }
  const diagnostic = publicContract.buildPublicDiagnosticBakeoffReport({
    scenarios: input.scenarios,
    candidates: candidateDefinitions,
    runs,
  });
  const scores = calibrationScoresFromSummaries(diagnostic.scores);
  const selection = calibration.selectCalibrationProfile(scores);
  const gate2TieBreak = selection.selectedProfileId ? null : onlineAmtGate2TieBreak({
    remainingProfileIds: selection.remainingProfileIds,
    profiles,
    aggregateMetrics: diagnostic.aggregateMetrics,
  });
  const selectedProfileId = selection.selectedProfileId ?? gate2TieBreak?.selectedProfileId ?? fallbackProfileId(profiles, 'online-amt-calibrated-v1');
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
        tailGeometry: profile.tailGeometry,
        metrics: compactAggregateMetrics(diagnostic.aggregateMetrics[profile.profileId]),
      })),
      selectorTrace: selection,
      gate2TieBreak,
      timingCalibrationSet: {
        fixedRealPostrollMs: TIMING_CALIBRATION_REAL_POSTROLL_MS,
        includedScenarioCount: timingSet.includedScenarios.length,
        includedScenarioIds: timingSet.includedScenarios.map((scenario) => scenario.scenarioId),
        excluded: timingSet.excluded,
        nearTerminalPhysicalAttackWithin180MsCount: timingSet.nearTerminal.length,
        nearTerminalPhysicalAttackDiagnostics: timingSet.nearTerminal,
      },
      phase9gA22Comparison: a22Report ? compareOnlineAmtA21({
        oldReport: a22Report,
        newPolicies: profiles,
        timingReports,
      }) : null,
      selectedProfileId,
      selectedPseudoPolicy: profiles.find((profile) => profile.profileId === selectedProfileId)?.policy.pseudoIntensity ?? null,
      selectedBoost: profiles.find((profile) => profile.profileId === selectedProfileId)?.policy.onsetBoost ?? null,
      selectedTimingCorrectionMs: profiles.find((profile) => profile.profileId === selectedProfileId)?.timingCorrectionMs ?? null,
      selectedConfigurationSha256: profiles.find((profile) => profile.profileId === selectedProfileId)?.configurationSha256 ?? null,
      failures,
    },
  };
}

function onlineAmtGate2TieBreak({ remainingProfileIds, profiles, aggregateMetrics }) {
  const remaining = profiles.filter((profile) => remainingProfileIds.includes(profile.profileId));
  if (remaining.length <= 1) return null;
  const withLatency = remaining.map((profile) => ({
    profile,
    p95: aggregateMetrics[profile.profileId]?.CALIBRATION?.finalizedFeedbackAgeP95Ms?.value,
  }));
  const finite = withLatency.filter((item) => Number.isFinite(item.p95));
  if (finite.length === remaining.length) {
    const sortedByLatency = [...finite].sort((left, right) => left.p95 - right.p95);
    if (sortedByLatency.at(-1).p95 - sortedByLatency[0].p95 >= 100) {
      return {
        selectedProfileId: sortedByLatency[0].profile.profileId,
        reason: 'GATE2_FINALIZED_FEEDBACK_AGE_P95_MS',
        finalizedFeedbackAgeP95Ms: sortedByLatency[0].p95,
      };
    }
  }
  const selected = [...remaining].sort((left, right) =>
    onlineAmtNativePreferenceRank(left) - onlineAmtNativePreferenceRank(right)
    || left.profileId.localeCompare(right.profileId)
  )[0];
  return {
    selectedProfileId: selected.profileId,
    reason: 'GATE2_DETERMINISTIC_NATIVE_POLICY_TIE_BREAK',
    preferenceOrder: 'NATIVE pseudo-intensity before DISABLED; boost 2.0 before 1.0 only if pseudo policy remains tied',
  };
}

function onlineAmtNativePreferenceRank(profile) {
  const pseudoRank = profile.policy.pseudoIntensity === 'NATIVE' ? 0 : 1;
  const boostRank = profile.policy.onsetBoost === 2.0 ? 0 : 1;
  return pseudoRank * 10 + boostRank;
}

function byteDanceGate2TieBreak({ selection, profiles, aggregateMetrics }) {
  const remaining = (selection?.remainingProfileIds ?? [])
    .map((profileId) => profiles.find((profile) => profile.profileId === profileId))
    .filter(Boolean);
  if (remaining.length === 0) return null;
  const latencyRows = remaining.map((profile) => ({
    profile,
    finalizedFeedbackAgeP95Ms: aggregateMetrics[profile.profileId]?.CALIBRATION?.finalizedFeedbackAgeP95Ms?.value,
  }));
  const finiteLatencyRows = latencyRows.filter((row) => Number.isFinite(row.finalizedFeedbackAgeP95Ms));
  if (finiteLatencyRows.length === remaining.length) {
    const sortedByLatency = [...finiteLatencyRows].sort((left, right) =>
      left.finalizedFeedbackAgeP95Ms - right.finalizedFeedbackAgeP95Ms
      || left.profile.profileId.localeCompare(right.profile.profileId)
    );
    const spread = sortedByLatency.at(-1).finalizedFeedbackAgeP95Ms - sortedByLatency[0].finalizedFeedbackAgeP95Ms;
    if (spread >= 100) {
      return {
        selectedProfileId: sortedByLatency[0].profile.profileId,
        reason: 'GATE2_FINALIZED_FEEDBACK_AGE_P95_MS',
        latencyDiscriminated: true,
        latencySpreadMs: spread,
        selectedFinalizedFeedbackAgeP95Ms: sortedByLatency[0].finalizedFeedbackAgeP95Ms,
        remainingProfileIds: remaining.map((profile) => profile.profileId).sort(),
      };
    }
  }
  const selected = [...remaining].sort((left, right) =>
    left.projection.context.modelInputMs - right.projection.context.modelInputMs
    || left.thresholds.onsetThreshold - right.thresholds.onsetThreshold
    || left.thresholds.frameThreshold - right.thresholds.frameThreshold
    || left.profileId.localeCompare(right.profileId)
  )[0];
  return {
    selectedProfileId: selected.profileId,
    reason: 'GATE2_CONTEXT_SIZE_TIE_BREAK',
    latencyDiscriminated: false,
    latencyThresholdMs: 100,
    selectedModelInputMs: selected.projection.context.modelInputMs,
    selectedThresholds: selected.thresholds,
    remainingProfileIds: remaining.map((profile) => profile.profileId).sort(),
  };
}

function runByteDanceFromRaw({ scenario, raw, profile }) {
  const plans = raw.plansForScenario?.get?.(scenario.scenarioId) ?? planByteDanceVariableContext(scenario, profile.projection.context);
  const rawChunks = raw.chunks;
  const processingByChunk = new Map(plans.map((plan, index) => [plan.chunkId, rawChunks[index]?.inferenceLatencyMs ?? 0]));
  const schedule = byteDance.scheduleByteDanceSingleWorkerPublications({ plans, processingLatencyMsByChunkId: processingByChunk });
  const publications = plans.map((plan, index) => {
    const chunk = rawChunks[index];
    const decoded = byteDance.decodeByteDanceChunkRawOutputs({
      scenario,
      plan,
      raw: byteDance.byteDanceRawOutputsFromBrowserChunkArtifact(chunk, { allowVariableFrameCount: true }),
      onsetThreshold: profile.thresholds.onsetThreshold,
      frameThreshold: profile.thresholds.frameThreshold,
      allowVariableFrameCount: true,
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
    command: 'phase9ga23 decode validated fresh real ByteDance PyTorch raw outputs',
    runtime: 'real-pytorch-cpu-variable-context-phase9ga23',
  });
}

function computeByteDanceContextEligibility(baseScenarios, contexts) {
  const byScenario = {};
  const byContext = {};
  for (const context of contexts) {
    byContext[context.profileId] = { eligibleBaseScenarioCount: 0, ineligible: [] };
  }
  for (const scenario of baseScenarios) {
    const perContext = {};
    let eligibleAllContexts = true;
    for (const context of contexts) {
      try {
        const plans = planByteDanceVariableContext(scenario, context);
        validateByteDanceVariableContextSource(scenario, plans, context);
        perContext[context.profileId] = { eligible: true, planCount: plans.length };
        byContext[context.profileId].eligibleBaseScenarioCount += 1;
      } catch (error) {
        eligibleAllContexts = false;
        perContext[context.profileId] = { eligible: false, reason: errorMessage(error) };
        byContext[context.profileId].ineligible.push({ scenarioId: scenario.scenarioId, reason: errorMessage(error) });
      }
    }
    byScenario[scenario.scenarioId] = { eligibleAllContexts, perContext };
  }
  return { byScenario, byContext };
}

async function runByteDancePyTorchBatches({ contexts, baseScenarios }) {
  const result = new Map();
  const evidenceRows = [];
  for (const context of contexts) {
    const windows = [];
    const planByScenario = new Map();
    for (const scenario of baseScenarios) {
      const plans = planByteDanceVariableContext(scenario, context);
      planByScenario.set(scenario.scenarioId, plans);
      for (const plan of plans) {
        const inputStartSourceMs = scenario.audio.performanceOriginSourceMs + plan.inputStartPerformanceMs;
        const inputEndSourceMs = scenario.audio.performanceOriginSourceMs + plan.inputEndPerformanceMs;
        const identity = {
          schemaVersion: 1,
          candidateFamily: 'bytedance-original',
          checkpointSha256: EXPECTED_BYTEDANCE_CHECKPOINT.sha256,
          checkpointBytes: EXPECTED_BYTEDANCE_CHECKPOINT.bytes,
          runtimeIdentity: BYTEDANCE_IMAGE,
          contextProfileId: context.profileId,
          sourceAudioSha256: scenario.source.sourceAudioSha256,
          sourceAudioPath: scenario.source.sourceAudioPath,
          inputStartSourceMs,
          inputEndSourceMs,
          inputSampleRateHz: 16000,
          inputSampleCount: Math.round(context.modelInputMs / 1000 * 16000),
          windowGeometrySha256: sha256Json({
            contextProfileId: context.profileId,
            inputStartPerformanceMs: plan.inputStartPerformanceMs,
            inputEndPerformanceMs: plan.inputEndPerformanceMs,
            commitStartPerformanceMs: plan.commitStartPerformanceMs,
            commitEndPerformanceMs: plan.commitEndPerformanceMs,
          }),
          preprocessingIdentity: 'deterministic_linear_interpolation_v1_mono_float32',
        };
        windows.push({
          scenarioId: scenario.scenarioId,
          contextProfileId: context.profileId,
          windowId: plan.chunkId,
          sourceAudioPath: scenario.source.sourceAudioPath,
          inputStartSourceMs,
          inputEndSourceMs,
          inputSampleCount: identity.inputSampleCount,
          identity,
        });
      }
    }
    const inputRel = `backend/data/work/public_proxy/vienna-4x22/phase9ga23/${context.profileId}.bytedance-pytorch-input.json`;
    const outputRel = `backend/data/work/public_proxy/vienna-4x22/phase9ga23/${context.profileId}.bytedance-pytorch-raw.json`;
    const validationRel = `backend/data/work/public_proxy/vienna-4x22/phase9ga23/${context.profileId}.bytedance-pytorch-readback.json`;
    await writeJson(inputRel, { windows });
    const run = spawnSync('docker', [
      'run', '--rm',
      '--entrypoint', 'python',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      BYTEDANCE_IMAGE,
      'backend/scripts/run_bytedance_pytorch_raw_batch.py',
      '--input', inputRel,
      '--output', outputRel,
      '--checkpoint', EXPECTED_BYTEDANCE_CHECKPOINT.path,
      '--device', 'cpu',
      '--runtime-identity', BYTEDANCE_IMAGE,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 20 * 1024 * 1024 });
    if (run.status !== 0) throw new Error(`ByteDance PyTorch batch failed for ${context.profileId}: ${run.stderr || run.stdout}`);
    const validationRun = spawnSync('docker', [
      'run', '--rm',
      '--entrypoint', 'python',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      BYTEDANCE_IMAGE,
      'backend/scripts/validate_bytedance_pytorch_raw_batch.py',
      '--input', inputRel,
      '--raw', outputRel,
      '--checkpoint', EXPECTED_BYTEDANCE_CHECKPOINT.path,
      '--output', validationRel,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
    if (validationRun.status !== 0) {
      throw new Error(`ByteDance PyTorch readback validation failed for ${context.profileId}: ${validationRun.stderr || validationRun.stdout}`);
    }
    const validation = JSON.parse(await readFile(path.resolve(repoRoot, validationRel), 'utf8'));
    evidenceRows.push(...validation.rows);
    const raw = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));
    const byScenario = new Map();
    for (const scenario of baseScenarios) {
      const chunks = raw.chunks
        .filter((chunk) => chunk.scenarioId === scenario.scenarioId)
        .sort((left, right) => left.windowId.localeCompare(right.windowId));
      byScenario.set(scenario.scenarioId, {
        chunks,
        plansForScenario: new Map([[scenario.scenarioId, planByScenario.get(scenario.scenarioId)]]),
      });
    }
    result.set(context.profileId, byScenario);
  }
  const evidenceManifest = {
    schemaVersion: 1,
    artifact: 'phase9g_a23_bytedance_raw_evidence_manifest',
    phase: '9G-A.2.3',
    checkpointSha256: EXPECTED_BYTEDANCE_CHECKPOINT.sha256,
    checkpointBytes: EXPECTED_BYTEDANCE_CHECKPOINT.bytes,
    rowCount: evidenceRows.length,
    rows: evidenceRows,
  };
  await writeJson(BYTEDANCE_RAW_EVIDENCE_REL, evidenceManifest);
  return { byContext: result, evidenceManifest };
}

function planByteDanceVariableContext(scenario, context) {
  if (context.profileId === 'CALIBRATED_CONTEXT_1820') {
    return byteDance.planByteDanceScoreAwareChunks(scenario);
  }
  const completion = scenario.completion.performanceTimeMs;
  const plans = [];
  let start = 0;
  const ownedMs = context.ownedCentralRegionMs;
  while (start < completion || (completion === 0 && plans.length === 0)) {
    const end = Math.min(completion, start + ownedMs);
    plans.push({
      chunkId: `${scenario.scenarioId}:${context.profileId}:window-${plans.length.toString().padStart(3, '0')}`,
      scenarioId: scenario.scenarioId,
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputStartPerformanceMs: end + context.futureContextMs - context.modelInputMs,
      inputEndPerformanceMs: end + context.futureContextMs,
      expectedGroupIds: expectedGroupIdsInRange(scenario, start, end, plans.length === 0),
    });
    if (end === completion) break;
    start = end;
  }
  validateByteDanceVariableContextPlan(scenario, plans, context);
  return plans;
}

function validateByteDanceVariableContextPlan(scenario, plans, context) {
  let previousEnd = 0;
  for (const plan of plans) {
    if (Math.abs((plan.inputEndPerformanceMs - plan.inputStartPerformanceMs) - context.modelInputMs) > 1e-9) {
      throw new Error(`ByteDance ${context.profileId} input duration mismatch.`);
    }
    if (context.profileId !== 'CALIBRATED_CONTEXT_1820'
      && Math.abs((plan.inputEndPerformanceMs - plan.commitEndPerformanceMs) - context.futureContextMs) > 1e-9) {
      throw new Error(`ByteDance ${context.profileId} future context exceeds frozen bound.`);
    }
    if (plan.commitStartPerformanceMs !== previousEnd || plan.commitEndPerformanceMs < plan.commitStartPerformanceMs) {
      throw new Error(`ByteDance ${context.profileId} commit ownership is not chronological/non-overlapping.`);
    }
    if (plan.inputStartPerformanceMs > plan.commitStartPerformanceMs || plan.inputEndPerformanceMs < plan.commitEndPerformanceMs) {
      throw new Error(`ByteDance ${context.profileId} input does not contain owned interval.`);
    }
    previousEnd = plan.commitEndPerformanceMs;
  }
  if (Math.abs(previousEnd - scenario.completion.performanceTimeMs) > 1e-9) {
    throw new Error(`ByteDance ${context.profileId} plan does not cover completion.`);
  }
}

function validateByteDanceVariableContextSource(scenario, plans) {
  for (const plan of plans) {
    const sourceStart = scenario.audio.performanceOriginSourceMs + plan.inputStartPerformanceMs;
    const sourceEnd = scenario.audio.performanceOriginSourceMs + plan.inputEndPerformanceMs;
    if (sourceStart < scenario.audio.clipStartMs - 1e-9) throw new Error(`requires unavailable pre-roll context`);
    if (sourceEnd > scenario.audio.clipEndMs + 1e-9) throw new Error(`requires unavailable post-roll context`);
  }
}

async function writeByteDanceFutureOverrunDiagnostic(baseScenariosForDiagnostic) {
  const contexts = calibration.BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES
    .filter((context) => context.profileId !== 'CALIBRATED_CONTEXT_1820');
  const oldByContext = {};
  const correctedByContext = {};
  for (const context of contexts) {
    const oldExcess = [];
    const correctedExcess = [];
    for (const scenario of baseScenariosForDiagnostic) {
      for (const plan of oldByteDanceVariableContextPlan(scenario, context)) {
        const excess = (plan.inputEndPerformanceMs - plan.commitEndPerformanceMs) - context.futureContextMs;
        if (excess > 1e-9) oldExcess.push({ scenarioId: scenario.scenarioId, windowId: plan.chunkId, excessFutureMs: excess });
      }
      for (const plan of planByteDanceVariableContext(scenario, context)) {
        const excess = Math.max(0, (plan.inputEndPerformanceMs - plan.commitEndPerformanceMs) - context.futureContextMs);
        correctedExcess.push({ scenarioId: scenario.scenarioId, windowId: plan.chunkId, excessFutureMs: excess });
      }
    }
    oldByContext[context.profileId] = summarizeFutureExcess(oldExcess);
    correctedByContext[context.profileId] = summarizeFutureExcess(correctedExcess.filter((item) => item.excessFutureMs > 1e-9));
  }
  const receipt = {
    schemaVersion: 1,
    artifact: 'phase9g_a23_bytedance_future_overrun_diagnostic',
    phase: '9G-A.2.3',
    oldPhase9gA22Geometry: oldByContext,
    correctedPhase9gA23Geometry: correctedByContext,
    correctedMaximumExcessFutureMs: Math.max(0, ...Object.values(correctedByContext).map((item) => item.maximumExcessFutureMs ?? 0)),
    numericToleranceMs: 1e-9,
  };
  await writeJson(BYTEDANCE_FUTURE_OVERRUN_REL, receipt);
  return receipt;
}

function oldByteDanceVariableContextPlan(scenario, context) {
  const completion = scenario.completion.performanceTimeMs;
  const plans = [];
  let start = 0;
  const ownedMs = context.ownedCentralRegionMs;
  while (start < completion || (completion === 0 && plans.length === 0)) {
    const end = Math.min(completion, start + ownedMs);
    plans.push({
      chunkId: `${scenario.scenarioId}:${context.profileId}:old-window-${plans.length.toString().padStart(3, '0')}`,
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputStartPerformanceMs: start - context.pastContextMs,
      inputEndPerformanceMs: start - context.pastContextMs + context.modelInputMs,
    });
    if (end === completion) break;
    start = end;
  }
  return plans;
}

function summarizeFutureExcess(items) {
  const values = items.map((item) => item.excessFutureMs).sort((left, right) => left - right);
  return {
    overrunWindowCount: items.length,
    minimumExcessFutureMs: values.length ? values[0] : 0,
    medianExcessFutureMs: median(values) ?? 0,
    p95ExcessFutureMs: percentile(values, 0.95) ?? 0,
    maximumExcessFutureMs: values.length ? values.at(-1) : 0,
    worstScenarioIds: [...items]
      .sort((left, right) => right.excessFutureMs - left.excessFutureMs || left.scenarioId.localeCompare(right.scenarioId))
      .slice(0, 10)
      .map((item) => item.scenarioId),
  };
}

function byteDanceSurvivorCountsByContext(profileIds) {
  const counts = {
    CALIBRATED_CONTEXT_1820: 0,
    CALIBRATED_CONTEXT_3S: 0,
    CALIBRATED_CONTEXT_5S: 0,
    CALIBRATED_CONTEXT_10S: 0,
  };
  for (const profileId of profileIds) {
    for (const contextId of Object.keys(counts)) {
      if (profileId.includes(contextId)) counts[contextId] += 1;
    }
  }
  return counts;
}

function expectedGroupIdsInRange(scenario, start, end, isFirst) {
  const seen = new Set();
  return scenario.expectedStrikes
    .filter((strike) => {
      if (seen.has(strike.groupId)) return false;
      const owned = isFirst
        ? strike.expectedPerformanceTimeMs >= start && strike.expectedPerformanceTimeMs <= end
        : strike.expectedPerformanceTimeMs > start && strike.expectedPerformanceTimeMs <= end;
      if (owned) seen.add(strike.groupId);
      return owned;
    })
    .map((strike) => strike.groupId);
}

async function loadByteDanceRaw(scenarioId, cache) {
  if (cache.has(scenarioId)) return cache.get(scenarioId);
  const rawPath = path.resolve(repoRoot, `backend/data/work/public_proxy/vienna-4x22/runs/${sanitizeFile(scenarioId)}.bytedance.raw.json`);
  if (!existsSync(rawPath)) throw new Error(`Missing cached real ByteDance raw output: ${rawPath}`);
  const raw = JSON.parse(await readFile(rawPath, 'utf8'));
  cache.set(scenarioId, raw);
  return raw;
}

async function runOnlineAmtBatch(policy, baseScenarios, options) {
  const segments = [];
  for (const scenario of baseScenarios) {
    const wav = byteDance.decodeResearchWavToMonoFloat32(await readFile(path.resolve(repoRoot, scenario.source.sourceAudioPath)));
    const completion = scenario.completion.performanceTimeMs;
    const ownedSamples = Math.floor(completion / 1000 * onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz);
    const requirement = options.fixedContextTailSamples === undefined
      ? onlineAmt.onlineAmtSegmentTailRequirement(ownedSamples, options.tailTimingCorrectionMs)
      : { requiredContextTailSamples: options.fixedContextTailSamples };
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
  const safe = `${policy.profileId.toLowerCase()}-${sanitizeFile(options.phaseLabel)}`;
  const inputRel = `backend/data/work/public_proxy/vienna-4x22/phase9ga23/${safe}.segments.json`;
  const outputRel = `backend/data/work/public_proxy/vienna-4x22/phase9ga23/${safe}.hop-artifact.json`;
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
  const allPairs = [];
  const truthDiagnostics = [];
  let rawTimingObservationCount = 0;
  let totalExtendedPhysicalAttacks = 0;
  let totalScopePhysicalAttacks = 0;
  let totalPostScopePhysicalAttacks = 0;
  for (const scenario of baseScenarios) {
    const segment = segmentForScenario(batchArtifact, scenario.scenarioId);
    const completion = scenario.completion.performanceTimeMs;
    const candidate = timingCalibrationObservationsForSegment({ scenario, segment });
    const physical = extendedPhysicalMidiTruthForScenario(scenario);
    const pairs = matchTimingPairs(candidate, physical);
    rawTimingObservationCount += candidate.length;
    totalExtendedPhysicalAttacks += physical.length;
    totalScopePhysicalAttacks += physical.filter((attack) => attack.performanceTimeMs <= completion + 1e-9).length;
    totalPostScopePhysicalAttacks += physical.filter((attack) => attack.performanceTimeMs > completion + 1e-9).length;
    allPairs.push(...pairs.map((pair) => ({ ...pair, scenarioId: scenario.scenarioId, completionTimeMs: completion })));
    truthDiagnostics.push({
      scenarioId: scenario.scenarioId,
      extendedPhysicalAttackCount: physical.length,
      scopePhysicalAttackCount: physical.filter((attack) => attack.performanceTimeMs <= completion + 1e-9).length,
      postScopePhysicalAttackCount: physical.filter((attack) => attack.performanceTimeMs > completion + 1e-9).length,
      rawTimingObservationCount: candidate.length,
      matchedPairCount: pairs.length,
      matchedInScopePairCount: pairs.filter((pair) => pair.physicalTimeMs <= completion + 1e-9).length,
      matchedPostScopePairCount: pairs.filter((pair) => pair.physicalTimeMs > completion + 1e-9).length,
      inScopePairsWithRawDecisionAfterCompletion: pairs.filter((pair) =>
        pair.physicalTimeMs <= completion + 1e-9 && pair.rawDecisionTimeMs > completion + 1e-9
      ).length,
    });
  }
  const correctionPairs = allPairs.filter((pair) => pair.physicalTimeMs <= pair.completionTimeMs + 1e-9);
  const offsets = correctionPairs.map((pair) => pair.physicalTimeMs - pair.rawDecisionTimeMs);
  offsets.sort((left, right) => left - right);
  const timingCorrectionMs = median(offsets);
  const residuals = offsets.map((offset) => offset - timingCorrectionMs).sort((left, right) => left - right);
  return {
    profileId: policy.profileId,
    policy,
    totalExtendedPhysicalAttacks,
    scopePhysicalAttacks: totalScopePhysicalAttacks,
    postScopePhysicalAttacks: totalPostScopePhysicalAttacks,
    rawTimingObservationCount,
    matchedPairCount: allPairs.length,
    matchedInScopePairCount: correctionPairs.length,
    matchedPostScopePairCount: allPairs.length - correctionPairs.length,
    correctionPairsWithRawDecisionAfterCompletion: correctionPairs.filter((pair) =>
      pair.rawDecisionTimeMs > pair.completionTimeMs + 1e-9
    ).length,
    timingTruthDiagnostics: truthDiagnostics,
    timingCorrectionMs,
    signedResidualP05Ms: percentile(residuals, 0.05),
    signedResidualP50Ms: percentile(residuals, 0.50),
    signedResidualP95Ms: percentile(residuals, 0.95),
    absoluteResidualP50Ms: percentile(residuals.map(Math.abs).sort((left, right) => left - right), 0.50),
    absoluteResidualP95Ms: percentile(residuals.map(Math.abs).sort((left, right) => left - right), 0.95),
  };
}

function timingCalibrationObservationsForSegment({ scenario, segment }) {
  return segment.hops.flatMap((hop) => {
    const rawDecisionTimeMs = hop.localDecisionSample / onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz * 1000;
    return hop.pitchStates
      .filter((state) => onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.onsetStateIds.includes(state.chosenState))
      .map((state, ordinal) => ({
        observationId: [
          'oamt-calibration',
          sanitizeFile(scenario.scenarioId),
          sanitizeFile(segment.segmentId),
          hop.hopIndex,
          sanitizeFile(state.pitch),
          ordinal,
        ].join(':'),
        pitch: state.pitch,
        rawDecisionTimeMs,
        hopIndex: hop.hopIndex,
        segmentId: segment.segmentId,
        confidence: state.probabilities[3] + state.probabilities[4],
      }));
  });
}

function extendedPhysicalMidiTruthForScenario(scenario) {
  const midiPath = path.resolve(repoRoot, scenario.source.sourceMidiPath);
  const bytes = readFileSync(midiPath);
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== scenario.source.sourceMidiSha256) {
    throw new Error(`Online-AMT timing calibration MIDI SHA mismatch for ${scenario.scenarioId}.`);
  }
  const parsed = parseMidiNoteOns(bytes);
  const end = scenario.completion.performanceTimeMs + TIMING_CALIBRATION_REAL_POSTROLL_MS;
  return parsed.noteOns
    .map((note) => ({
      physicalEventId: `extended-midi:${note.trackIndex}:${note.eventIndex}`,
      pitch: midiToPitch(note.midi),
      midi: note.midi,
      velocity: note.velocity,
      performanceTimeMs: note.onsetMs - scenario.audio.performanceOriginSourceMs,
    }))
    .filter((attack) => attack.performanceTimeMs >= -1e-9 && attack.performanceTimeMs <= end + 1e-9)
    .sort((left, right) => left.performanceTimeMs - right.performanceTimeMs
      || left.midi - right.midi
      || left.physicalEventId.localeCompare(right.physicalEventId));
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

function matchTimingPairs(candidateObservations, physicalAttacks) {
  const pairs = [];
  const pitches = new Set([...candidateObservations.map((item) => item.pitch), ...physicalAttacks.map((item) => item.pitch)]);
  for (const pitch of pitches) {
    const candidate = candidateObservations
      .filter((item) => item.pitch === pitch)
      .sort((left, right) => left.rawDecisionTimeMs - right.rawDecisionTimeMs || left.observationId.localeCompare(right.observationId));
    const physical = physicalAttacks
      .filter((item) => item.pitch === pitch)
      .sort((left, right) => left.performanceTimeMs - right.performanceTimeMs || left.physicalEventId.localeCompare(right.physicalEventId));
    pairs.push(...matchPitchTimingPairs(candidate, physical));
  }
  return pairs.sort((left, right) => left.physicalTimeMs - right.physicalTimeMs
    || left.rawDecisionTimeMs - right.rawDecisionTimeMs
    || left.pitch.localeCompare(right.pitch));
}

function matchPitchTimingPairs(candidate, physical) {
  const memo = new Map();
  const solve = (i, j) => {
    const key = `${i}|${j}`;
    if (memo.has(key)) return memo.get(key);
    if (i >= candidate.length || j >= physical.length) return { count: 0, cost: 0, pairs: [] };
    const options = [solve(i + 1, j), solve(i, j + 1)];
    const diff = physical[j].performanceTimeMs - candidate[i].rawDecisionTimeMs;
    if (Math.abs(diff) <= 250) {
      const next = solve(i + 1, j + 1);
      options.push({
        count: next.count + 1,
        cost: next.cost + Math.abs(diff),
        pairs: [{
          pitch: candidate[i].pitch,
          rawDecisionTimeMs: candidate[i].rawDecisionTimeMs,
          physicalTimeMs: physical[j].performanceTimeMs,
          candidateObservationId: candidate[i].observationId,
          physicalEventId: physical[j].physicalEventId,
          signedOffsetMs: diff,
        }, ...next.pairs],
      });
    }
    const best = options.sort((a, b) => (b.count - a.count) || (a.cost - b.cost))[0];
    memo.set(key, best);
    return best;
  };
  return solve(0, 0).pairs;
}

function segmentForScenario(batchArtifact, scenarioId) {
  const segmentId = `${scenarioId}:segment-0`;
  const segment = batchArtifact.segments.find((item) => item.segmentId === segmentId);
  if (!segment) throw new Error(`Missing Online-AMT segment ${segmentId}`);
  return segment;
}

function onlineAmtTailGeometryDelta(baseScenarios, timingCorrectionMs) {
  const affected = [];
  const details = baseScenarios.map((scenario) => {
    const ownedSamples = Math.floor(
      scenario.completion.performanceTimeMs / 1000 * onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz,
    );
    const historical = onlineAmt.onlineAmtSegmentTailRequirement(ownedSamples, -158);
    const calibrated = onlineAmt.onlineAmtSegmentTailRequirement(ownedSamples, timingCorrectionMs);
    const additionalHopCount = Math.max(
      0,
      (calibrated.requiredProcessedSamples - historical.requiredProcessedSamples)
      / onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples,
    );
    const detail = {
      scenarioId: scenario.scenarioId,
      ownedSamples,
      historicalRequiredContextTailSamples: historical.requiredContextTailSamples,
      calibratedRequiredContextTailSamples: calibrated.requiredContextTailSamples,
      historicalRequiredProcessedSamples: historical.requiredProcessedSamples,
      calibratedRequiredProcessedSamples: calibrated.requiredProcessedSamples,
      additionalHopCount,
    };
    if (additionalHopCount > 0) affected.push(scenario.scenarioId);
    return detail;
  });
  return {
    historicalTimingCorrectionMs: -158,
    calibratedTimingCorrectionMs: timingCorrectionMs,
    additionalHopScenarioCount: affected.length,
    additionalHopScenarioIds: affected,
    details,
  };
}

function onlineAmtTimingCalibrationSet(baseScenarios) {
  const includedScenarios = [];
  const excluded = [];
  const nearTerminal = [];
  for (const scenario of baseScenarios) {
    const requiredSourceEnd = scenario.audio.performanceOriginSourceMs
      + scenario.completion.performanceTimeMs
      + TIMING_CALIBRATION_REAL_POSTROLL_MS;
    if (requiredSourceEnd > scenario.audio.clipEndMs + 1e-9) {
      excluded.push({
        scenarioId: scenario.scenarioId,
        reason: 'INSUFFICIENT_REAL_500MS_TIMING_POSTROLL',
        requiredSourceEndMs: requiredSourceEnd,
        clipEndMs: scenario.audio.clipEndMs,
      });
      continue;
    }
    includedScenarios.push(scenario);
    const lastAttack = Math.max(...scenario.physicalGroundTruth.attacks.map((attack) => attack.performanceTimeMs));
    const delta = scenario.completion.performanceTimeMs - lastAttack;
    if (delta <= 180) {
      nearTerminal.push({
        scenarioId: scenario.scenarioId,
        lastPhysicalAttackTimeMs: lastAttack,
        completionTimeMs: scenario.completion.performanceTimeMs,
        deltaToCompletionMs: delta,
      });
    }
  }
  return { includedScenarios, excluded, nearTerminal };
}

function compareOnlineAmtA21({ oldReport, newPolicies, timingReports }) {
  const oldByProfile = new Map((oldReport.onlineAmt?.policyResults ?? []).map((item) => [item.profileId, item]));
  return newPolicies.map((profile) => {
    const old = oldByProfile.get(profile.profileId);
    const timing = timingReports.find((item) => item.profileId === profile.profileId);
    return {
      profileId: profile.profileId,
      oldTimingCorrectionMs: old?.timingCalibration?.timingCorrectionMs ?? null,
      newTimingCorrectionMs: timing?.timingCorrectionMs ?? null,
      timingCorrectionDeltaMs: timing && old?.timingCalibration
        ? timing.timingCorrectionMs - old.timingCalibration.timingCorrectionMs
        : null,
      oldMatchedPairCount: old?.timingCalibration?.matchedPairCount ?? null,
      newMatchedPairCount: timing?.matchedInScopePairCount ?? null,
      newMatchedPairCountIncludingPostScopeGuards: timing?.matchedPairCount ?? null,
      matchedPairCountDelta: timing && old?.timingCalibration
        ? timing.matchedInScopePairCount - old.timingCalibration.matchedPairCount
        : null,
    };
  });
}

function assertOnlineAmtTerminalCoverage({ scenario, candidateRun, profileId }) {
  const completion = scenario.completion?.performanceTimeMs;
  if (!Number.isFinite(completion)) {
    throw new Error(`Online-AMT final coverage cannot validate missing completion for ${scenario.scenarioId}`);
  }
  const finalCoverage = candidateRun.publications.at(-1)?.analyzedThroughPerformanceMs;
  const sampleGridToleranceMs = 1000 / onlineAmt.ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz + 1e-6;
  if (!Number.isFinite(finalCoverage) || finalCoverage + sampleGridToleranceMs < completion) {
    throw new Error(
      `Online-AMT final coverage incomplete for ${profileId} ${scenario.scenarioId}: `
      + `coverage=${finalCoverage}, completion=${completion}`,
    );
  }
}

async function writePrematureLockInvalidationReceipt() {
  const receipt = {
    schemaVersion: 1,
    artifact: 'phase9g_a23_prior_lock_invalidation',
    phase: '9G-A.2.3',
    invalidatedArtifactsPreserved: [
      'backend/research/reports/phase9g_a22_bytedance_online_amt_incumbent_completion_2026-10-09.json',
      'backend/research/reports/phase9g_a22_final_incumbent_registry_2026-10-09.json',
    ],
    invalidations: [
      {
        candidateFamily: 'bytedance-original',
        candidateId: 'bytedance-original-calibrated-v1',
        configurationSha256: '741f59ef4538285a72c35d1c2e118c96a1a4bdf2665c335222cd4662572e3c9a',
        correctedStatus: 'INVALIDATED_VARIABLE_CONTEXT_FINAL_WINDOW_FUTURE_OVERRUN',
        reason: 'Phase 9G-A.2.2 variable-context final windows anchored inputStart to commitStart - pastContext, allowing partial final commits to exceed the frozen futureContextMs bound.',
      },
      {
        candidateFamily: 'online-amt',
        candidateId: 'online-amt-calibrated-v1',
        configurationSha256: '1f0f5718eca00a2305e1361937ec9207bc2c9bba06caef5739596fff59abfd8b',
        correctedStatus: 'INVALIDATED_TIMING_CALIBRATION_POSTROLL_OBSERVATIONS_FILTERED_AT_SCOPE_END',
        reason: 'Phase 9G-A.2.2 fed 500ms real post-roll, but timing calibration evidence was extracted through product observation semantics that filtered uncorrected event times after scope completion.',
      },
    ],
  };
  await writeJson(CORRECTION_RECEIPT_REL, receipt);
  return receipt;
}

async function writeByteDanceSameWeightProvenance() {
  const checkpoint = await measuredBinaryAsset(EXPECTED_BYTEDANCE_CHECKPOINT);
  const onnx = await measuredBinaryAsset(EXPECTED_BYTEDANCE_ONNX);
  const historicalEvidence = [];
  for (const rel of BYTEDANCE_HISTORICAL_PARITY_REPORTS) {
    const abs = path.resolve(repoRoot, rel);
    historicalEvidence.push({
      path: rel,
      exists: existsSync(abs),
      sha256: existsSync(abs) ? await sha256FileBytes(abs) : null,
    });
  }
  const parity = existsSync(path.resolve(repoRoot, BYTEDANCE_PARITY_REL))
    ? JSON.parse(await readFile(path.resolve(repoRoot, BYTEDANCE_PARITY_REL), 'utf8'))
    : null;
  const parityPassed = parity?.overallThresholdMaskParityAtOnset020Frame020 === true
    && parity?.overallAuthoritativeDecodedEventParityAtOnset020Frame020 === true;
  const receipt = {
    schemaVersion: 1,
    artifact: 'phase9g_a23_bytedance_same_weight_provenance',
    phase: '9G-A.2.3',
    originalPyTorchCheckpoint: checkpoint,
    currentFixedOnnxAsset: onnx,
    modelArchitectureImportIdentity: 'piano_transcription_inference.PianoTranscription note_model',
    fixedShapeOnnxExportIdentity: {
      outputNames: ['reg_onset_output', 'frame_output'],
      currentOnnxSha256: onnx.actualSha256,
      historicalExportReports: historicalEvidence,
    },
    parityReceiptPath: BYTEDANCE_PARITY_REL,
    parityReceiptSha256: parity ? await sha256File(BYTEDANCE_PARITY_REL) : null,
    sameWeightParityStatus: checkpoint.identityVerified && onnx.identityVerified && parityPassed
      ? 'SAME_WEIGHT_1820_PYTORCH_ONNX_PARITY_VERIFIED'
      : checkpoint.identityVerified && onnx.identityVerified
        ? 'LOCAL_ASSETS_VERIFIED_PARITY_EXECUTION_REQUIRED'
        : 'LOCAL_ASSET_IDENTITY_BLOCKED',
  };
  await writeJson(BYTEDANCE_PROVENANCE_REL, receipt);
  return receipt;
}

async function measuredBinaryAsset(expected) {
  const abs = path.resolve(repoRoot, expected.path);
  if (!existsSync(abs)) {
    return {
      path: expected.path,
      exists: false,
      expectedSha256: expected.sha256,
      actualSha256: null,
      expectedBytes: expected.bytes,
      actualBytes: null,
      identityVerified: false,
    };
  }
  const actualSha256 = await sha256FileBytes(abs);
  const actualBytes = statSync(abs).size;
  return {
    path: expected.path,
    exists: true,
    expectedSha256: expected.sha256,
    actualSha256,
    expectedBytes: expected.bytes,
    actualBytes,
    identityVerified: actualSha256 === expected.sha256 && actualBytes === expected.bytes,
  };
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
    checkpointSha256: EXPECTED_BYTEDANCE_CHECKPOINT.sha256,
    checkpointBytes: EXPECTED_BYTEDANCE_CHECKPOINT.bytes,
    context,
    onsetThreshold,
    frameThreshold,
    decoderVersion: 'phase9g-a23-bytedance-threshold-grid-v1',
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

function historicalByteDanceProfileIdFor1820() {
  return 'bytedance-original-calibration-CALIBRATED_CONTEXT_1820-onset-0.20-frame-0.20';
}

function familyCounts(scenariosForCounts) {
  const counts = {};
  for (const scenario of scenariosForCounts) {
    const family = scenarioFamily(scenario);
    counts[family] = (counts[family] ?? 0) + 1;
  }
  for (const family of [
    'BASE_ORIGINAL',
    'COUNTERFACTUAL_MISSING_NOTE',
    'COUNTERFACTUAL_EXTRA_NOTE',
    'COUNTERFACTUAL_WRONG_SEMITONE',
    'COUNTERFACTUAL_INCOMPLETE_CHORD',
  ]) {
    counts[family] ??= 0;
  }
  return counts;
}

function scenarioFamily(scenario) {
  return scenario.familyTags.find((tag) => tag === 'BASE_ORIGINAL' || tag.startsWith('COUNTERFACTUAL_')) ?? 'UNKNOWN';
}

function answerByteDanceContextQuestions({ profiles, selectedProfileId, diagnostic }) {
  const selected = selectedProfileId ?? null;
  const contextBest = {};
  for (const contextId of ['CALIBRATED_CONTEXT_1820', 'CALIBRATED_CONTEXT_3S', 'CALIBRATED_CONTEXT_5S', 'CALIBRATED_CONTEXT_10S']) {
    const profileIds = profiles.filter((profile) => profile.projection.context.profileId === contextId).map((profile) => profile.profileId);
    const scoreRows = diagnostic.scores.filter((score) => profileIds.includes(score.candidateId));
    contextBest[contextId] = {
      profileCount: profileIds.length,
      measuredScenarioScoreCount: scoreRows.length,
      selectedInFinalTrace: selected?.includes(contextId) ?? false,
    };
  }
  return {
    did3sImproveOver1820: selected?.includes('CALIBRATED_CONTEXT_3S') ?? false,
    did5sImproveOver1820: selected?.includes('CALIBRATED_CONTEXT_5S') ?? false,
    did10sImproveOver1820: selected?.includes('CALIBRATED_CONTEXT_10S') ?? false,
    didLongerContextReduceCriticalFalseCorrectErrors: 'See selectorTrace pairwise dominance decisions and per-context metrics.',
    didLongerContextHarmRecallOrChordCompleteness: 'See selectorTrace pairwise dominance decisions and per-context metrics.',
    survivingContext: profiles.find((profile) => profile.profileId === selected)?.projection.context.profileId ?? null,
    survivingThresholdPair: profiles.find((profile) => profile.profileId === selected)?.thresholds ?? null,
    earlier1820Onset015Frame015Reproduced: selected === 'bytedance-original-calibration-CALIBRATED_CONTEXT_1820-onset-0.15-frame-0.15',
    was1820ActuallyOptimal: selected?.includes('CALIBRATED_CONTEXT_1820') ?? false,
    contextBest,
  };
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

function resampleLinear({ sourcePcm, sourceSampleRateHz, sourceStartMs, sourceEndMs, sampleCount }) {
  const output = new Float32Array(sampleCount);
  const sourceStart = sourceStartMs / 1000 * sourceSampleRateHz;
  const sourceSpan = sourceEndMs === undefined
    ? sampleCount * sourceSampleRateHz / 16000
    : sourceEndMs / 1000 * sourceSampleRateHz - sourceStart;
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = sourceStart + index * sourceSpan / sampleCount;
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

function parseMidiNoteOns(bytes) {
  let offset = 0;
  if (ascii(bytes, offset, 4) !== 'MThd') throw new Error('MIDI file missing MThd header.');
  offset += 4;
  const headerLength = readU32(bytes, offset); offset += 4;
  const format = readU16(bytes, offset); offset += 2;
  const trackCount = readU16(bytes, offset); offset += 2;
  const division = readU16(bytes, offset); offset += 2;
  offset += headerLength - 6;
  if (division & 0x8000) throw new Error('SMPTE MIDI timing is not supported for Vienna proxy.');
  const noteOns = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (ascii(bytes, offset, 4) !== 'MTrk') throw new Error('MIDI file missing MTrk chunk.');
    offset += 4;
    const trackEnd = offset + 4 + readU32(bytes, offset);
    offset += 4;
    let timeMs = 0;
    let tempo = 500000;
    let firstTempo = null;
    let runningStatus = null;
    let eventIndex = 0;
    while (offset < trackEnd) {
      const delta = readVar(bytes, offset);
      offset = delta.offset;
      timeMs += delta.value * tempo / division / 1000;
      let status = bytes[offset++];
      if (status < 0x80) {
        if (runningStatus === null) throw new Error('MIDI running status without previous status.');
        offset -= 1;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      }
      if (status === 0xff) {
        const type = bytes[offset++];
        const length = readVar(bytes, offset);
        offset = length.offset;
        if (type === 0x51 && length.value === 3) {
          const nextTempo = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
          if (firstTempo === null) firstTempo = nextTempo;
          if (nextTempo !== firstTempo) throw new Error('Vienna MIDI tempo changes are not supported by the fixed-BPM proxy parser.');
          tempo = nextTempo;
        }
        offset += length.value;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const length = readVar(bytes, offset);
        offset = length.offset + length.value;
        continue;
      }
      const command = status & 0xf0;
      const data1 = bytes[offset++];
      const data2 = command === 0xc0 || command === 0xd0 ? 0 : bytes[offset++];
      if (command === 0x90 && data2 > 0) {
        noteOns.push({ trackIndex, eventIndex, midi: data1, velocity: data2, onsetMs: timeMs });
      }
      eventIndex += 1;
    }
    offset = trackEnd;
  }
  return { format, division, noteOns };
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readU16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readVar(bytes, offset) {
  let value = 0;
  let current = 0;
  do {
    current = bytes[offset++];
    value = (value << 7) | (current & 0x7f);
  } while (current & 0x80);
  return { value, offset };
}

function midiToPitch(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
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

async function sha256FileBytes(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
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
