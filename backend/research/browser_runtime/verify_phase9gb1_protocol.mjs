/**
 * Phase 9G-B.1 Independent Protocol Verifier.
 *
 * Independently validates all 12 frozen blind evaluation protocol requirements
 * prior to any blind inference execution:
 * 1. Source policy, protocol, and manifest SHA256 identities & performer isolation (Check 1)
 * 2. Complete exact candidate registry identities & multi-dimensional qualification (Check 2)
 * 3. Immutable incumbent profile configurations in A.2.5 registry (Check 3)
 * 4. Incumbent metrics mapped to correct frozen profiles via direct historical extraction (Check 4)
 * 5. Diagnostic paired denominators & exact scenario set intersections (Check 5)
 * 6. Required measured comparison classification fields, safety contract & CI plausibility (Check 6)
 * 7. Cache evidence status and provenance classification against disk manifests (Check 7)
 * 8. Score-independence receipt meaning & narrow observation equivalence (Check 8)
 * 9. Admission roster and three officially admitted ranked candidate locks (Check 9)
 * 10. Synthetic-data protocol rehearsal execution and verification (Check 10)
 * 11. Absence of a production winner & microphone inactive (Check 11)
 * 12. Blind evaluation not yet executed (run count == 0) & candidate inference blocked (Check 12)
 *
 * Preflight Protocol Outcome:
 * - PASS: 'PHASE_9GB1_PROTOCOL_FROZEN_AWAITING_EXPLICIT_BLIND_INFERENCE_AUTHORIZATION'
 * - FAIL: 'PHASE_9GB1_PROTOCOL_VERIFICATION_FAILED'
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const challengerQual = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));

// Source File Paths
export const V5_POLICY_REL = 'backend/research/policies/public_model_calibration_protocol_v5_2026-10-09.json';
export const V1_POLICY_REL = 'backend/research/policies/public_challenger_qualification_protocol_v1_2026-10-09.json';
export const V2_POLICY_REL = 'backend/research/policies/public_challenger_qualification_protocol_v2_2026-10-10.json';
export const B1_PROTOCOL_REL = 'backend/research/policies/phase9g_b_blind_evaluation_protocol_v1_2026-10-10.json';
export const A25_REGISTRY_REL = 'backend/research/reports/phase9g_a25_final_incumbent_registry_2026-10-09.json';
export const A1_SCENARIOS_REL = 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json';
export const BLIND_MANIFEST_REL = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json';

export const A23_REPORT_REL = 'backend/research/reports/phase9g_a23_bytedance_online_amt_incumbent_completion_2026-10-09.json';
export const A24_REPORT_REL = 'backend/research/reports/phase9g_a24_bytedance_online_amt_incumbent_completion_2026-10-09.json';
export const A24_RAW_MANIFEST_REL = 'backend/research/reports/phase9g_a24_bytedance_raw_evidence_manifest_2026-10-09.json';

export const A32_REGISTRY_REL = 'backend/research/reports/phase9g_a32_final_candidate_registry_2026-10-10.json';
export const A32_MATRIX_REL = 'backend/research/reports/phase9g_a32_diagnostic_pairwise_matrix_2026-10-10.json';
export const A32_ELIGIBILITY_REL = 'backend/research/reports/phase9g_a32_context_eligibility_manifest_2026-10-10.json';
export const A32_AUDIT_REL = 'backend/research/reports/phase9g_a32_score_independence_audit_receipt_2026-10-10.json';
export const A32_RAW_VERIF_REL = 'backend/research/reports/phase9g_a32_raw_evidence_verification_receipt_2026-10-10.json';

// Target B.1 Artifacts to verify
export const B1_RECONCILIATION_RECEIPT_REL = 'backend/research/reports/phase9g_b1_evidence_reconciliation_receipt_2026-10-10.json';
export const B1_FINAL_REGISTRY_REL = 'backend/research/reports/phase9g_b1_final_candidate_registry_2026-10-10.json';
export const B1_PAIRWISE_MATRIX_REL = 'backend/research/reports/phase9g_b1_diagnostic_pairwise_matrix_2026-10-10.json';
export const B1_ADMISSION_ROSTER_REL = 'backend/research/reports/phase9g_b1_candidate_admission_roster_2026-10-10.json';
export const B1_CACHE_EVIDENCE_REL = 'backend/research/reports/phase9g_b1_cache_evidence_verification_receipt_2026-10-10.json';
export const B1_SCORE_INDEPENDENCE_REL = 'backend/research/reports/phase9g_b1_score_independence_verification_receipt_2026-10-10.json';
export const B1_PRE_BLIND_LOCK_REL = 'backend/research/reports/phase9g_b1_pre_blind_lock_receipt_2026-10-10.json';
export const B1_REHEARSAL_RECEIPT_REL = 'backend/research/reports/phase9g_b1_rehearsal_receipt_2026-10-10.json';
export const B1_PROTOCOL_FREEZE_REPORT_REL = 'backend/research/reports/phase9g_b1_protocol_freeze_report_2026-10-10.json';

// Expected Content Digests
export const EXPECTED_HASHES = {
  v5Policy: '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6',
  v1Policy: '0ccd4872d6998b67d794baf96cad22c5ccbba3f8ee65a9ac02ba1ad9790ec71b',
  v2Policy: 'b467e9aad917808f307346482477d1d4a4716aed665bd2662e87445231d12f8c',
  b1Protocol: '06d9811ad830bebbd0e3161c424c15ee04282756479d80868ae8aa29e6bdafb0',
  a25Registry: '935fc1df28652b0927bc788e43e4ff89a2b9f76c2d0b5c7f58e307c5570d2439',
  a1Scenarios: '56ef9dfcbb3cfbb64b8e87f9f4dd2d3a519be14412b4908f836926375560067e',
  blindManifest: '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab',
};

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export async function sha256File(relPath) {
  const fullPath = path.resolve(repoRoot, relPath);
  const buf = await readFile(fullPath);
  return sha256Buffer(buf);
}

export async function readJson(relPath) {
  const fullPath = path.resolve(repoRoot, relPath);
  if (!existsSync(fullPath)) {
    throw new Error(`FILE_NOT_FOUND:${relPath}`);
  }
  return JSON.parse(await readFile(fullPath, 'utf8'));
}

export async function writeJson(relPath, data) {
  const fullPath = path.resolve(repoRoot, relPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Wrote: ${relPath}`);
}

export async function verifyPhase9gb1Protocol({ gitHead, dirty }) {
  console.log('=== Phase 9G-B.1: Independent Protocol Verifier ===');

  const checks = [];

  // -------------------------------------------------------------------------
  // Check 1: Immutable Source Policies, Protocols, and Manifest Identities
  // -------------------------------------------------------------------------
  console.log('[Check 1/12] Verifying source policies, protocol, and manifest hashes...');
  const v5ActualSha = await sha256File(V5_POLICY_REL);
  const v1ActualSha = await sha256File(V1_POLICY_REL);
  const v2ActualSha = await sha256File(V2_POLICY_REL);
  const b1ActualSha = await sha256File(B1_PROTOCOL_REL);
  const a25ActualSha = await sha256File(A25_REGISTRY_REL);
  const a1ActualSha = await sha256File(A1_SCENARIOS_REL);
  const blindActualSha = await sha256File(BLIND_MANIFEST_REL);

  const hashMismatches = [];
  if (v5ActualSha !== EXPECTED_HASHES.v5Policy) hashMismatches.push(`V5 policy hash mismatch: ${v5ActualSha} !== ${EXPECTED_HASHES.v5Policy}`);
  if (v1ActualSha !== EXPECTED_HASHES.v1Policy) hashMismatches.push(`V1 policy hash mismatch: ${v1ActualSha} !== ${EXPECTED_HASHES.v1Policy}`);
  if (v2ActualSha !== EXPECTED_HASHES.v2Policy) hashMismatches.push(`V2 policy hash mismatch: ${v2ActualSha} !== ${EXPECTED_HASHES.v2Policy}`);
  if (b1ActualSha !== EXPECTED_HASHES.b1Protocol) hashMismatches.push(`Phase 9G-B protocol hash mismatch: ${b1ActualSha} !== ${EXPECTED_HASHES.b1Protocol}`);
  if (a25ActualSha !== EXPECTED_HASHES.a25Registry) hashMismatches.push(`A.2.5 registry hash mismatch: ${a25ActualSha} !== ${EXPECTED_HASHES.a25Registry}`);
  if (a1ActualSha !== EXPECTED_HASHES.a1Scenarios) hashMismatches.push(`A.1 calibration manifest hash mismatch: ${a1ActualSha} !== ${EXPECTED_HASHES.a1Scenarios}`);
  if (blindActualSha !== EXPECTED_HASHES.blindManifest) hashMismatches.push(`Blind manifest hash mismatch: ${blindActualSha} !== ${EXPECTED_HASHES.blindManifest}`);

  const blindManifestObj = await readJson(BLIND_MANIFEST_REL);
  const calibManifestObj = await readJson(A1_SCENARIOS_REL);

  const blindPerformers = new Set(blindManifestObj.includedPerformers ?? blindManifestObj.scenarioReceipts?.map((s) => s.performanceId.split('_').pop()));
  const calibPerformers = new Set(calibManifestObj.includedPerformers ?? calibManifestObj.scenarioReceipts?.map((s) => s.performanceId.split('_').pop()));

  const expectedBlind = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'];
  const expectedCalib = ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'];

  for (const p of expectedBlind) {
    if (!blindPerformers.has(p)) hashMismatches.push(`Blind manifest missing expected performer ${p}`);
    if (calibPerformers.has(p)) hashMismatches.push(`Calibration manifest contains blind performer ${p} (LEAKAGE)`);
  }
  for (const p of expectedCalib) {
    if (!calibPerformers.has(p)) hashMismatches.push(`Calibration manifest missing expected performer ${p}`);
    if (blindPerformers.has(p)) hashMismatches.push(`Blind manifest contains calibration performer ${p}`);
  }

  if (hashMismatches.length > 0) {
    throw new Error(`SOURCE_POLICY_AND_MANIFEST_HASH_IDENTITIES_FAILED:\n${hashMismatches.join('\n')}`);
  }

  checks.push({
    checkId: 'CHECK_1_IMMUTABLE_SOURCE_POLICIES_AND_MANIFESTS_IDENTITIES',
    status: 'PASS',
    details: {
      v5PolicySha: v5ActualSha,
      v1PolicySha: v1ActualSha,
      v2PolicySha: v2ActualSha,
      b1ProtocolSha: b1ActualSha,
      a25RegistrySha: a25ActualSha,
      a1CalibrationManifestSha: a1ActualSha,
      blindManifestSha: blindActualSha,
      calibrationScenarioCount: calibManifestObj.scenarioReceipts?.length ?? 72,
      blindScenarioCount: blindManifestObj.scenarioReceipts?.length ?? 72,
      performerIsolationVerified: true,
    },
  });

  // -------------------------------------------------------------------------
  // Check 2: Complete Exact Candidate Registry Identities
  // -------------------------------------------------------------------------
  console.log('[Check 2/12] Verifying complete exact candidate registry identities...');
  const b1Registry = await readJson(B1_FINAL_REGISTRY_REL);

  if (b1Registry.phase !== '9G-B.1') throw new Error(`Invalid registry phase: ${b1Registry.phase}`);
  if (b1Registry.productionWinnerSelected !== false) throw new Error('Registry falsely selected a production winner!');
  if (!Array.isArray(b1Registry.candidates) || b1Registry.candidates.length !== 7) {
    throw new Error(`Registry candidate roster must contain exactly 7 candidates, found ${b1Registry.candidates?.length}`);
  }

  for (const c of b1Registry.candidates) {
    challengerQual.assertCandidateRegistryIdentitiesExact(c);
    challengerQual.assertCandidateMultiDimensionalQualification({
      candidateFamily: c.candidateFamily,
      candidateId: c.candidateId,
      ...c.fiveDimensionalQualification,
      qualificationStatus: c.qualificationStatus,
      lockedForPhase9gB: c.lockedForPhase9gB,
    });
  }

  checks.push({
    checkId: 'CHECK_2_COMPLETE_EXACT_CANDIDATE_REGISTRY_IDENTITIES',
    status: 'PASS',
    details: {
      totalCandidates: b1Registry.candidates.length,
      frozenIncumbentsCount: b1Registry.candidates.filter((c) => c.category === 'FROZEN_INCUMBENT').length,
      qualifiedChallengersCount: b1Registry.candidates.filter((c) => c.category === 'QUALIFIED_CHALLENGER').length,
      researchReferenceCount: b1Registry.candidates.filter((c) => c.category === 'RESEARCH_REFERENCE_ONLY').length,
      blockedCandidatesCount: b1Registry.candidates.filter((c) => c.category === 'EXECUTION_BLOCKED').length,
      candidates: b1Registry.candidates.map((c) => ({
        id: c.candidateId,
        profileId: c.profileId,
        configSha256: c.configurationSha256,
        category: c.category,
        lockedForPhase9gB: c.lockedForPhase9gB,
      })),
    },
  });

  // -------------------------------------------------------------------------
  // Check 3: Immutable Incumbent Profile Configurations in A.2.5 Registry
  // -------------------------------------------------------------------------
  console.log('[Check 3/12] Verifying immutable incumbent profile configurations...');
  const a25Registry = await readJson(A25_REGISTRY_REL);
  const a25Profiles = a25Registry.profiles;
  if (!Array.isArray(a25Profiles) || a25Profiles.length !== 2) {
    throw new Error('A.2.5 registry must contain exactly 2 incumbent profiles');
  }

  const byteDanceOriginalProfile = a25Profiles.find((p) => p.candidateId === 'bytedance-original-calibrated-v1');
  const onlineAmtProfile = a25Profiles.find((p) => p.candidateId === 'online-amt-calibrated-v1');

  if (!byteDanceOriginalProfile) throw new Error('Missing ByteDance Original in A.2.5 registry');
  if (!onlineAmtProfile) throw new Error('Missing Online-AMT in A.2.5 registry');

  if (byteDanceOriginalProfile.profileId !== 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10') {
    throw new Error(`ByteDance Original profile ID mismatch in A.2.5 registry: ${byteDanceOriginalProfile.profileId}`);
  }
  if (byteDanceOriginalProfile.configurationSha256 !== '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285') {
    throw new Error(`ByteDance Original config SHA mismatch: ${byteDanceOriginalProfile.configurationSha256}`);
  }
  if (byteDanceOriginalProfile.checkpointSha256 !== 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141') {
    throw new Error(`ByteDance Original checkpoint SHA mismatch: ${byteDanceOriginalProfile.checkpointSha256}`);
  }

  if (onlineAmtProfile.profileId !== 'online-amt-calibration-native-boost-1') {
    throw new Error(`Online-AMT profile ID mismatch in A.2.5 registry: ${onlineAmtProfile.profileId}`);
  }
  if (onlineAmtProfile.configurationSha256 !== '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375') {
    throw new Error(`Online-AMT config SHA mismatch: ${onlineAmtProfile.configurationSha256}`);
  }
  if (onlineAmtProfile.checkpointSha256 !== '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0') {
    throw new Error(`Online-AMT checkpoint SHA mismatch: ${onlineAmtProfile.checkpointSha256}`);
  }

  checks.push({
    checkId: 'CHECK_3_IMMUTABLE_INCUMBENT_PROFILE_CONFIGURATIONS',
    status: 'PASS',
    details: {
      byteDanceOriginal: {
        profileId: byteDanceOriginalProfile.profileId,
        configurationSha256: byteDanceOriginalProfile.configurationSha256,
        checkpointSha256: byteDanceOriginalProfile.checkpointSha256,
      },
      onlineAmt: {
        profileId: onlineAmtProfile.profileId,
        configurationSha256: onlineAmtProfile.configurationSha256,
        checkpointSha256: onlineAmtProfile.checkpointSha256,
      },
    },
  });

  // -------------------------------------------------------------------------
  // Check 4: Incumbent Metrics Mapped to Correct Frozen Profiles via Direct Historical Extraction
  // -------------------------------------------------------------------------
  console.log('[Check 4/12] Verifying incumbent metrics mapped to correct frozen profiles...');
  const a23Report = await readJson(A23_REPORT_REL);
  const a24Report = await readJson(A24_REPORT_REL);

  const bdCand = b1Registry.candidates.find((c) => c.candidateId === 'bytedance-original-calibrated-v1');
  const amtCand = b1Registry.candidates.find((c) => c.candidateId === 'online-amt-calibrated-v1');

  if (!bdCand?.reconciledMetrics) throw new Error('Missing reconciled metrics for ByteDance Original');
  if (!amtCand?.reconciledMetrics) throw new Error('Missing reconciled metrics for Online-AMT');

  const bdReconciledWrapper = {
    candidateId: bdCand.candidateId,
    profileId: bdCand.profileId,
    configurationSha256: bdCand.configurationSha256,
    sourceReportPath: A23_REPORT_REL,
    sourceReportSha256: await sha256File(A23_REPORT_REL),
    metrics: bdCand.reconciledMetrics,
  };
  const amtReconciledWrapper = {
    candidateId: amtCand.candidateId,
    profileId: amtCand.profileId,
    configurationSha256: amtCand.configurationSha256,
    sourceReportPath: A24_REPORT_REL,
    sourceReportSha256: await sha256File(A24_REPORT_REL),
    metrics: amtCand.reconciledMetrics,
  };

  const bdProfileKey = 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10';
  const a23Metrics = a23Report.byteDance?.metrics?.[bdProfileKey]?.CALIBRATION;
  if (!a23Metrics) throw new Error('A.2.3 report missing ByteDance .20/.10 metrics');
  if (bdCand.reconciledMetrics.expectedStrikeRecall.numerator !== a23Metrics.expectedStrikeRecall.numerator ||
      bdCand.reconciledMetrics.expectedStrikeRecall.denominator !== a23Metrics.expectedStrikeRecall.denominator) {
    throw new Error('BYTE_DANCE_INCUMBENT_METRICS_DIVERGE_FROM_A23_SOURCE_REPORT');
  }

  const amtPolicyResult = a24Report.onlineAmt?.policyResults?.find((p) => p.profileId === 'online-amt-calibration-native-boost-1');
  const a24Metrics = amtPolicyResult?.metrics?.CALIBRATION;
  if (!a24Metrics) throw new Error('A.2.4 report missing Online-AMT native-boost-1 metrics');
  if (amtCand.reconciledMetrics.expectedStrikeRecall.numerator !== a24Metrics.expectedStrikeRecall.numerator ||
      amtCand.reconciledMetrics.expectedStrikeRecall.denominator !== a24Metrics.expectedStrikeRecall.denominator) {
    throw new Error('ONLINE_AMT_INCUMBENT_METRICS_DIVERGE_FROM_A24_SOURCE_REPORT');
  }

  challengerQual.assertReconciledIncumbentMetricsValid(bdReconciledWrapper);
  challengerQual.assertReconciledIncumbentMetricsValid(amtReconciledWrapper);

  checks.push({
    checkId: 'CHECK_4_INCUMBENT_METRICS_DYNAMIC_HISTORICAL_VERIFICATION',
    status: 'PASS',
    details: {
      byteDanceOriginal: {
        sourceReport: A23_REPORT_REL,
        recall: `${bdCand.reconciledMetrics.expectedStrikeRecall.numerator}/${bdCand.reconciledMetrics.expectedStrikeRecall.denominator} (${(bdCand.reconciledMetrics.expectedStrikeRecall.value * 100).toFixed(2)}%)`,
        verdict: `${bdCand.reconciledMetrics.verdictAgreementRate.numerator}/${bdCand.reconciledMetrics.verdictAgreementRate.denominator} (${(bdCand.reconciledMetrics.verdictAgreementRate.value * 100).toFixed(2)}%)`,
      },
      onlineAmt: {
        sourceReport: A24_REPORT_REL,
        recall: `${amtCand.reconciledMetrics.expectedStrikeRecall.numerator}/${amtCand.reconciledMetrics.expectedStrikeRecall.denominator} (${(amtCand.reconciledMetrics.expectedStrikeRecall.value * 100).toFixed(2)}%)`,
        verdict: `${amtCand.reconciledMetrics.verdictAgreementRate.numerator}/${amtCand.reconciledMetrics.verdictAgreementRate.denominator} (${(amtCand.reconciledMetrics.verdictAgreementRate.value * 100).toFixed(2)}%)`,
      },
    },
  });

  // -------------------------------------------------------------------------
  // Check 5: Diagnostic Paired Denominators & Exact Set Intersections
  // -------------------------------------------------------------------------
  console.log('[Check 5/12] Verifying diagnostic paired denominators & exact intersections...');
  const b1Matrix = await readJson(B1_PAIRWISE_MATRIX_REL);
  const a32Eligibility = await readJson(A32_ELIGIBILITY_REL);

  const robust1820EligibleIds = a32Eligibility.records
    .filter((r) => r.contextProfileId === 'CALIBRATED_CONTEXT_1820' && r.isEligible)
    .map((r) => r.scenarioId);

  const wholeRecordingEligibleIds = a32Eligibility.records
    .filter((r) => r.candidateFamily === 'transkun' && r.isEligible)
    .map((r) => r.scenarioId);

  if (robust1820EligibleIds.length !== 61) {
    throw new Error(`Expected 61 eligible scenarios for Robust ByteDance, got ${robust1820EligibleIds.length}`);
  }
  if (wholeRecordingEligibleIds.length !== 72) {
    throw new Error(`Expected 72 eligible scenarios for whole-recording models, got ${wholeRecordingEligibleIds.length}`);
  }

  const candidateEligibleMap = {
    'bytedance-robust-augmented-calibrated-v1': robust1820EligibleIds,
    'transkun-v2-aug-calibrated-v1': wholeRecordingEligibleIds,
    'aria-amt-medium-double-v1': wholeRecordingEligibleIds,
    'rtt-causal-streaming-v1': wholeRecordingEligibleIds,
  };

  for (const comp of b1Matrix.comparisons) {
    const isIncumbentA = comp.candidateA.includes('bytedance-original') || comp.candidateA.includes('online-amt');
    const isIncumbentB = comp.candidateB.includes('bytedance-original') || comp.candidateB.includes('online-amt');

    if (isIncumbentA || isIncumbentB) {
      if (comp.status !== 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE') {
        throw new Error(`Incumbent comparison ${comp.candidateA} vs ${comp.candidateB} must have status INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE, got ${comp.status}`);
      }
      continue;
    }

    if (comp.status !== 'MEASURED') {
      throw new Error(`Challenger comparison ${comp.candidateA} vs ${comp.candidateB} must have status MEASURED, got ${comp.status}`);
    }

    const eligibleA = candidateEligibleMap[comp.candidateA];
    const eligibleB = candidateEligibleMap[comp.candidateB];

    if (!eligibleA || !eligibleB) {
      throw new Error(`Missing eligible ID set for candidates ${comp.candidateA} or ${comp.candidateB}`);
    }

    // Verify exact set intersection
    challengerQual.assertScenarioSetIntersectionExact(eligibleA, eligibleB, comp.mutuallyEligibleScenarioIds);

    // Verify container denominators
    challengerQual.assertPairwiseMatrixDenominatorsValid(comp);
  }

  checks.push({
    checkId: 'CHECK_5_DIAGNOSTIC_PAIRED_DENOMINATORS_AND_EXACT_INTERSECTIONS',
    status: 'PASS',
    details: {
      totalComparisons: b1Matrix.comparisons.length,
      measuredComparisons: b1Matrix.comparisons.filter((c) => c.status === 'MEASURED').length,
      insufficientEvidenceComparisons: b1Matrix.comparisons.filter((c) => c.status === 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE').length,
      robustByteDanceEligibleCount: 61,
      wholeRecordingEligibleCount: 72,
      exactIntersectionVerifiedAcrossAllComparisons: true,
    },
  });

  // -------------------------------------------------------------------------
  // Check 6: Required Measured Comparison Classification Fields & Safety Contract
  // -------------------------------------------------------------------------
  console.log('[Check 6/12] Verifying measured comparison classification fields & safety contract...');
  const priorityMetrics = [
    'verdictAgreementRate',
    'expectedStrikeRecall',
    'falseMatchRateOnGroundTruthMissing',
    'correctMissingRate',
    'falseCompleteChordAcceptanceRate',
    'chordExactCompletenessRate',
    'extraPrecision',
    'extraRecall',
  ];

  for (const comp of b1Matrix.comparisons) {
    if (comp.status !== 'MEASURED') continue;

    challengerQual.assertRequiredSafetyMetricsPresent(comp.metrics);

    for (const mKey of priorityMetrics) {
      const m = comp.metrics[mKey];
      if (!m) throw new Error(`Missing metric ${mKey} in comparison ${comp.candidateA} vs ${comp.candidateB}`);

      if (m.sampleCount <= 0) {
        throw new Error(`Zero sample count in measured comparison ${comp.candidateA} vs ${comp.candidateB} for ${mKey}`);
      }
      if (typeof m.meanDifference !== 'number') {
        throw new Error(`Invalid meanDifference in ${comp.candidateA} vs ${comp.candidateB} for ${mKey}`);
      }

      // Assert CI plausibility
      challengerQual.assertBootstrapCiMathematicallyPlausible(m.meanDifference, m.bootstrap95Ci);

      // Assert statistical evidence classification
      challengerQual.assertStatisticalEvidenceClassificationValid({
        provenance: m.statisticalEvidenceClassification,
        scenarioLevelVectorsAvailable: false, // challenger bakeoff comparisons are source-aggregate verified from A.3.2, not raw scenario bootstrap rerun
      });

      if (!m.effectClassification) throw new Error(`Missing effectClassification for ${comp.candidateA} vs ${comp.candidateB} on ${mKey}`);
      if (m.isMeaningfulDifference === undefined) throw new Error(`Missing isMeaningfulDifference for ${comp.candidateA} vs ${comp.candidateB} on ${mKey}`);
      if (m.isStatisticallySignificant === undefined) throw new Error(`Missing isStatisticallySignificant for ${comp.candidateA} vs ${comp.candidateB} on ${mKey}`);
      if (!m.practicalInterpretation) throw new Error(`Missing practicalInterpretation for ${comp.candidateA} vs ${comp.candidateB} on ${mKey}`);
    }

    // Verify timing & latency status fields
    if (comp.metrics.timingAbsoluteMedianMs?.status !== 'NOT_EVALUATED') {
      throw new Error(`timingAbsoluteMedianMs must be NOT_EVALUATED in ${comp.candidateA} vs ${comp.candidateB}`);
    }
    if (comp.metrics.timingAbsoluteP95Ms?.status !== 'NOT_EVALUATED') {
      throw new Error(`timingAbsoluteP95Ms must be NOT_EVALUATED in ${comp.candidateA} vs ${comp.candidateB}`);
    }
    if (comp.metrics.finalizedFeedbackAgeP50Ms?.status !== 'LATENCY_NOT_COMPARABLE') {
      throw new Error(`finalizedFeedbackAgeP50Ms must be LATENCY_NOT_COMPARABLE in ${comp.candidateA} vs ${comp.candidateB}`);
    }

    // Verify cross family no-winner invariant
    challengerQual.assertNoBelowThresholdCrossFamilyWinner(comp);
  }

  // Verify pairwise reversal invariant across all measured pairs
  for (const cAB of b1Matrix.comparisons) {
    if (cAB.status !== 'MEASURED') continue;
    const cBA = b1Matrix.comparisons.find((c) => c.candidateA === cAB.candidateB && c.candidateB === cAB.candidateA);
    if (cBA && cBA.status === 'MEASURED') {
      challengerQual.assertPairwiseReversalInvariants(cAB, cBA);
    }
  }

  checks.push({
    checkId: 'CHECK_6_MEASURED_COMPARISON_STATISTICAL_PROVENANCE_AND_SAFETY',
    status: 'PASS',
    details: {
      priorityMetricsEvaluated: priorityMetrics.length,
      allMeasuredComparisonsHaveClassificationFields: true,
      allBootstrapCisPlausible: true,
      statisticalEvidenceClassification: 'SOURCE_AGGREGATE_VERIFIED_ONLY',
      allPairwiseReversalsInverted: true,
      noCrossFamilyWinnerAsserted: true,
    },
  });

  // -------------------------------------------------------------------------
  // Check 7: Cache Evidence Status & Provenance Classification
  // -------------------------------------------------------------------------
  console.log('[Check 7/12] Verifying cache evidence status & provenance classification...');
  const b1CacheEvidence = await readJson(B1_CACHE_EVIDENCE_REL);
  const cacheSummary = b1CacheEvidence.cacheTrustSummary;

  if (!cacheSummary.bytedanceOriginal || !cacheSummary.bytedanceRobustAugmented || !cacheSummary.transkun || !cacheSummary.ariaAmt || !cacheSummary.rtt) {
    throw new Error('Cache trust receipt missing required candidate family summaries');
  }

  // Read back and verify referenced historical manifest/receipt files
  const a24RawManifest = await readJson(A24_RAW_MANIFEST_REL);
  const a24ActualSha = await sha256File(A24_RAW_MANIFEST_REL);
  challengerQual.assertSourceReceiptShaValid(
    '8743b2069553eacd83e81ca956991f3f0c4ffa5ffdadd413bd62996aedc05554',
    a24ActualSha,
    'A.2.4 Raw Evidence Manifest',
  );
  if (a24RawManifest.rowCount !== 300) {
    throw new Error(`Expected 300 rows in A.2.4 raw manifest, got ${a24RawManifest.rowCount}`);
  }

  const a32RawVerif = await readJson(A32_RAW_VERIF_REL);
  const a32ActualSha = await sha256File(A32_RAW_VERIF_REL);
  challengerQual.assertSourceReceiptShaValid(
    '7ee516803628e626cd9aed1701772c8482221520a453a4db2c5667074d0d747f',
    a32ActualSha,
    'A.3.2 Raw Evidence Verification Receipt',
  );
  if (a32RawVerif.verificationSummary.bytedanceRobust.totalWindowsVerified !== 299) {
    throw new Error(`Expected 299 robust windows verified, got ${a32RawVerif.verificationSummary.bytedanceRobust.totalWindowsVerified}`);
  }
  if (a32RawVerif.verificationSummary.transkun.audioFilesVerified !== 24) {
    throw new Error(`Expected 24 transkun audio files verified, got ${a32RawVerif.verificationSummary.transkun.audioFilesVerified}`);
  }

  for (const item of Object.values(cacheSummary)) {
    challengerQual.assertValidCacheProvenanceStatus(item.provenanceStatus);
    challengerQual.assertNoSelfDigestTautology(item.provenanceStatus, item.hasIndependentBaseline);
  }

  if (cacheSummary.bytedanceOriginal.provenanceStatus !== 'MATCHED_TRUSTED_BASELINE') {
    throw new Error(`ByteDance Original must be MATCHED_TRUSTED_BASELINE, got ${cacheSummary.bytedanceOriginal.provenanceStatus}`);
  }
  if (cacheSummary.bytedanceRobustAugmented.provenanceStatus !== 'CONTENT_DIGEST_RECOMPUTED') {
    throw new Error(`Robust ByteDance must be CONTENT_DIGEST_RECOMPUTED, got ${cacheSummary.bytedanceRobustAugmented.provenanceStatus}`);
  }
  if (cacheSummary.transkun.provenanceStatus !== 'CONTENT_DIGEST_RECOMPUTED') {
    throw new Error(`Transkun must be CONTENT_DIGEST_RECOMPUTED, got ${cacheSummary.transkun.provenanceStatus}`);
  }
  if (cacheSummary.ariaAmt.provenanceStatus !== 'CONTENT_DIGEST_RECOMPUTED') {
    throw new Error(`Aria-AMT must be CONTENT_DIGEST_RECOMPUTED, got ${cacheSummary.ariaAmt.provenanceStatus}`);
  }
  if (cacheSummary.rtt.provenanceStatus !== 'CONTENT_DIGEST_RECOMPUTED') {
    throw new Error(`RTT must be CONTENT_DIGEST_RECOMPUTED, got ${cacheSummary.rtt.provenanceStatus}`);
  }

  checks.push({
    checkId: 'CHECK_7_CACHE_EVIDENCE_PROVENANCE_AND_BASELINE_AUTHENTICATION',
    status: 'PASS',
    details: cacheSummary,
  });

  // -------------------------------------------------------------------------
  // Check 8: Score-Independence Receipt Meaning
  // -------------------------------------------------------------------------
  console.log('[Check 8/12] Verifying score-independence receipt meaning...');
  const b1ScoreIndep = await readJson(B1_SCORE_INDEPENDENCE_REL);

  if (b1ScoreIndep.equivalenceLevel !== 'CANONICAL_ACOUSTIC_OBSERVATION_DIGEST_MATCH') {
    throw new Error(`Score independence equivalence level must be CANONICAL_ACOUSTIC_OBSERVATION_DIGEST_MATCH, got ${b1ScoreIndep.equivalenceLevel}`);
  }
  if (!b1ScoreIndep.identicalSourcePcm || !b1ScoreIndep.identicalModelConfiguration || !b1ScoreIndep.identicalReusedRawAcousticOutput || !b1ScoreIndep.identicalCanonicalObservations) {
    throw new Error('Score independence receipt missing required identical execution flags');
  }
  if (b1ScoreIndep.independentRepeatedInferenceExecuted !== false) {
    throw new Error('Score independence falsely claims independent repeated inference!');
  }
  if (b1ScoreIndep.verifiedScenarioPairsByCandidate.bytedanceRobustAugmented !== 40) {
    throw new Error(`Robust ByteDance verified count must be 40, got ${b1ScoreIndep.verifiedScenarioPairsByCandidate.bytedanceRobustAugmented}`);
  }
  if (b1ScoreIndep.verifiedScenarioPairsByCandidate.transkun !== 48) {
    throw new Error(`Transkun verified count must be 48, got ${b1ScoreIndep.verifiedScenarioPairsByCandidate.transkun}`);
  }
  if (b1ScoreIndep.verifiedScenarioPairsByCandidate.ariaAmt !== 48) {
    throw new Error(`Aria-AMT verified count must be 48, got ${b1ScoreIndep.verifiedScenarioPairsByCandidate.ariaAmt}`);
  }
  if (b1ScoreIndep.verifiedScenarioPairsByCandidate.rtt !== 48) {
    throw new Error(`RTT verified count must be 48, got ${b1ScoreIndep.verifiedScenarioPairsByCandidate.rtt}`);
  }

  // Validate actual A.3.2 audit receipt file and canonical digests
  const a32Audit = await readJson(A32_AUDIT_REL);
  const a32AuditActualSha = await sha256File(A32_AUDIT_REL);
  challengerQual.assertSourceReceiptShaValid(
    '8507b12919b3bbe1057c2685782e6db401e5ef52c5cd84c49dbcdec7e34f7ea9',
    a32AuditActualSha,
    'A.3.2 Score Independence Audit Receipt',
  );
  const sampleScenario = 'vienna-secondary-base:Chopin_op10_no3_p08:27.000';
  const expectedObsDigest = a32Audit.canonicalObservationDigests?.bytedanceRobustAugmented?.base?.[sampleScenario];
  if (!expectedObsDigest) {
    throw new Error(`Missing canonical digest for ${sampleScenario} in A.3.2 audit receipt`);
  }
  challengerQual.assertObservationDigestValid(
    'fa5b2ceabf43ace37f89447900810d705be863a6f93a4d8c4c45b336f025ea2b',
    expectedObsDigest,
    sampleScenario,
  );

  checks.push({
    checkId: 'CHECK_8_SCORE_INDEPENDENCE_AUDIT_VERIFICATION',
    status: 'PASS',
    details: {
      equivalenceLevel: b1ScoreIndep.equivalenceLevel,
      identicalSourcePcm: b1ScoreIndep.identicalSourcePcm,
      identicalCanonicalObservations: b1ScoreIndep.identicalCanonicalObservations,
      independentRepeatedInferenceExecuted: b1ScoreIndep.independentRepeatedInferenceExecuted,
      verifiedScenarioPairs: b1ScoreIndep.verifiedScenarioPairsByCandidate,
    },
  });

  // -------------------------------------------------------------------------
  // Check 9: Candidate Admission Roster and Three Officially Admitted Ranked Candidate Locks
  // -------------------------------------------------------------------------
  console.log('[Check 9/12] Verifying candidate admission roster and candidate locks...');
  const b1Admission = await readJson(B1_ADMISSION_ROSTER_REL);
  const b1Lock = await readJson(B1_PRE_BLIND_LOCK_REL);

  for (const r of b1Admission.roster) {
    challengerQual.assertCandidateBlindRolePermitted(r.candidateId, r.permittedBlindRole, r.productionSelectionEligible);
  }

  const lockedCandidates = b1Admission.roster.filter((r) => r.lockedForPhase9gB);
  if (lockedCandidates.length !== 3) {
    throw new Error(`Expected exactly 3 locked candidates for Phase 9G-B, found ${lockedCandidates.length}`);
  }

  const lockedIds = lockedCandidates.map((r) => r.candidateId);
  const expectedLocked = [
    'bytedance-original-calibrated-v1',
    'online-amt-calibrated-v1',
    'bytedance-robust-augmented-calibrated-v1',
  ];
  for (const expId of expectedLocked) {
    if (!lockedIds.includes(expId)) throw new Error(`Missing expected locked candidate: ${expId}`);
  }

  const nonRankingRefs = b1Admission.roster.filter((r) => r.permittedBlindRole.includes('NON_RANKING'));
  if (nonRankingRefs.length !== 3) {
    throw new Error(`Expected exactly 3 non-ranking research references, found ${nonRankingRefs.length}`);
  }

  const blockedCands = b1Admission.roster.filter((r) => r.permittedBlindRole === 'NOT_PERMITTED');
  if (blockedCands.length !== 1 || blockedCands[0].candidateId !== 'd3rm-offline-ceiling-reference') {
    throw new Error('D3RM must be the single NOT_PERMITTED candidate');
  }

  checks.push({
    checkId: 'CHECK_9_ADMISSION_ROSTER_AND_THREE_OFFICIAL_RANKED_CANDIDATE_LOCKS',
    status: 'PASS',
    details: {
      lockedCandidatesCount: lockedCandidates.length,
      lockedCandidates: lockedIds,
      nonRankingReferenceCount: nonRankingRefs.length,
      blockedCandidateCount: blockedCands.length,
    },
  });

  // -------------------------------------------------------------------------
  // Check 10: Synthetic-Data Protocol Rehearsal Verification
  // -------------------------------------------------------------------------
  console.log('[Check 10/12] Verifying synthetic-data protocol rehearsal receipt...');
  const b1Rehearsal = await readJson(B1_REHEARSAL_RECEIPT_REL);

  if (b1Rehearsal.artifact !== 'phase9g_b1_rehearsal_receipt') {
    throw new Error(`Invalid rehearsal receipt artifact: ${b1Rehearsal.artifact}`);
  }
  if (b1Rehearsal.rehearsalMode !== 'SYNTHETIC_DATA_ONLY') {
    throw new Error(`Rehearsal mode must be SYNTHETIC_DATA_ONLY, got ${b1Rehearsal.rehearsalMode}`);
  }
  if (b1Rehearsal.realBlindInferenceExecuted !== false) {
    throw new Error('Rehearsal falsely claims real blind inference execution!');
  }
  if (b1Rehearsal.allTestsPassed !== true) {
    throw new Error('Rehearsal did not pass all tests!');
  }
  if (b1Rehearsal.testsExecuted !== 12 || !Array.isArray(b1Rehearsal.rehearsalResults) || b1Rehearsal.rehearsalResults.length !== 12) {
    throw new Error(`Expected exactly 12 rehearsal test results, found ${b1Rehearsal.rehearsalResults?.length}`);
  }
  for (const t of b1Rehearsal.rehearsalResults) {
    if (t.status !== 'PASS') {
      throw new Error(`Rehearsal test ${t.testId} failed: ${JSON.stringify(t)}`);
    }
  }

  checks.push({
    checkId: 'CHECK_10_SYNTHETIC_DATA_PROTOCOL_REHEARSAL',
    status: 'PASS',
    details: {
      rehearsalMode: b1Rehearsal.rehearsalMode,
      testsExecuted: b1Rehearsal.testsExecuted,
      allTestsPassed: b1Rehearsal.allTestsPassed,
      syntheticScenariosUsed: b1Rehearsal.syntheticScenariosUsed,
      realBlindInferenceExecuted: b1Rehearsal.realBlindInferenceExecuted,
    },
  });

  // -------------------------------------------------------------------------
  // Check 11: Absence of a Production Winner & Microphone Inactive
  // -------------------------------------------------------------------------
  console.log('[Check 11/12] Verifying absence of a production winner & microphone inactive...');
  if (b1Registry.productionWinnerSelected !== false) {
    throw new Error('Production winner falsely selected in candidate registry!');
  }
  if (b1Matrix.productionWinnerSelected !== false) {
    throw new Error('Production winner falsely selected in pairwise matrix!');
  }
  if (b1Admission.productionWinnerSelected !== false) {
    throw new Error('Production winner falsely selected in admission roster!');
  }
  if (b1Lock.noProductionWinnerSelected !== true) {
    throw new Error('noProductionWinnerSelected must be true in pre-blind lock receipt!');
  }
  if (b1Lock.productionMicrophoneActivated !== false) {
    throw new Error('productionMicrophoneActivated must be false in pre-blind lock receipt!');
  }

  checks.push({
    checkId: 'CHECK_11_ABSENCE_OF_A_PRODUCTION_WINNER_AND_MICROPHONE_INACTIVE',
    status: 'PASS',
    details: {
      productionWinnerSelected: false,
      productionMicrophoneActivated: false,
      diagnosticOnlyRole: 'PROTOCOL_FREEZE_REHEARSAL_ONLY',
    },
  });

  // -------------------------------------------------------------------------
  // Check 12: Blind Evaluation Not Yet Executed & Candidate Inference Blocked
  // -------------------------------------------------------------------------
  console.log('[Check 12/12] Verifying blind evaluation not yet executed and inference blocked...');
  if (b1Lock.candidateRunCount !== 0) {
    throw new Error(`Blind evaluation run count must be 0, found ${b1Lock.candidateRunCount}`);
  }
  if (b1Lock.noBlindInferenceExecuted !== true) {
    throw new Error('noBlindInferenceExecuted must be true in pre-blind lock receipt!');
  }

  // Verify that candidate inference in Phase 9G-B.1 is programmatically forbidden by the qualification engine
  let candidateInferenceBlockedProperly = false;
  try {
    challengerQual.assertChallengerExecutionAllowed({
      policy: {
        schemaVersion: 2,
        policyId: 'PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2',
        sha256: EXPECTED_HASHES.v2Policy,
      },
      incumbentPolicySha256: EXPECTED_HASHES.v5Policy,
      phase: '9G-B.1',
      mode: 'CANDIDATE_INFERENCE',
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      candidateFamily: 'bytedance',
      scenarioSplit: 'CALIBRATION',
      performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
      calibrationManifestSha256: EXPECTED_HASHES.a1Scenarios,
      incumbentRegistrySha256: EXPECTED_HASHES.a25Registry,
      blindManifestSha256: EXPECTED_HASHES.blindManifest,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PHASE_9GB1_CANDIDATE_INFERENCE_FORBIDDEN') {
      candidateInferenceBlockedProperly = true;
    } else {
      throw err;
    }
  }

  if (!candidateInferenceBlockedProperly) {
    throw new Error('FAIL_CLOSED_VIOLATION: Candidate inference in Phase 9G-B.1 was not blocked!');
  }

  checks.push({
    checkId: 'CHECK_12_BLIND_EVALUATION_NOT_YET_EXECUTED_AND_INFERENCE_BLOCKED',
    status: 'PASS',
    details: {
      blindCandidateRunCount: 0,
      blindPerformersIsolated: expectedBlind,
      blindInferenceBlockedInPreflight: true,
      phase9gb1CandidateInferenceForbiddenAsserted: true,
    },
  });

  // -------------------------------------------------------------------------
  // Final Protocol Freeze Decision
  // -------------------------------------------------------------------------
  const allPassed = checks.every((c) => c.status === 'PASS');
  const preflightGateOutcome = allPassed
    ? 'PHASE_9GB1_PROTOCOL_FROZEN_AWAITING_EXPLICIT_BLIND_INFERENCE_AUTHORIZATION'
    : 'PHASE_9GB1_PROTOCOL_VERIFICATION_FAILED';

  const protocolFreezeReport = {
    schemaVersion: 1,
    artifact: 'phase9g_b1_protocol_freeze_report',
    phase: '9G-B.1',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtExecution: dirty,
    overallStatus: allPassed ? 'PASS' : 'FAIL',
    preflightGateOutcome,
    frozenProtocolPath: B1_PROTOCOL_REL,
    frozenProtocolSha256: b1ActualSha,
    admittedRankedCandidatesCount: 3,
    nonRankingResearchReferencesCount: 3,
    blockedCandidatesCount: 1,
    candidateRunCount: 0,
    noBlindInferenceExecuted: true,
    checks,
  };

  await writeJson(B1_PROTOCOL_FREEZE_REPORT_REL, protocolFreezeReport);
  console.log(`\n===============================================================`);
  console.log(`  Phase 9G-B.1 Independent Protocol Freeze Verification`);
  console.log(`  Overall Status: ${protocolFreezeReport.overallStatus}`);
  console.log(`  Preflight Gate Outcome: ${preflightGateOutcome}`);
  console.log(`===============================================================\n`);

  return protocolFreezeReport;
}

function getGitHead(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

function getGitDirty(dir) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    return status.trim().length > 0;
  } catch {
    return true;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const allowDirty = process.argv.includes('--allow-dirty');
  const dirty = getGitDirty(repoRoot);
  if (dirty && !allowDirty) {
    throw new Error('PHASE_9GB1_REQUIRES_CLEAN_WORKING_TREE: Commit changes before verifying evidence artifacts.');
  }
  const gitHead = getGitHead(repoRoot);
  challengerQual.assertCleanWorkingTreeIntegrity(dirty, dirty);
  verifyPhase9gb1Protocol({ gitHead, dirty })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
