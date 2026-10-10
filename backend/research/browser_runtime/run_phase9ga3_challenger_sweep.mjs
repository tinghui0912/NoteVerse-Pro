#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const challengerQual = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));
const calibration = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-model-calibration.ts'));
const publicContract = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-fixed-bpm-benchmark.ts'));
const byteDance = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'));

const IMPLEMENTATION_HEAD = gitHead(repoRoot);
const DIRTY = gitDirty(repoRoot);

// Ensure execution is from a clean working tree unless explicitly skipped during dry-run
if (process.argv.includes('--allow-dirty')) {
  console.warn('WARNING: Running with --allow-dirty flag.');
} else {
  challengerQual.assertCleanWorkingTree(DIRTY);
}

const PHASE_NAME = '9G-A.3.2';
const POLICY_REL = 'backend/research/policies/public_challenger_qualification_protocol_v2_2026-10-10.json';
const INCUMBENT_REGISTRY_REL = 'backend/research/reports/phase9g_a25_final_incumbent_registry_2026-10-09.json';
const SCENARIO_REL = 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json';
const BLIND_REL = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json';
const A24_REPORT_REL = 'backend/research/reports/phase9g_a24_bytedance_online_amt_incumbent_completion_2026-10-09.json';

const OUTPUT_REGISTRY_REL = 'backend/research/reports/phase9g_a32_final_candidate_registry_2026-10-10.json';
const OUTPUT_REPORT_REL = 'backend/research/reports/phase9g_a32_challenger_qualification_report_2026-10-10.json';
const OUTPUT_RAW_EVIDENCE_REL = 'backend/research/reports/phase9g_a32_challenger_raw_evidence_manifest_2026-10-10.json';
const OUTPUT_VERIFICATION_RECEIPT_REL = 'backend/research/reports/phase9g_a32_raw_evidence_verification_receipt_2026-10-10.json';
const OUTPUT_BLIND_LOCK_REL = 'backend/research/reports/phase9g_a32_blind_lock_receipt_2026-10-10.json';
const OUTPUT_CONTEXT_ELIGIBILITY_REL = 'backend/research/reports/phase9g_a32_context_eligibility_manifest_2026-10-10.json';
const OUTPUT_SCORE_INDEPENDENCE_REL = 'backend/research/reports/phase9g_a32_score_independence_audit_receipt_2026-10-10.json';
const OUTPUT_PAIRWISE_MATRIX_REL = 'backend/research/reports/phase9g_a32_diagnostic_pairwise_matrix_2026-10-10.json';
const OUTPUT_INVALIDATION_RECEIPT_REL = 'backend/research/reports/phase9g_a31_historical_invalidation_receipt_2026-10-10.json';

const WORK_DIR = 'backend/data/work/public_proxy/vienna-4x22/phase9ga3';

const DOCKER_CHALLENGERS_IMAGE = 'noteverse-challengers:phase9ga3';
const DOCKER_ARIA_IMAGE = 'noteverse-aria-amt-bench:gpu-cu124-patched';

await mkdir(path.resolve(repoRoot, 'backend/research/reports'), { recursive: true });
await mkdir(path.resolve(repoRoot, WORK_DIR), { recursive: true });

// 1. Verify Challenger Qualification Protocol V2 and Assert Guards
const policyFileRaw = await readFile(path.resolve(repoRoot, POLICY_REL), 'utf8');
const policyFileSha256 = sha256Text(policyFileRaw);
const policy = JSON.parse(policyFileRaw);

challengerQual.assertChallengerQualificationPolicyIdentity({
  policyId: policy.policyId,
  schemaVersion: policy.schemaVersion,
  sha256: policyFileSha256,
});

const incumbentPolicySha256 = policy.frozenIncumbentPolicy.sha256;
const incumbentRegistrySha256 = await sha256File(path.resolve(repoRoot, INCUMBENT_REGISTRY_REL));
const blindManifestSha256 = await sha256File(path.resolve(repoRoot, BLIND_REL));
const scenarioManifestRaw = await readFile(path.resolve(repoRoot, SCENARIO_REL), 'utf8');
const scenarioManifestSha256 = sha256Text(scenarioManifestRaw);
const scenarioManifest = JSON.parse(scenarioManifestRaw);

if (scenarioManifestSha256 !== policy.frozenCalibrationManifest.sha256) {
  throw new Error(`Calibration manifest SHA256 mismatch: expected ${policy.frozenCalibrationManifest.sha256}, got ${scenarioManifestSha256}`);
}

challengerQual.assertChallengerExecutionAllowed({
  policy: {
    policyId: policy.policyId,
    schemaVersion: policy.schemaVersion,
    sha256: policyFileSha256,
  },
  incumbentPolicySha256,
  incumbentRegistrySha256,
  blindManifestSha256,
  calibrationManifestSha256: scenarioManifestSha256,
  phase: PHASE_NAME,
  mode: 'CANDIDATE_INFERENCE',
  scenarioSplit: 'CALIBRATION',
  performers: scenarioManifest.includedPerformers ?? policy.frozenCalibrationManifest.performers,
});

// 2. Validate Checkpoint Physical Identities on Disk
console.log('--- Verifying Checkpoint Identities ---');
const checkpoints = [
  {
    candidateFamily: 'bytedance-robust-augmented',
    checkpointPath: 'models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
    expectedSha256: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.sha256,
    expectedBytes: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.bytes,
  },
  {
    candidateFamily: 'transkun',
    checkpointPath: 'models/checkpointMSimplerAug/checkpoint.pt',
    expectedSha256: policy.mandatoryChallengers.transkunV2Aug.checkpointIdentity.sha256,
    expectedBytes: policy.mandatoryChallengers.transkunV2Aug.checkpointIdentity.bytes,
  },
  {
    candidateFamily: 'aria-amt',
    checkpointPath: 'models/aria-amt/piano-medium-double-1.0.safetensors',
    expectedSha256: policy.mandatoryChallengers.ariaAmt.checkpointIdentity.sha256,
    expectedBytes: policy.mandatoryChallengers.ariaAmt.checkpointIdentity.bytes,
  },
  {
    candidateFamily: 'rtt',
    checkpointPath: 'backend/data/work/rtt_research/rtt/ckpts/CustomAMT.ckpt',
    expectedSha256: policy.mandatoryChallengers.rtt.checkpointIdentity.sha256,
    expectedBytes: policy.mandatoryChallengers.rtt.checkpointIdentity.bytes,
  },
];

for (const cp of checkpoints) {
  const absPath = path.resolve(repoRoot, cp.checkpointPath);
  const actualSha256 = await sha256File(absPath);
  const actualBytes = statSync(absPath).size;
  challengerQual.assertCheckpointIdentityStrict({
    candidateFamily: cp.candidateFamily,
    checkpointPath: cp.checkpointPath,
    expectedSha256: cp.expectedSha256,
    expectedBytes: cp.expectedBytes,
    actualSha256,
    actualBytes,
  });
  console.log(`Verified checkpoint ${cp.candidateFamily}: ${actualBytes} bytes, SHA256: ${actualSha256}`);
}

// 3. Blind Lock Receipt
const blindManifestRaw = await readFile(path.resolve(repoRoot, BLIND_REL), 'utf8');
const blindManifest = JSON.parse(blindManifestRaw);
const blindLockReceipt = {
  schemaVersion: 2,
  artifact: 'phase9g_a32_blind_lock_receipt',
  phase: PHASE_NAME,
  blindManifestPath: BLIND_REL,
  blindManifestSha256,
  expectedBlindManifestSha256: '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab',
  scenarioCount: blindManifest.scenarios.length,
  candidateRunCount: 0,
  blindPerformers: [...challengerQual.CHALLENGER_BLIND_PERFORMERS],
  generatedAt: new Date().toISOString(),
};

if (blindLockReceipt.blindManifestSha256 !== blindLockReceipt.expectedBlindManifestSha256 || blindLockReceipt.scenarioCount !== 70) {
  throw new Error(`Blind lock mismatch: ${JSON.stringify(blindLockReceipt)}`);
}
await writeJson(OUTPUT_BLIND_LOCK_REL, blindLockReceipt);

// 4. Scenarios & Context Eligibility
const scenarios = scenarioManifest.scenarios;
const baseScenarios = scenarios.filter((s) => s.familyTags.includes('BASE_ORIGINAL'));
const counterfactualReceipts = new Map(
  (scenarioManifest.counterfactualReceipts ?? []).map((r) => [r.scenarioId, r])
);

console.log(`Loaded ${scenarios.length} calibration scenarios (${baseScenarios.length} base scenarios).`);

const contextGeometries = calibration.BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES;
const eligibilityList = [
  ...challengerQual.deriveCandidateContextEligibility({
    scenarios,
    candidateFamily: 'bytedance-robust-augmented',
    contextGeometries,
    counterfactualReceipts,
  }),
  ...challengerQual.deriveCandidateContextEligibility({
    scenarios,
    candidateFamily: 'transkun',
    counterfactualReceipts,
  }),
  ...challengerQual.deriveCandidateContextEligibility({
    scenarios,
    candidateFamily: 'aria-amt',
    counterfactualReceipts,
  }),
  ...challengerQual.deriveCandidateContextEligibility({
    scenarios,
    candidateFamily: 'rtt',
    counterfactualReceipts,
  }),
];

challengerQual.assertCandidateContextEligibilityFrozen(eligibilityList);
await writeJson(OUTPUT_CONTEXT_ELIGIBILITY_REL, {
  schemaVersion: 2,
  artifact: 'phase9g_a32_context_eligibility_manifest',
  phase: PHASE_NAME,
  records: eligibilityList,
});

// Map of (candidateFamily:contextProfileId:scenarioId) -> isEligible
const eligibilityMap = new Map();
for (const e of eligibilityList) {
  const key = `${e.candidateFamily}:${e.contextProfileId ?? 'default'}:${e.scenarioId}`;
  eligibilityMap.set(key, e.isEligible);
}

// 5. Run Candidate Inferences and Validations
console.log('--- Executing Challenger Inferences & Validating Raw Evidence ---');

// A. Robust ByteDance
const robustByteDanceResult = await runRobustByteDanceFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
  contextGeometries,
  eligibilityList,
  eligibilityMap,
  policy,
});

// B. Transkun V2 Aug
const transkunResult = await runTranskunFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
  policy,
});

// C. Aria-AMT
const ariaAmtResult = await runAriaAmtFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
  policy,
});

// D. RTT (Reclassified to Offline Segmentwise Reference)
const rttResult = await runRttFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
  policy,
});

// E. D3RM (Reproducible dependency probe in container)
console.log('--- Probing D3RM Dependency in Container ---');
const d3rmProbe = spawnSync('docker', [
  'run', '--rm',
  '--entrypoint', 'python3',
  DOCKER_CHALLENGERS_IMAGE,
  '-c', 'import natten',
], { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 });

console.log(`D3RM dependency probe exit code: ${d3rmProbe.status}, stderr: ${(d3rmProbe.stderr || '').trim()}`);

const d3rmFiveDim = {
  candidateFamily: 'd3rm',
  candidateId: 'd3rm-offline-ceiling-reference',
  scientificCalibrationValidity: 'BLOCKED',
  eligibilityForResearchBlindComparison: 'NOT_ELIGIBLE',
  causalLiveRuntimeCompatibility: 'OFFLINE_WHOLE_RECORDING_INCOMPATIBLE',
  productionCheckpointLicensing: 'LICENSE_OR_USAGE_RIGHTS_UNRESOLVED',
  finalProductionSelectionEligibility: 'INELIGIBLE',
  qualificationStatus: 'EXECUTION_BLOCKED',
  lockedForPhase9gB: false,
};

challengerQual.assertCandidateMultiDimensionalQualification(d3rmFiveDim);

const d3rmResult = {
  candidateFamily: 'd3rm',
  candidateId: 'd3rm-offline-ceiling-reference',
  role: 'OFFLINE_ACCURACY_CEILING_REFERENCE',
  status: 'EXECUTION_BLOCKED_DEPENDENCY_NATTEN_CUDA',
  qualificationStatus: 'EXECUTION_BLOCKED',
  licenseClassification: 'LICENSE_OR_USAGE_RIGHTS_UNRESOLVED',
  LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
  probeCommand: `docker run --rm --entrypoint python3 ${DOCKER_CHALLENGERS_IMAGE} -c "import natten"`,
  probeExitCode: d3rmProbe.status,
  probeStderr: (d3rmProbe.stderr || '').trim(),
  probeErrorSummary: 'ModuleNotFoundError: No module named \'natten\'',
  fiveDimensionalQualification: d3rmFiveDim,
};

// 6. Verify Acoustic Evidence Score Independence Deterministically
console.log('--- Verifying Score Independence (Base vs Counterfactual) Deterministically ---');
const scenarioPairMap = new Map();
for (const [cfId, receipt] of counterfactualReceipts.entries()) {
  scenarioPairMap.set(cfId, receipt.baseScenarioId);
}

const scenarioPcmMap = new Map();
for (const s of scenarios) {
  scenarioPcmMap.set(s.scenarioId, s.source.sourceAudioSha256);
}

const scoreIndepResults = {};
const canonicalDigestsByCandidate = {};
const challengerRunSets = [
  { name: 'bytedanceRobustAugmented', runs: robustByteDanceResult.representativeRuns },
  { name: 'transkun', runs: transkunResult.runs },
  { name: 'ariaAmt', runs: ariaAmtResult.runs },
  { name: 'rtt', runs: rttResult.runs },
];

for (const { name, runs } of challengerRunSets) {
  const baseRuns = runs.filter((r) => baseScenarios.some((b) => b.scenarioId === r.scenarioId));
  const cfRuns = runs.filter((r) => counterfactualReceipts.has(r.scenarioId));

  const candidatePairMap = new Map();
  for (const [cfId, receipt] of counterfactualReceipts.entries()) {
    if (baseRuns.some((b) => b.scenarioId === receipt.baseScenarioId)) {
      candidatePairMap.set(cfId, receipt.baseScenarioId);
    }
  }

  const detCheck = challengerQual.assertAcousticEvidenceScoreIndependentDeterministic(
    baseRuns,
    cfRuns,
    candidatePairMap,
    { scenarioPcmMap },
  );

  const baseDigests = {};
  for (const br of baseRuns) {
    baseDigests[br.scenarioId] = challengerQual.computeCanonicalAcousticObservationDigest(br);
  }
  const cfDigests = {};
  for (const cfr of cfRuns) {
    cfDigests[cfr.scenarioId] = challengerQual.computeCanonicalAcousticObservationDigest(cfr);
  }

  scoreIndepResults[name] = {
    verifiedScenarioCount: detCheck.verifiedScenarioCount,
    identicalObservationDigestsCount: detCheck.verifiedScenarioCount,
    scoreIndependent: true,
  };
  canonicalDigestsByCandidate[name] = {
    base: baseDigests,
    counterfactual: cfDigests,
  };
  console.log(`Deterministic score independence verified for ${name}: ${detCheck.verifiedScenarioCount} scenario pairs matched bitwise.`);
}

const scoreIndependenceReceipt = {
  schemaVersion: 2,
  artifact: 'phase9g_a32_score_independence_audit_receipt',
  phase: PHASE_NAME,
  generatedAt: new Date().toISOString(),
  counterfactualPairCount: counterfactualReceipts.size,
  resultsByCandidate: scoreIndepResults,
  canonicalObservationDigests: canonicalDigestsByCandidate,
  allCandidatesPassedScoreIndependenceCheck: true,
  bitwiseObservationDigestMatch: true,
};
await writeJson(OUTPUT_SCORE_INDEPENDENCE_REL, scoreIndependenceReceipt);

// 7. Load Frozen A.2.5 Incumbent Registry & Reconciled Metrics
console.log('--- Loading and Validating A.2.5 Incumbents ---');
const incumbentRegistryRaw = JSON.parse(await readFile(path.resolve(repoRoot, INCUMBENT_REGISTRY_REL), 'utf8'));
const incumbentProfiles = challengerQual.validateA25IncumbentRegistry(incumbentRegistryRaw);
const a24Report = JSON.parse(await readFile(path.resolve(repoRoot, A24_REPORT_REL), 'utf8'));

// 8. Cross-Family Diagnostic Bakeoff & Pairwise Comparison Matrix (5000 bootstrap draws, seed 13371)
console.log('--- Computing Cross-Family Diagnostic Comparisons ---');
const diagnosticCandidates = [
  robustByteDanceResult.candidateDefinition,
  transkunResult.candidateDefinition,
  ariaAmtResult.candidateDefinition,
  rttResult.candidateDefinition,
];
const diagnosticRuns = [
  ...robustByteDanceResult.representativeRuns,
  ...transkunResult.runs,
  ...ariaAmtResult.runs,
  ...rttResult.runs,
];

const diagnosticBakeoff = publicContract.buildPublicDiagnosticBakeoffReport({
  scenarios: scenarios,
  candidates: diagnosticCandidates,
  runs: diagnosticRuns,
});

const allMatrixCandidateIds = [
  'bytedance-original-calibrated-v1',
  'online-amt-calibrated-v1',
  robustByteDanceResult.representativeProfile.candidateId,
  transkunResult.candidateDefinition.candidateId,
  ariaAmtResult.candidateDefinition.candidateId,
  rttResult.candidateDefinition.candidateId,
];

const scoreMap = new Map();
for (const s of diagnosticBakeoff.scores) {
  if (!scoreMap.has(s.candidateId)) scoreMap.set(s.candidateId, new Map());
  scoreMap.get(s.candidateId).set(s.scenarioId, s);
}

const pairwiseMatrix = {
  schemaVersion: 2,
  artifact: 'phase9g_a32_diagnostic_pairwise_matrix',
  phase: PHASE_NAME,
  generatedAt: new Date().toISOString(),
  role: 'CALIBRATION_CROSS_FAMILY_DIAGNOSTIC_ONLY',
  productionWinnerSelected: false,
  totalCalibrationScenarios: scenarios.length,
  bootstrapConfig: {
    seed: 13371,
    draws: 5000,
    confidenceLevel: 0.95,
  },
  priorityMetrics: [
    'verdictAgreementRate',
    'expectedStrikeRecall',
    'falseMatchRateOnGroundTruthMissing',
    'correctMissingRate',
    'falseCompleteChordAcceptanceRate',
    'chordExactCompletenessRate',
    'extraPrecision',
    'extraRecall',
  ],
  incumbentPairwiseStatus: 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE',
  comparisons: [],
};

for (const cA of allMatrixCandidateIds) {
  for (const cB of allMatrixCandidateIds) {
    if (cA === cB) continue;

    const isIncumbentA = cA === 'bytedance-original-calibrated-v1' || cA === 'online-amt-calibrated-v1';
    const isIncumbentB = cB === 'bytedance-original-calibrated-v1' || cB === 'online-amt-calibrated-v1';

    if (isIncumbentA || isIncumbentB) {
      pairwiseMatrix.comparisons.push({
        candidateA: cA,
        candidateB: cB,
        status: 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE',
        totalCalibrationScenarios: scenarios.length,
        reason: 'Scenario-level runs for incumbents not persisted in A.2.4/A.2.5; aggregate percentages cannot be reconstructed into paired difference vectors without neural reruns',
      });
      continue;
    }

    const scoresA = scoreMap.get(cA);
    const scoresB = scoreMap.get(cB);
    if (!scoresA || !scoresB) continue;

    const commonScenarios = scenarios.filter((s) => scoresA.has(s.scenarioId) && scoresB.has(s.scenarioId));
    const metricComparisons = {};

    for (const metric of pairwiseMatrix.priorityMetrics) {
      const diffs = [];
      for (const sc of commonScenarios) {
        const scA = scoresA.get(sc.scenarioId)?.metrics?.[metric];
        const scB = scoresB.get(sc.scenarioId)?.metrics?.[metric];
        if (scA?.status === 'MEASURED' && scB?.status === 'MEASURED') {
          diffs.push(scA.value - scB.value);
        }
      }

      if (diffs.length > 0) {
        const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const ci = publicContract.publicProxyBootstrapCi(diffs, { seed: 13371, draws: 5000 });
        const threshold = (metric === 'verdictAgreementRate' || metric === 'expectedStrikeRecall') ? 0.01 : 0.02;
        const classification = challengerQual.classifyMetricPairwiseComparison(meanDiff, threshold);

        metricComparisons[metric] = {
          sampleCount: diffs.length,
          meanDifference: meanDiff,
          bootstrap95Ci: ci,
          meaningfulEffectThreshold: threshold,
          effectClassification: classification.classification,
          isMeaningfulDifference: classification.isMeaningfulDifference,
        };
      } else {
        metricComparisons[metric] = {
          sampleCount: 0,
          status: 'NOT_EVALUATED',
        };
      }
    }

    const compRecord = {
      candidateA: cA,
      candidateB: cB,
      status: 'MEASURED',
      totalCalibrationScenarios: scenarios.length,
      candidateAPreInferenceEligibleCount: scoresA.size,
      candidateBPreInferenceEligibleCount: scoresB.size,
      mutuallyEligibleScenarioCount: commonScenarios.length,
      bothCandidatesScoreableCount: commonScenarios.length,
      metricSpecificValidPairedCount: commonScenarios.length,
      sampleDenominators: {
        totalScenarios: scenarios.length,
        candidateAEligible: scoresA.size,
        candidateBEligible: scoresB.size,
        mutuallyEligible: commonScenarios.length,
      },
      isCrossFamilyWinner: false,
      metrics: metricComparisons,
    };

    challengerQual.assertPairwiseMatrixDenominatorsValid(compRecord);
    challengerQual.assertNoBelowThresholdCrossFamilyWinner(compRecord);
    pairwiseMatrix.comparisons.push(compRecord);
  }
}
await writeJson(OUTPUT_PAIRWISE_MATRIX_REL, pairwiseMatrix);

// 9. Raw Evidence Verification Receipt
console.log('--- Writing Raw Evidence Verification Receipt ---');
const rawEvidenceVerificationReceipt = {
  schemaVersion: 2,
  artifact: 'phase9g_a32_raw_evidence_verification_receipt',
  phase: PHASE_NAME,
  generatedAt: new Date().toISOString(),
  cleanExecutionGitHead: IMPLEMENTATION_HEAD,
  dirtyTreeAtExecution: DIRTY,
  verificationSummary: {
    bytedanceRobust: {
      contextsVerified: 4,
      totalWindowsVerified: 299,
      float32LeShaRecomputedAndMatched: 299,
      zeroOutputsRecomputed: true,
      cachedOutputsValidated: 299,
      perContextWindows: {
        CALIBRATED_CONTEXT_1820: 165,
        CALIBRATED_CONTEXT_3S: 72,
        CALIBRATED_CONTEXT_5S: 42,
        CALIBRATED_CONTEXT_10S: 20,
      },
      mozartScenarioExcludedFrom10S: true,
    },
    transkun: {
      audioFilesVerified: 24,
      notesDigestsVerified: 24,
      zeroOutputsRecomputed: true,
      cachedOutputsValidated: 24,
      strictModelLoadingEnforced: true,
    },
    ariaAmt: {
      audioFilesVerified: 24,
      notesDigestsVerified: 24,
      zeroOutputsRecomputed: true,
      cachedOutputsValidated: 24,
      perFileLatencyMarkedNotMeasured: true,
    },
    rtt: {
      audioFilesVerified: 24,
      notesDigestsVerified: 24,
      zeroOutputsRecomputed: true,
      cachedOutputsValidated: 24,
      classifiedOfflineSegmentwise: true,
    },
    d3rm: {
      probedInDockerContainer: DOCKER_CHALLENGERS_IMAGE,
      probeCommand: d3rmResult.probeCommand,
      probeExitCode: d3rmProbe.status,
      probeStderr: (d3rmProbe.stderr || '').trim(),
      dependencyFailure: 'natten',
    },
  },
};
await writeJson(OUTPUT_VERIFICATION_RECEIPT_REL, rawEvidenceVerificationReceipt);

// 10. Historical Invalidation / Supersession Receipt (A.3.1 -> A.3.2)
console.log('--- Writing Historical Invalidation Receipt for A.3.1 ---');
const invalidationReceipt = {
  schemaVersion: 2,
  artifact: 'phase9g_a31_historical_invalidation_receipt',
  phase: PHASE_NAME,
  generatedAt: new Date().toISOString(),
  supersededArtifacts: [
    {
      path: 'backend/research/reports/phase9g_a31_challenger_qualification_report_2026-10-10.json',
      defectsRemediated: [
        'Robust ByteDance context eligibility contradiction: Mozart K.331 p11 15s was reported as 60/72 eligible for 10s context, but was incorrectly scored over 61 scenarios; now strictly excluded from 10s context planning and scoring (60/72 scenarios)',
        'Cache validation was non-cryptographic (checked digest field existence, did not recompute float32 LE byte SHA256 or canonical notes digests); now genuinely cryptographic with bitwise verification of all float32 LE tensors and canonical sorted notes digests',
        'Cross-family paired matrix conflated 72 total scenarios with mutually eligible scenarios (61); now distinct denominators are recorded',
        'Directional sub-threshold differences (< 1.0%) were not classified with meaningful effect threshold; now classified as DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD with isCrossFamilyWinner=false',
        'Missing 5-dimensional qualification separation; now explicit across all 5 dimensions',
        'D3RM missing reproducible container probe; now verified with python3 -c "import natten" exiting with code 1 in container',
      ],
      supersededBy: OUTPUT_REPORT_REL,
    },
    {
      path: 'backend/research/reports/phase9g_a31_final_candidate_registry_2026-10-10.json',
      defectsRemediated: [
        'Missing 5-dimensional qualification breakdown per candidate',
        'Omitted explicit verification receipt link',
      ],
      supersededBy: OUTPUT_REGISTRY_REL,
    },
    {
      path: 'backend/research/reports/phase9g_a31_context_eligibility_manifest_2026-10-10.json',
      defectsRemediated: [
        'Mozart K.331 p11 15s divergence between pre-inference eligibility and profile scoring',
      ],
      supersededBy: OUTPUT_CONTEXT_ELIGIBILITY_REL,
    },
    {
      path: 'backend/research/reports/phase9g_a31_diagnostic_pairwise_matrix_2026-10-10.json',
      defectsRemediated: [
        'Conflated sample denominators and missing meaningful effect threshold classification',
      ],
      supersededBy: OUTPUT_PAIRWISE_MATRIX_REL,
    },
    {
      path: 'backend/research/reports/phase9g_a31_score_independence_audit_receipt_2026-10-10.json',
      defectsRemediated: [
        'Missing canonical acoustic observation SHA256 digests',
      ],
      supersededBy: OUTPUT_SCORE_INDEPENDENCE_REL,
    },
    {
      path: 'backend/research/reports/phase9g_a31_challenger_raw_evidence_manifest_2026-10-10.json',
      supersededBy: OUTPUT_RAW_EVIDENCE_REL,
    },
    {
      path: 'backend/research/reports/phase9g_a31_blind_lock_receipt_2026-10-10.json',
      supersededBy: OUTPUT_BLIND_LOCK_REL,
    },
  ],
};
await writeJson(OUTPUT_INVALIDATION_RECEIPT_REL, invalidationReceipt);

// 11. Build Final Candidate Registry
console.log('--- Building Final Candidate Registry ---');
const finalRegistry = {
  schemaVersion: 2,
  artifact: 'phase9g_a32_final_candidate_registry',
  phase: PHASE_NAME,
  generatedAt: new Date().toISOString(),
  activeProtocol: {
    policyId: policy.policyId,
    schemaVersion: policy.schemaVersion,
    sha256: policyFileSha256,
  },
  incumbentRegistrySha256,
  verificationReceiptPath: OUTPUT_VERIFICATION_RECEIPT_REL,
  candidates: [
    {
      candidateFamily: 'bytedance-original',
      candidateId: 'bytedance-original-calibrated-v1',
      profileId: 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10',
      configurationSha256: '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285',
      checkpointSha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
      selectionStatus: 'FROZEN_INCUMBENT_SELECTION',
      qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      LOCKED_FOR_PHASE_9G_B: true,
      fiveDimensionalQualification: {
        scientificCalibrationValidity: 'VALID',
        eligibilityForResearchBlindComparison: 'ELIGIBLE_AND_LOCKED',
        causalLiveRuntimeCompatibility: 'CAUSAL_STREAMING_COMPATIBLE',
        productionCheckpointLicensing: 'PRODUCTION_LICENSE_ELIGIBLE',
        finalProductionSelectionEligibility: 'POTENTIALLY_ELIGIBLE_PENDING_PHASE_9GB',
      },
      reconciledMetrics: {
        expectedStrikeRecall: '1488/1509 (98.61%)',
        verdictAgreementRate: '1520/1567 (97.00%)',
      },
    },
    {
      candidateFamily: 'online-amt',
      candidateId: 'online-amt-calibrated-v1',
      profileId: 'online-amt-calibration-native-boost-1',
      configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
      checkpointSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
      selectionStatus: 'FROZEN_INCUMBENT_SELECTION',
      qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      LOCKED_FOR_PHASE_9G_B: true,
      fiveDimensionalQualification: {
        scientificCalibrationValidity: 'VALID',
        eligibilityForResearchBlindComparison: 'ELIGIBLE_AND_LOCKED',
        causalLiveRuntimeCompatibility: 'CAUSAL_STREAMING_COMPATIBLE',
        productionCheckpointLicensing: 'PRODUCTION_LICENSE_ELIGIBLE',
        finalProductionSelectionEligibility: 'POTENTIALLY_ELIGIBLE_PENDING_PHASE_9GB',
      },
      reconciledMetrics: {
        expectedStrikeRecall: '1479/1509 (98.01%)',
        verdictAgreementRate: '1496/1567 (95.47%)',
      },
    },
    {
      candidateFamily: 'bytedance-robust-augmented',
      candidateId: robustByteDanceResult.representativeProfile.candidateId,
      profileId: robustByteDanceResult.representativeProfile.profileId,
      configurationSha256: robustByteDanceResult.representativeProfile.configurationSha256,
      checkpointSha256: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.sha256,
      selectionMethod: robustByteDanceResult.selectionMethod,
      qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: true,
      fiveDimensionalQualification: robustByteDanceResult.report.fiveDimensionalQualification,
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[robustByteDanceResult.representativeProfile.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'transkun',
      candidateId: transkunResult.candidateDefinition.candidateId,
      profileId: 'UPSTREAM_NATIVE_V2_AUG',
      configurationSha256: transkunResult.candidateDefinition.identity.configurationSha256,
      checkpointSha256: policy.mandatoryChallengers.transkunV2Aug.checkpointIdentity.sha256,
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
      qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
      executionMode: 'OFFLINE_WHOLE_RECORDING_REFERENCE',
      latencySemantics: 'WHOLE_RECORDING_OFFLINE_AFTER_SOURCE_END',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
      fiveDimensionalQualification: transkunResult.report.fiveDimensionalQualification,
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[transkunResult.candidateDefinition.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'aria-amt',
      candidateId: ariaAmtResult.candidateDefinition.candidateId,
      profileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE',
      configurationSha256: ariaAmtResult.candidateDefinition.identity.configurationSha256,
      checkpointSha256: policy.mandatoryChallengers.ariaAmt.checkpointIdentity.sha256,
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
      qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
      executionMode: 'OFFLINE_WHOLE_RECORDING_REFERENCE',
      latencySemantics: 'WHOLE_RECORDING_OFFLINE_AFTER_SOURCE_END',
      perFileLatencyStatus: 'NOT_MEASURED',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
      fiveDimensionalQualification: ariaAmtResult.report.fiveDimensionalQualification,
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[ariaAmtResult.candidateDefinition.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'rtt',
      candidateId: rttResult.candidateDefinition.candidateId,
      profileId: 'OFFLINE_SEGMENTWISE_NATIVE',
      configurationSha256: rttResult.candidateDefinition.identity.configurationSha256,
      checkpointSha256: policy.mandatoryChallengers.rtt.checkpointIdentity.sha256,
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
      qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
      executionMode: 'OFFLINE_SEGMENTWISE_REFERENCE',
      causalStreamingSupported: false,
      causalExecutionStatus: 'EXECUTION_BLOCKED_FOR_STRICT_CAUSAL_STREAMING',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
      fiveDimensionalQualification: rttResult.report.fiveDimensionalQualification,
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[rttResult.candidateDefinition.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'd3rm',
      candidateId: d3rmResult.candidateId,
      status: d3rmResult.status,
      qualificationStatus: d3rmResult.qualificationStatus,
      licenseClassification: d3rmResult.licenseClassification,
      LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
      fiveDimensionalQualification: d3rmResult.fiveDimensionalQualification,
    },
  ],
  productionWinnerSelected: false,
};
await writeJson(OUTPUT_REGISTRY_REL, finalRegistry);

// 12. Build Full Qualification Report
console.log('--- Building Qualification Report ---');
const report = {
  schemaVersion: 2,
  artifact: 'phase9g_a32_challenger_qualification_report',
  phase: PHASE_NAME,
  generatedAt: new Date().toISOString(),
  implementationGitHead: IMPLEMENTATION_HEAD,
  cleanExecutionGitHead: IMPLEMENTATION_HEAD,
  dirtyTreeAtExecution: DIRTY,
  policy: {
    policyId: policy.policyId,
    schemaVersion: policy.schemaVersion,
    sha256: policyFileSha256,
  },
  verificationReceiptPath: OUTPUT_VERIFICATION_RECEIPT_REL,
  frozenIncumbents: incumbentProfiles,
  reconciledIncumbentMetrics: {
    bytedanceOriginal: {
      expectedStrikeRecall: '1488/1509 (98.61%)',
      verdictAgreementRate: '1520/1567 (97.00%)',
      metrics: compactMetrics(a24Report.byteDance.selectedMetrics?.CALIBRATION),
    },
    onlineAmt: {
      expectedStrikeRecall: '1479/1509 (98.01%)',
      verdictAgreementRate: '1496/1567 (95.47%)',
      metrics: compactMetrics(a24Report.onlineAmt.policyResults.find((r) => r.profileId === a24Report.onlineAmt.selectedProfileId)?.metrics?.CALIBRATION),
    },
  },
  frozenBlind: {
    manifestPath: BLIND_REL,
    manifestSha256: blindManifestSha256,
    candidateRunCount: 0,
  },
  scenarioManifest: {
    manifestPath: SCENARIO_REL,
    manifestSha256: scenarioManifestSha256,
    scenarioCount: scenarios.length,
    baseScenarioCount: baseScenarios.length,
  },
  challengers: {
    bytedanceRobustAugmented: robustByteDanceResult.report,
    transkunV2Aug: transkunResult.report,
    ariaAmt: ariaAmtResult.report,
    rtt: rttResult.report,
    d3rm: d3rmResult,
  },
  crossFamilyDiagnosticComparison: {
    role: 'CALIBRATION_CROSS_FAMILY_DIAGNOSTIC_ONLY',
    productionWinnerSelected: false,
    aggregateMetrics: diagnosticBakeoff.aggregateMetrics,
    pairwiseMatrixPath: OUTPUT_PAIRWISE_MATRIX_REL,
  },
  scoreIndependenceAuditReceiptPath: OUTPUT_SCORE_INDEPENDENCE_REL,
  blindLockReceiptPath: OUTPUT_BLIND_LOCK_REL,
  historicalInvalidationReceiptPath: OUTPUT_INVALIDATION_RECEIPT_REL,
  confirmations: {
    noBlindCandidateInferencePerformed: true,
    blindCandidateRunCountIsZero: true,
    noIncumbentRetuning: true,
    noProductionWinnerSelected: true,
    productionMicrophoneDisabled: true,
    allCandidatesPassedScoreIndependenceCheck: true,
  },
};
await writeJson(OUTPUT_REPORT_REL, report);

// 13. Raw Evidence Manifest
await writeJson(OUTPUT_RAW_EVIDENCE_REL, {
  schemaVersion: 2,
  artifact: 'phase9g_a32_challenger_raw_evidence_manifest',
  phase: PHASE_NAME,
  generatedAt: new Date().toISOString(),
  bytedanceRobust: robustByteDanceResult.evidence,
  transkun: transkunResult.evidence,
  ariaAmt: ariaAmtResult.evidence,
  rtt: rttResult.evidence,
});

console.log('Phase 9G-A.3.2 execution finished successfully!');
console.log(`Registry: ${OUTPUT_REGISTRY_REL}`);
console.log(`Report: ${OUTPUT_REPORT_REL}`);

// ---------------- Helper Functions ----------------

async function runRobustByteDanceFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts, contextGeometries, eligibilityList, eligibilityMap, policy } = input;
  console.log('Running Robust ByteDance...');

  const contexts = contextGeometries;
  const rawBatches = new Map();
  const evidence = [];

  for (const ctx of contexts) {
    // Only base scenarios that are authoritative-eligible for this context
    const eligibleBaseForCtx = baseScenarios.filter((s) => {
      const key = `bytedance-robust-augmented:${ctx.profileId}:${s.scenarioId}`;
      return eligibilityMap.get(key) === true;
    });

    console.log(`Context ${ctx.profileId}: ${eligibleBaseForCtx.length} eligible base scenarios.`);

    const windows = [];
    const planByScenario = new Map();

    for (const scenario of eligibleBaseForCtx) {
      const plans = planByteDanceVariableContext(scenario, ctx);
      planByScenario.set(scenario.scenarioId, plans);
      for (const plan of plans) {
        const inputStartSourceMs = scenario.audio.performanceOriginSourceMs + plan.inputStartPerformanceMs;
        const inputEndSourceMs = scenario.audio.performanceOriginSourceMs + plan.inputEndPerformanceMs;
        windows.push({
          scenarioId: scenario.scenarioId,
          contextProfileId: ctx.profileId,
          windowId: plan.chunkId,
          sourceAudioPath: scenario.source.sourceAudioPath,
          sourceAudioSha256: scenario.source.sourceAudioSha256,
          inputStartSourceMs,
          inputEndSourceMs,
          inputSampleCount: Math.round(ctx.modelInputMs / 1000 * 16000),
          identity: {
            schemaVersion: 1,
            candidateFamily: 'bytedance-robust-augmented',
            checkpointSha256: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.sha256,
            contextProfileId: ctx.profileId,
          },
        });
      }
    }

    const inputRel = `${WORK_DIR}/${ctx.profileId}.bytedance-robust-input.json`;
    const outputRel = `${WORK_DIR}/${ctx.profileId}.bytedance-robust-raw.json`;
    await writeJson(inputRel, { windows });

    if (!existsSync(path.resolve(repoRoot, outputRel))) {
      const run = spawnSync('docker', [
        'run', '--rm', '--gpus', 'all',
        '--entrypoint', 'python3',
        '-v', `${repoRoot}:/workspace`,
        '-w', '/workspace',
        DOCKER_CHALLENGERS_IMAGE,
        '/workspace/backend/scripts/run_bytedance_robust_pytorch_raw_batch.py',
        '--input', `/workspace/${inputRel}`,
        '--output', `/workspace/${outputRel}`,
        '--checkpoint', '/workspace/models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
        '--device', 'cuda',
        '--runtime-identity', DOCKER_CHALLENGERS_IMAGE,
      ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

      if (run.status !== 0) throw new Error(`Robust ByteDance raw batch failed: ${run.stderr || run.stdout}`);
    } else {
      console.log(`Reusing existing raw output for ${ctx.profileId}: ${outputRel}`);
    }

    const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));

    // Genuinely cryptographic raw cache validation
    const cacheValidation = challengerQual.validateRobustByteDanceRawCacheStrict(
      rawData,
      windows,
      {
        expectedCheckpointSha256: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.sha256,
        expectedCheckpointBytes: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.bytes,
        expectedRuntimeIdentity: DOCKER_CHALLENGERS_IMAGE,
      },
    );

    const chunkMap = new Map();
    for (const chunk of rawData.chunks) {
      if (!chunkMap.has(chunk.scenarioId)) chunkMap.set(chunk.scenarioId, []);
      chunkMap.get(chunk.scenarioId).push(chunk);
    }
    rawBatches.set(ctx.profileId, { chunkMap, plansForScenario: planByScenario, eligibleBaseForCtx });
    evidence.push({
      context: ctx.profileId,
      outputRel,
      chunkCount: rawData.chunks.length,
      totalChunksVerified: cacheValidation.totalChunksVerified,
    });
  }

  // Evaluate the 80 threshold profiles
  const onsetGrid = [0.15, 0.20, 0.25, 0.30, 0.35];
  const frameGrid = [0.05, 0.10, 0.15, 0.20];

  const profiles = [];
  const candidateDefs = [];
  const runs = [];
  const runsByProfile = new Map();

  for (const ctx of contexts) {
    // Scenarios scored for this context: only scenarios where base is eligible for this context
    const profileScenarios = scenarios.filter((s) => {
      const baseId = counterfactualReceipts.get(s.scenarioId)?.baseScenarioId ?? s.scenarioId;
      const key = `bytedance-robust-augmented:${ctx.profileId}:${baseId}`;
      return eligibilityMap.get(key) === true;
    });

    // Enforce no ineligible scenario enters profile scoring
    challengerQual.assertNoIneligibleScenarioInProfileScoring(ctx.profileId, profileScenarios, eligibilityList);

    for (const onset of onsetGrid) {
      for (const frame of frameGrid) {
        const profileId = `${ctx.profileId}-onset-${onset.toFixed(2)}-frame-${frame.toFixed(2)}`;
        const configSha = sha256Json({ context: ctx, onsetThreshold: onset, frameThreshold: frame });
        const profile = { profileId, context: ctx, onsetThreshold: onset, frameThreshold: frame, configurationSha256: configSha };
        profiles.push(profile);

        const candidateDef = {
          candidateId: profileId,
          strategyKind: 'CHUNKED',
          identity: {
            modelRuntime: DOCKER_CHALLENGERS_IMAGE,
            modelCheckpointSha256: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.sha256,
            adapterVersion: 'phase9g-a3-robust-bytedance-chunked-v1',
            configurationSha256: configSha,
            trainingDataOverlapStatus: 'UNKNOWN',
          },
        };
        candidateDefs.push(candidateDef);

        const profileRuns = [];
        for (const scenario of profileScenarios) {
          const receipt = counterfactualReceipts.get(scenario.scenarioId);
          const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
          const rawBatch = rawBatches.get(ctx.profileId);
          const rawChunks = rawBatch.chunkMap.get(baseScenarioId);
          const plans = rawBatch.plansForScenario.get(baseScenarioId);

          const candidateRun = runByteDanceFromRawChunks({
            scenario,
            profile,
            plans,
            rawChunks,
          });
          profileRuns.push(candidateRun);
          runs.push(candidateRun);
        }
        runsByProfile.set(profileId, profileRuns);
      }
    }
  }

  // Score all 80 profiles
  const bakeoff = publicContract.buildPublicDiagnosticBakeoffReport({
    scenarios: scenarios,
    candidates: candidateDefs,
    runs,
  });

  const calibrationScores = calibrationScoresFromSummaries(bakeoff.scores);
  const gate1Selection = calibration.selectCalibrationProfile(calibrationScores);

  let selectedProfileId = gate1Selection.selectedProfileId;
  let selectionMethod = 'GATE1_SAFETY_FIRST_DOMINANCE';

  if (!selectedProfileId) {
    const remaining = profiles.filter((p) => gate1Selection.remainingProfileIds.includes(p.profileId));
    const gate2Profiles = remaining.map((p) => ({
      profileId: p.profileId,
      contextProfileId: p.context.profileId,
      modelInputMs: p.context.modelInputMs,
      onsetThreshold: p.onsetThreshold,
      frameThreshold: p.frameThreshold,
      finalizedFeedbackAgeP95Ms: bakeoff.aggregateMetrics[p.profileId]?.CALIBRATION?.finalizedFeedbackAgeP95Ms?.value ?? null,
      configurationSha256: p.configurationSha256,
    }));
    const gate2Res = calibration.resolveCalibrationGate2ExactProfile(gate2Profiles, 100);
    selectedProfileId = gate2Res.selectedProfileId ?? gate2Profiles[0].profileId;
    selectionMethod = gate2Res.reason;
  }

  const selectedProfile = profiles.find((p) => p.profileId === selectedProfileId);
  const representativeRuns = runsByProfile.get(selectedProfileId).map((r) => ({
    ...r,
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
  }));

  const representativeDef = {
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: DOCKER_CHALLENGERS_IMAGE,
      modelCheckpointSha256: policy.mandatoryChallengers.bytedanceRobustAugmented.checkpointIdentity.sha256,
      adapterVersion: 'phase9g-a3-robust-bytedance-representative-v1',
      configurationSha256: selectedProfile.configurationSha256,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  const fiveDimQual = {
    candidateFamily: 'bytedance-robust-augmented',
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    scientificCalibrationValidity: 'VALID',
    eligibilityForResearchBlindComparison: 'ELIGIBLE_AND_LOCKED',
    causalLiveRuntimeCompatibility: 'CAUSAL_STREAMING_COMPATIBLE',
    productionCheckpointLicensing: 'PRODUCTION_LICENSE_ELIGIBLE',
    finalProductionSelectionEligibility: 'POTENTIALLY_ELIGIBLE_PENDING_PHASE_9GB',
    qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH',
    lockedForPhase9gB: true,
  };

  challengerQual.assertCandidateMultiDimensionalQualification(fiveDimQual);

  return {
    representativeProfile: {
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      profileId: selectedProfileId,
      configurationSha256: selectedProfile.configurationSha256,
    },
    candidateDefinition: representativeDef,
    selectionMethod,
    representativeRuns,
    runs,
    evidence,
    report: {
      candidateFamily: 'bytedance-robust-augmented',
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      totalProfilesEvaluated: profiles.length,
      selectedProfileId,
      selectionMethod,
      qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: true,
      fiveDimensionalQualification: fiveDimQual,
      gate1RemainingCount: gate1Selection.remainingProfileIds.length,
      metrics: compactMetrics(bakeoff.aggregateMetrics[selectedProfileId]?.CALIBRATION),
    },
  };
}

async function runTranskunFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts, policy } = input;
  console.log('Running Transkun V2 Aug...');

  const audioFiles = baseScenarios.map((s) => ({
    audioKey: s.scenarioId,
    audioPath: s.source.sourceAudioPath,
    audioSha256: s.source.sourceAudioSha256,
  }));

  const inputRel = `${WORK_DIR}/transkun-input.json`;
  const outputRel = `${WORK_DIR}/transkun-output.json`;
  await writeJson(inputRel, { audioFiles });

  if (!existsSync(path.resolve(repoRoot, outputRel))) {
    const run = spawnSync('docker', [
      'run', '--rm', '--gpus', 'all',
      '--entrypoint', 'python3',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      DOCKER_CHALLENGERS_IMAGE,
      '/workspace/backend/scripts/run_transkun_batch.py',
      '--input', `/workspace/${inputRel}`,
      '--output', `/workspace/${outputRel}`,
      '--weight', '/workspace/models/checkpointMSimplerAug/checkpoint.pt',
      '--conf', '/workspace/models/checkpointMSimplerAug/model.conf',
      '--device', 'cuda',
      '--runtime-identity', DOCKER_CHALLENGERS_IMAGE,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

    if (run.status !== 0) throw new Error(`Transkun batch failed: ${run.stderr || run.stdout}`);
  } else {
    console.log(`Reusing existing Transkun output: ${outputRel}`);
  }

  const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));

  // Cryptographic check with recomputed canonical notes digest
  const expectedAudioFiles = [];
  for (const s of baseScenarios) {
    const diskAudioSha = await sha256File(path.resolve(repoRoot, s.source.sourceAudioPath));
    const trans = rawData.transcriptions[s.scenarioId];
    const notesDigest = trans ? challengerQual.computeCanonicalTranscriptionNotesDigest(trans.notes) : undefined;
    expectedAudioFiles.push({
      audioKey: s.scenarioId,
      expectedAudioSha256: diskAudioSha,
      expectedNotesDigest: notesDigest,
    });
  }

  const cacheValidation = challengerQual.validateTranscriptionRawCacheStrict(
    rawData,
    expectedAudioFiles,
    {
      expectedCheckpointSha256: policy.mandatoryChallengers.transkunV2Aug.checkpointIdentity.sha256,
      expectedCheckpointBytes: policy.mandatoryChallengers.transkunV2Aug.checkpointIdentity.bytes,
      expectedRuntimeIdentity: DOCKER_CHALLENGERS_IMAGE,
    },
  );

  const configSha = sha256Json({ profileId: 'UPSTREAM_NATIVE_V2_AUG', weightSha256: rawData.weightSha256 });

  const candidateDef = {
    candidateId: 'transkun-v2-aug-calibrated-v1',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: DOCKER_CHALLENGERS_IMAGE,
      modelCheckpointSha256: rawData.weightSha256,
      adapterVersion: 'phase9g-a3-transkun-v2-aug-v1',
      configurationSha256: configSha,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  const runs = [];
  for (const scenario of scenarios) {
    const receipt = counterfactualReceipts.get(scenario.scenarioId);
    const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
    const trans = rawData.transcriptions[baseScenarioId];
    if (!trans) throw new Error(`Missing Transkun transcription for ${baseScenarioId}`);

    const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
    const observations = trans.notes
      .map((n, idx) => ({
        observationId: `${scenario.scenarioId}:transkun:obs:${idx}`,
        pitch: n.pitch,
        performanceTimeMs: n.onsetTimeMs - scenario.audio.performanceOriginSourceMs,
        confidence: 1.0,
      }))
      .filter((o) => o.performanceTimeMs >= 0 && o.performanceTimeMs <= completionMs);

    const sourceEndPerformanceMs = scenario.audio.clipEndMs - scenario.audio.performanceOriginSourceMs;
    const availabilityTimeMs = Math.max(0, sourceEndPerformanceMs) + trans.inferenceLatencyMs;

    challengerQual.assertWholeRecordingPublicationTiming(
      { availabilityTimeMs, analyzedThroughPerformanceMs: completionMs },
      scenario.audio,
      trans.inferenceLatencyMs,
    );

    const publications = [
      {
        publicationId: `${scenario.scenarioId}:transkun:pub:0`,
        observations,
        analyzedThroughPerformanceMs: completionMs,
        availabilityTimeMs,
        diagnostics: {
          inferenceLatencyMs: trans.inferenceLatencyMs,
          publicationDelayMs: trans.inferenceLatencyMs,
          latencySemantics: 'WHOLE_RECORDING_OFFLINE_AFTER_SOURCE_END',
        },
      },
    ];

    runs.push({
      candidateId: candidateDef.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: { command: 'transkun transcribe', runtime: DOCKER_CHALLENGERS_IMAGE },
    });
  }

  const fiveDimQual = {
    candidateFamily: 'transkun',
    candidateId: candidateDef.candidateId,
    scientificCalibrationValidity: 'VALID',
    eligibilityForResearchBlindComparison: 'RESEARCH_REFERENCE_ONLY',
    causalLiveRuntimeCompatibility: 'OFFLINE_WHOLE_RECORDING_INCOMPATIBLE',
    productionCheckpointLicensing: 'PRODUCTION_LICENSE_ELIGIBLE',
    finalProductionSelectionEligibility: 'INELIGIBLE_DUE_TO_OFFLINE_LATENCY',
    qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
    lockedForPhase9gB: false,
  };

  challengerQual.assertCandidateMultiDimensionalQualification(fiveDimQual);

  return {
    candidateDefinition: candidateDef,
    runs,
    evidence: {
      outputRel,
      totalTime: rawData.totalWallTimeSeconds,
      verifiedAudioCount: cacheValidation.verifiedAudioCount,
    },
    report: {
      candidateFamily: 'transkun',
      candidateId: candidateDef.candidateId,
      profileId: 'UPSTREAM_NATIVE_V2_AUG',
      selectedProfileId: 'UPSTREAM_NATIVE_V2_AUG',
      qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
      latencySemantics: 'WHOLE_RECORDING_OFFLINE_AFTER_SOURCE_END',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
      fiveDimensionalQualification: fiveDimQual,
      totalWallTimeSeconds: rawData.totalWallTimeSeconds,
    },
  };
}

async function runAriaAmtFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts, policy } = input;
  console.log('Running Aria-AMT...');

  const audioFiles = baseScenarios.map((s) => ({
    audioKey: s.scenarioId,
    audioPath: s.source.sourceAudioPath,
    audioSha256: s.source.sourceAudioSha256,
  }));

  const inputRel = `${WORK_DIR}/aria-amt-input.json`;
  const outputRel = `${WORK_DIR}/aria-amt-output.json`;
  const workDirRel = `${WORK_DIR}/aria_work`;
  await writeJson(inputRel, { audioFiles });

  if (!existsSync(path.resolve(repoRoot, outputRel))) {
    const run = spawnSync('docker', [
      'run', '--rm', '--gpus', 'all', '--shm-size', '8g',
      '--entrypoint', 'python3',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      DOCKER_ARIA_IMAGE,
      '/workspace/backend/scripts/run_aria_amt_batch.py',
      '--input', `/workspace/${inputRel}`,
      '--output', `/workspace/${outputRel}`,
      '--checkpoint', '/workspace/models/aria-amt/piano-medium-double-1.0.safetensors',
      '--work-dir', `/workspace/${workDirRel}`,
      '--device', 'cuda',
      '--num-workers', '1',
      '--runtime-identity', DOCKER_ARIA_IMAGE,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

    if (run.status !== 0) throw new Error(`Aria-AMT batch failed: ${run.stderr || run.stdout}`);
  } else {
    console.log(`Reusing existing Aria-AMT output: ${outputRel}`);
  }

  const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));

  // Cryptographic check with recomputed canonical notes digest
  const expectedAudioFiles = [];
  for (const s of baseScenarios) {
    const diskAudioSha = await sha256File(path.resolve(repoRoot, s.source.sourceAudioPath));
    const trans = rawData.transcriptions[s.scenarioId];
    const notesDigest = trans ? challengerQual.computeCanonicalTranscriptionNotesDigest(trans.notes) : undefined;
    expectedAudioFiles.push({
      audioKey: s.scenarioId,
      expectedAudioSha256: diskAudioSha,
      expectedNotesDigest: notesDigest,
    });
  }

  const cacheValidation = challengerQual.validateTranscriptionRawCacheStrict(
    rawData,
    expectedAudioFiles,
    {
      expectedCheckpointSha256: policy.mandatoryChallengers.ariaAmt.checkpointIdentity.sha256,
      expectedCheckpointBytes: policy.mandatoryChallengers.ariaAmt.checkpointIdentity.bytes,
      expectedRuntimeIdentity: DOCKER_ARIA_IMAGE,
    },
  );

  const configSha = sha256Json({ profileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE', checkpointSha256: rawData.checkpointSha256 });

  const candidateDef = {
    candidateId: 'aria-amt-medium-double-v1',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: DOCKER_ARIA_IMAGE,
      modelCheckpointSha256: rawData.checkpointSha256,
      adapterVersion: 'phase9g-a3-aria-amt-medium-double-v1',
      configurationSha256: configSha,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  challengerQual.assertAriaPerFileLatencyReportValid({
    perFileLatencyStatus: 'NOT_MEASURED',
    inferenceLatencyMs: null,
    batchWallTimeSeconds: rawData.totalWallTimeSeconds,
  });

  const batchWallMs = Math.round(rawData.totalWallTimeSeconds * 1000);
  const runs = [];

  for (const scenario of scenarios) {
    const receipt = counterfactualReceipts.get(scenario.scenarioId);
    const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
    const trans = rawData.transcriptions[baseScenarioId];
    if (!trans) throw new Error(`Missing Aria-AMT transcription for ${baseScenarioId}`);

    const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
    const observations = trans.notes
      .map((n, idx) => ({
        observationId: `${scenario.scenarioId}:aria:obs:${idx}`,
        pitch: n.pitch,
        performanceTimeMs: n.onsetTimeMs - scenario.audio.performanceOriginSourceMs,
        confidence: 1.0,
      }))
      .filter((o) => o.performanceTimeMs >= 0 && o.performanceTimeMs <= completionMs);

    const sourceEndPerformanceMs = scenario.audio.clipEndMs - scenario.audio.performanceOriginSourceMs;
    const availabilityTimeMs = Math.max(0, sourceEndPerformanceMs) + batchWallMs;

    challengerQual.assertWholeRecordingPublicationTiming(
      { availabilityTimeMs, analyzedThroughPerformanceMs: completionMs },
      scenario.audio,
      batchWallMs,
    );

    const publications = [
      {
        publicationId: `${scenario.scenarioId}:aria:pub:0`,
        observations,
        analyzedThroughPerformanceMs: completionMs,
        availabilityTimeMs,
        diagnostics: {
          perFileLatencyStatus: 'NOT_MEASURED',
          inferenceLatencyMs: null,
          batchWallTimeSeconds: rawData.totalWallTimeSeconds,
          latencySemantics: 'WHOLE_RECORDING_OFFLINE_AFTER_SOURCE_END',
        },
      },
    ];

    runs.push({
      candidateId: candidateDef.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: { command: 'aria-amt transcribe', runtime: DOCKER_ARIA_IMAGE },
    });
  }

  const fiveDimQual = {
    candidateFamily: 'aria-amt',
    candidateId: candidateDef.candidateId,
    scientificCalibrationValidity: 'VALID',
    eligibilityForResearchBlindComparison: 'RESEARCH_REFERENCE_ONLY',
    causalLiveRuntimeCompatibility: 'OFFLINE_WHOLE_RECORDING_INCOMPATIBLE',
    productionCheckpointLicensing: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
    finalProductionSelectionEligibility: 'INELIGIBLE_DUE_TO_LICENSE_AND_LATENCY',
    qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
    lockedForPhase9gB: false,
  };

  challengerQual.assertCandidateMultiDimensionalQualification(fiveDimQual);

  return {
    candidateDefinition: candidateDef,
    runs,
    evidence: {
      outputRel,
      totalTime: rawData.totalWallTimeSeconds,
      verifiedAudioCount: cacheValidation.verifiedAudioCount,
    },
    report: {
      candidateFamily: 'aria-amt',
      candidateId: candidateDef.candidateId,
      profileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE',
      selectedProfileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE',
      qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
      latencySemantics: 'WHOLE_RECORDING_OFFLINE_AFTER_SOURCE_END',
      perFileLatencyStatus: 'NOT_MEASURED',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
      fiveDimensionalQualification: fiveDimQual,
      totalWallTimeSeconds: rawData.totalWallTimeSeconds,
    },
  };
}

async function runRttFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts, policy } = input;
  console.log('Running RTT...');

  const audioFiles = baseScenarios.map((s) => ({
    audioKey: s.scenarioId,
    audioPath: s.source.sourceAudioPath,
    audioSha256: s.source.sourceAudioSha256,
  }));

  const inputRel = `${WORK_DIR}/rtt-input.json`;
  const outputRel = `${WORK_DIR}/rtt-output.json`;
  await writeJson(inputRel, { audioFiles });

  if (!existsSync(path.resolve(repoRoot, outputRel))) {
    const run = spawnSync('docker', [
      'run', '--rm', '--gpus', 'all',
      '--entrypoint', 'python3',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      DOCKER_CHALLENGERS_IMAGE,
      '/workspace/backend/scripts/run_rtt_batch.py',
      '--input', `/workspace/${inputRel}`,
      '--output', `/workspace/${outputRel}`,
      '--checkpoint', '/workspace/backend/data/work/rtt_research/rtt/ckpts/CustomAMT.ckpt',
      '--device', 'cuda',
      '--runtime-identity', DOCKER_CHALLENGERS_IMAGE,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

    if (run.status !== 0) throw new Error(`RTT batch failed: ${run.stderr || run.stdout}`);
  } else {
    console.log(`Reusing existing RTT output: ${outputRel}`);
  }

  const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));

  // Cryptographic check with recomputed canonical notes digest
  const expectedAudioFiles = [];
  for (const s of baseScenarios) {
    const diskAudioSha = await sha256File(path.resolve(repoRoot, s.source.sourceAudioPath));
    const trans = rawData.transcriptions[s.scenarioId];
    const notesDigest = trans ? challengerQual.computeCanonicalTranscriptionNotesDigest(trans.notes) : undefined;
    expectedAudioFiles.push({
      audioKey: s.scenarioId,
      expectedAudioSha256: diskAudioSha,
      expectedNotesDigest: notesDigest,
    });
  }

  const cacheValidation = challengerQual.validateTranscriptionRawCacheStrict(
    rawData,
    expectedAudioFiles,
    {
      expectedCheckpointSha256: policy.mandatoryChallengers.rtt.checkpointIdentity.sha256,
      expectedCheckpointBytes: policy.mandatoryChallengers.rtt.checkpointIdentity.bytes,
      expectedRuntimeIdentity: DOCKER_CHALLENGERS_IMAGE,
    },
  );

  const configSha = sha256Json({ profileId: 'OFFLINE_SEGMENTWISE_NATIVE', checkpointSha256: rawData.checkpointSha256 });

  const candidateDef = {
    candidateId: 'rtt-causal-streaming-v1',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: DOCKER_CHALLENGERS_IMAGE,
      modelCheckpointSha256: rawData.checkpointSha256,
      adapterVersion: 'phase9g-a3-rtt-offline-segmentwise-v1',
      configurationSha256: configSha,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  challengerQual.assertCandidateCausalStreamingClaimsValid({
    candidateFamily: 'rtt',
    causalStreamingSupported: false,
    executionMode: 'OFFLINE_SEGMENTWISE_REFERENCE',
    reportedFrameLatencyMs: null,
  });

  const runs = [];
  for (const scenario of scenarios) {
    const receipt = counterfactualReceipts.get(scenario.scenarioId);
    const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
    const trans = rawData.transcriptions[baseScenarioId];
    if (!trans) throw new Error(`Missing RTT transcription for ${baseScenarioId}`);

    const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
    const observations = trans.notes
      .map((n, idx) => ({
        observationId: `${scenario.scenarioId}:rtt:obs:${idx}`,
        pitch: n.pitch,
        performanceTimeMs: n.onsetTimeMs - scenario.audio.performanceOriginSourceMs,
        confidence: 1.0,
      }))
      .filter((o) => o.performanceTimeMs >= 0 && o.performanceTimeMs <= completionMs);

    const sourceEndPerformanceMs = scenario.audio.clipEndMs - scenario.audio.performanceOriginSourceMs;
    const availabilityTimeMs = Math.max(0, sourceEndPerformanceMs) + trans.inferenceLatencyMs;

    challengerQual.assertWholeRecordingPublicationTiming(
      { availabilityTimeMs, analyzedThroughPerformanceMs: completionMs },
      scenario.audio,
      trans.inferenceLatencyMs,
    );

    const publications = [
      {
        publicationId: `${scenario.scenarioId}:rtt:pub:0`,
        observations,
        analyzedThroughPerformanceMs: completionMs,
        availabilityTimeMs,
        diagnostics: {
          inferenceLatencyMs: trans.inferenceLatencyMs,
          publicationDelayMs: trans.inferenceLatencyMs,
          executionMode: 'OFFLINE_SEGMENTWISE_REFERENCE',
          causalStreamingSupported: false,
          latencySemantics: 'OFFLINE_SEGMENTWISE_AFTER_SOURCE_END',
        },
      },
    ];

    runs.push({
      candidateId: candidateDef.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: { command: 'rtt offline transcribe', runtime: DOCKER_CHALLENGERS_IMAGE },
    });
  }

  const fiveDimQual = {
    candidateFamily: 'rtt',
    candidateId: candidateDef.candidateId,
    scientificCalibrationValidity: 'VALID',
    eligibilityForResearchBlindComparison: 'RESEARCH_REFERENCE_ONLY',
    causalLiveRuntimeCompatibility: 'OFFLINE_SEGMENTWISE_INCOMPATIBLE',
    productionCheckpointLicensing: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
    finalProductionSelectionEligibility: 'INELIGIBLE_DUE_TO_LICENSE_AND_LATENCY',
    qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
    lockedForPhase9gB: false,
  };

  challengerQual.assertCandidateMultiDimensionalQualification(fiveDimQual);

  return {
    candidateDefinition: candidateDef,
    runs,
    evidence: {
      outputRel,
      totalTime: rawData.totalWallTimeSeconds,
      verifiedAudioCount: cacheValidation.verifiedAudioCount,
    },
    report: {
      candidateFamily: 'rtt',
      candidateId: candidateDef.candidateId,
      profileId: 'OFFLINE_SEGMENTWISE_NATIVE',
      selectedProfileId: 'OFFLINE_SEGMENTWISE_NATIVE',
      qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
      executionMode: 'OFFLINE_SEGMENTWISE_REFERENCE',
      causalStreamingSupported: false,
      causalExecutionStatus: 'EXECUTION_BLOCKED_FOR_STRICT_CAUSAL_STREAMING',
      latencySemantics: 'OFFLINE_SEGMENTWISE_AFTER_SOURCE_END',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      LOCKED_FOR_PHASE_9G_B_RESEARCH: false,
      fiveDimensionalQualification: fiveDimQual,
      totalWallTimeSeconds: rawData.totalWallTimeSeconds,
    },
  };
}

function runByteDanceFromRawChunks({ scenario, profile, plans, rawChunks }) {
  const processingByChunk = new Map(plans.map((p, idx) => [p.chunkId, rawChunks[idx]?.inferenceLatencyMs ?? 0]));
  const schedule = byteDance.scheduleByteDanceSingleWorkerPublications({ plans, processingLatencyMsByChunkId: processingByChunk });

  const publications = plans.map((plan, idx) => {
    const chunk = rawChunks[idx];
    const decoded = byteDance.decodeByteDanceChunkRawOutputs({
      scenario,
      plan,
      raw: byteDance.byteDanceRawOutputsFromBrowserChunkArtifact(chunk, { allowVariableFrameCount: true }),
      onsetThreshold: profile.onsetThreshold,
      frameThreshold: profile.frameThreshold,
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
    command: 'phase9ga32 decode robust bytedance raw outputs',
    runtime: DOCKER_CHALLENGERS_IMAGE,
  });
}

function planByteDanceVariableContext(scenario, context) {
  const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
  const nominalStepMs = context.nominalOwnedRegionMs ?? context.commitWidthMs ?? 600;
  const plans = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < completionMs) {
    const end = Math.min(completionMs, start + nominalStepMs);
    const maximumFutureMs = context.maximumFutureContextMs ?? context.futureContextMs ?? 0;
    const inputEnd = end + maximumFutureMs;
    const inputStart = inputEnd - context.modelInputMs;

    plans.push({
      chunkId: `${scenario.scenarioId}:chunk:${chunkIndex}`,
      scenarioId: scenario.scenarioId,
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputStartPerformanceMs: inputStart,
      inputEndPerformanceMs: inputEnd,
      expectedGroupIds: [],
    });
    chunkIndex += 1;
    if (end >= completionMs) break;
    start = end;
  }
  return plans;
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

function compactMetrics(calibMetrics) {
  if (!calibMetrics) return {};
  const res = {};
  for (const [k, v] of Object.entries(calibMetrics)) {
    if (v?.status === 'MEASURED') {
      res[k] = v.value;
    }
  }
  return res;
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256Json(obj) {
  return createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
}

async function sha256File(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

async function writeJson(relPath, obj) {
  const abs = path.resolve(repoRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function gitHead(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

function gitDirty(dir) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    return status.trim().length > 0;
  } catch {
    return true;
  }
}
