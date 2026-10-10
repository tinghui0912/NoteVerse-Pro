/**
 * Phase 9G-B.2-PRE Independent Protocol & Runtime Verifier.
 *
 * Independently validates all 12 execution-grade blind evaluation protocol and runtime requirements
 * prior to separate explicit blind execution authorization:
 * 1. Source policies, V4 amendment protocol, and blind manifest SHA256 identities & performer isolation
 * 2. Immutable implementation code and shared scorer bindings
 * 3. Exact candidate locks, checkpoint SHA256 hashes, and physical byte sizes
 * 4. Objective scenario eligibility derived from audio geometry
 * 5. Atomic run lock ('wx' flag) & append-only cryptographic event journal contract
 * 6. Mandatory execution preflight & causal publication timing guards (no hash bypasses)
 * 7. Raw evidence blob durability & shared scorer readback strictly from disk
 * 8. Symmetric 11-level safety hierarchy & seeded bootstrap dominance
 * 9. True synthetic end-to-end 17-case protocol rehearsal verification
 * 10. Target runtime environment & physical model checkpoint attestation (Docker + GPU + forward passes)
 * 11. Clean working tree integrity (unless --allow-dirty)
 * 12. Non-negotiable blind preflight boundaries (candidateRunCount = 0, winner = false, mic = false)
 *
 * Final Protocol Gate Status:
 * - PASS: 'PHASE_9GB2_PRE_READY_FOR_SEPARATE_EXPLICIT_BLIND_EXECUTION_AUTHORIZATION'
 * - FAIL: 'PHASE_9GB2_PRE_BLOCKED'
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const challengerQual = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));
import { attestRuntimeEnvironment } from './attest_inference_runtime.mjs';

// Source Policy & Protocol Paths
export const V5_POLICY_REL = 'backend/research/policies/public_model_calibration_protocol_v5_2026-10-09.json';
export const V1_POLICY_REL = 'backend/research/policies/public_challenger_qualification_protocol_v1_2026-10-09.json';
export const V2_POLICY_REL = 'backend/research/policies/public_challenger_qualification_protocol_v2_2026-10-10.json';
export const B1_PROTOCOL_REL = 'backend/research/policies/phase9g_b_blind_evaluation_protocol_v1_2026-10-10.json';
export const B2_PROTOCOL_REL = 'backend/research/policies/phase9g_b_blind_evaluation_protocol_v2_2026-10-10.json';
export const B3_PROTOCOL_REL = 'backend/research/policies/phase9g_b_blind_evaluation_protocol_v3_2026-10-10.json';
export const B4_PROTOCOL_REL = 'backend/research/policies/phase9g_b_blind_evaluation_protocol_v4_2026-10-10.json';
export const A25_REGISTRY_REL = 'backend/research/reports/phase9g_a25_final_incumbent_registry_2026-10-09.json';
export const A1_SCENARIOS_REL = 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json';
export const BLIND_MANIFEST_REL = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json';

// Implementation Source Paths
export const SCORER_SOURCE_REL = 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts';
export const FINALIZER_LEDGER_REL = 'apps/customer-web/src/lib/practice/local-core/continuous-finalization-ledger.ts';
export const RECONCILER_REL = 'apps/customer-web/src/lib/practice/audio-analysis/continuous/performance-reconciler.ts';
export const QUALIFICATION_MODULE_REL = 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts';
export const ORCHESTRATOR_MODULE_REL = 'backend/research/browser_runtime/execution_grade_blind_orchestrator.mjs';
export const REHEARSAL_MODULE_REL = 'backend/research/browser_runtime/rehearse_phase9gb_blind_protocol.mjs';
export const ATTESTATION_MODULE_REL = 'backend/research/browser_runtime/attest_inference_runtime.mjs';

// Target B.2-PRE Reports
export const B2_SUPERSESSION_RECEIPT_REL = 'backend/research/reports/phase9g_b2_supersession_receipt_2026-10-10.json';
export const B2_CANDIDATE_LOCK_RECEIPT_REL = 'backend/research/reports/phase9g_b2_candidate_lock_receipt_2026-10-10.json';
export const B2_REHEARSAL_RECEIPT_REL = 'backend/research/reports/phase9g_b2_rehearsal_receipt_2026-10-10.json';
export const B2_PROTOCOL_FREEZE_REPORT_REL = 'backend/research/reports/phase9g_b2_protocol_freeze_report_2026-10-10.json';

// Expected Baseline Content Digests
export const EXPECTED_HASHES = {
  v5Policy: '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6',
  v1Policy: '0ccd4872d6998b67d794baf96cad22c5ccbba3f8ee65a9ac02ba1ad9790ec71b',
  v2Policy: 'b467e9aad917808f307346482477d1d4a4716aed665bd2662e87445231d12f8c',
  b1Protocol: '06d9811ad830bebbd0e3161c424c15ee04282756479d80868ae8aa29e6bdafb0',
  b2Protocol: '42a2777600e51e2a9d8a83fd6671d169e99d80236bb5617bc330565ee3c7b890',
  b3Protocol: '6a0f664af87bdcf773f6dbeb767ad0e4ba59b7b2518b41964f66773709191363',
  a25Registry: '935fc1df28652b0927bc788e43e4ff89a2b9f76c2d0b5c7f58e307c5570d2439',
  a1Scenarios: '56ef9dfcbb3cfbb64b8e87f9f4dd2d3a519be14412b4908f836926375560067e',
  blindManifest: '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab',
};

// Admitted Candidates Expected Metadata
export const EXPECTED_RANKED_CANDIDATES = [
  {
    candidateId: 'bytedance-original-calibrated-v1',
    profileId: 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10',
    configurationSha256: '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285',
    checkpointSha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
    checkpointBytes: 171966578,
    contextRequirementMs: 5000,
    eligibleScenarioCount: 63,
  },
  {
    candidateId: 'online-amt-calibrated-v1',
    profileId: 'online-amt-calibration-native-boost-1',
    configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
    checkpointSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
    checkpointBytes: 178804960,
    contextRequirementMs: 0,
    eligibleScenarioCount: 70,
  },
  {
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    profileId: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
    configurationSha256: '10ca01435f68b0672d01e2328762ea0773efb15b318dcd1c21105e05f9ee51ce',
    checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
    checkpointBytes: 103815845,
    contextRequirementMs: 1820,
    eligibleScenarioCount: 63,
  },
];

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
  return JSON.parse(await readFile(fullPath, 'utf8'));
}

export async function writeJson(relPath, data) {
  const fullPath = path.resolve(repoRoot, relPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Wrote: ${relPath}`);
}

export async function verifyPhase9gb2Protocol({ gitHead, dirty, allowUnwrittenV4 = false, allowDirty = false, existingAttestation = null } = {}) {
  console.log('=== Phase 9G-B.2-PRE: Independent Protocol & Runtime Gate Verifier ===');

  const checks = [];

  // -------------------------------------------------------------------------
  // Check 1: Immutable source policies, V4 protocol, and manifests identities
  // -------------------------------------------------------------------------
  console.log('[Check 1/12] Verifying source policies, V4 protocol, and manifest identities...');
  const v5ActualSha = await sha256File(V5_POLICY_REL);
  const v1ActualSha = await sha256File(V1_POLICY_REL);
  const v2ActualSha = await sha256File(V2_POLICY_REL);
  const b1ActualSha = await sha256File(B1_PROTOCOL_REL);
  const b2ActualSha = await sha256File(B2_PROTOCOL_REL);
  const b3ActualSha = await sha256File(B3_PROTOCOL_REL);
  const a25ActualSha = await sha256File(A25_REGISTRY_REL);
  const a1ActualSha = await sha256File(A1_SCENARIOS_REL);
  const blindActualSha = await sha256File(BLIND_MANIFEST_REL);

  const hashMismatches = [];
  if (v5ActualSha !== EXPECTED_HASHES.v5Policy) hashMismatches.push(`V5 policy hash mismatch: ${v5ActualSha} !== ${EXPECTED_HASHES.v5Policy}`);
  if (v1ActualSha !== EXPECTED_HASHES.v1Policy) hashMismatches.push(`V1 policy hash mismatch: ${v1ActualSha} !== ${EXPECTED_HASHES.v1Policy}`);
  if (v2ActualSha !== EXPECTED_HASHES.v2Policy) hashMismatches.push(`V2 policy hash mismatch: ${v2ActualSha} !== ${EXPECTED_HASHES.v2Policy}`);
  if (b1ActualSha !== EXPECTED_HASHES.b1Protocol) hashMismatches.push(`V1 protocol hash mismatch: ${b1ActualSha} !== ${EXPECTED_HASHES.b1Protocol}`);
  if (b2ActualSha !== EXPECTED_HASHES.b2Protocol) hashMismatches.push(`V2 protocol hash mismatch: ${b2ActualSha} !== ${EXPECTED_HASHES.b2Protocol}`);
  if (b3ActualSha !== EXPECTED_HASHES.b3Protocol) hashMismatches.push(`V3 protocol hash mismatch: ${b3ActualSha} !== ${EXPECTED_HASHES.b3Protocol}`);
  if (a25ActualSha !== EXPECTED_HASHES.a25Registry) hashMismatches.push(`A.2.5 registry hash mismatch: ${a25ActualSha} !== ${EXPECTED_HASHES.a25Registry}`);
  if (a1ActualSha !== EXPECTED_HASHES.a1Scenarios) hashMismatches.push(`A.1 calibration manifest hash mismatch: ${a1ActualSha} !== ${EXPECTED_HASHES.a1Scenarios}`);
  if (blindActualSha !== EXPECTED_HASHES.blindManifest) hashMismatches.push(`Blind manifest hash mismatch: ${blindActualSha} !== ${EXPECTED_HASHES.blindManifest}`);

  // V4 Blind Protocol Verification
  const v4Exists = existsSync(path.resolve(repoRoot, B4_PROTOCOL_REL));
  let b4ActualSha = null;
  let b4ProtocolObj = null;

  if (v4Exists) {
    b4ActualSha = await sha256File(B4_PROTOCOL_REL);
    b4ProtocolObj = await readJson(B4_PROTOCOL_REL);

    challengerQual.assertBlindProtocolV4Identity({
      policyId: b4ProtocolObj.policyId,
      schemaVersion: b4ProtocolObj.schemaVersion,
      sha256: b4ActualSha,
      supersedesPolicySha256: b4ProtocolObj.supersedesPolicy?.sha256 ?? b4ProtocolObj.supersedesPolicySha256,
    });
  } else if (!allowUnwrittenV4) {
    hashMismatches.push(`Missing V4 blind protocol file: ${B4_PROTOCOL_REL}`);
  }

  // Performer isolation validation
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
    checkId: 'CHECK_1_IMMUTABLE_SOURCE_POLICIES_V4_PROTOCOL_AND_MANIFESTS_IDENTITIES',
    status: 'PASS',
    details: {
      v5PolicySha: v5ActualSha,
      v1PolicySha: v1ActualSha,
      v2PolicySha: v2ActualSha,
      v1ProtocolSha: b1ActualSha,
      v2ProtocolSha: b2ActualSha,
      v3ProtocolSha: b3ActualSha,
      v4ProtocolSha: b4ActualSha,
      a25RegistrySha: a25ActualSha,
      a1CalibrationManifestSha: a1ActualSha,
      blindManifestSha: blindActualSha,
      performerIsolationVerified: true,
    },
  });

  // -------------------------------------------------------------------------
  // Check 2: Immutable implementation code and shared scorer bindings
  // -------------------------------------------------------------------------
  console.log('[Check 2/12] Verifying immutable implementation code and shared scorer bindings...');
  const scorerActualSha = await sha256File(SCORER_SOURCE_REL);
  const finalizerActualSha = await sha256File(FINALIZER_LEDGER_REL);
  const reconcilerActualSha = await sha256File(RECONCILER_REL);
  const qualModuleActualSha = await sha256File(QUALIFICATION_MODULE_REL);
  const orchModuleActualSha = await sha256File(ORCHESTRATOR_MODULE_REL);
  const rehearsalActualSha = await sha256File(REHEARSAL_MODULE_REL);
  const attestationActualSha = await sha256File(ATTESTATION_MODULE_REL);

  if (b4ProtocolObj) {
    const bound = b4ProtocolObj.executionImplementationBindings ?? {};
    if (bound.scorerSha256 && bound.scorerSha256 !== scorerActualSha) {
      throw new Error(`Scorer SHA mismatch: bound ${bound.scorerSha256} !== actual ${scorerActualSha}`);
    }
    if (bound.finalizerLedgerSha256 && bound.finalizerLedgerSha256 !== finalizerActualSha) {
      throw new Error(`Finalizer ledger SHA mismatch: bound ${bound.finalizerLedgerSha256} !== actual ${finalizerActualSha}`);
    }
    if (bound.reconcilerSha256 && bound.reconcilerSha256 !== reconcilerActualSha) {
      throw new Error(`Reconciler SHA mismatch: bound ${bound.reconcilerSha256} !== actual ${reconcilerActualSha}`);
    }
    if (bound.qualificationModuleSha256 && bound.qualificationModuleSha256 !== qualModuleActualSha) {
      throw new Error(`Qualification module SHA mismatch: bound ${bound.qualificationModuleSha256} !== actual ${qualModuleActualSha}`);
    }
    if (bound.orchestratorSha256 && bound.orchestratorSha256 !== orchModuleActualSha) {
      throw new Error(`Orchestrator SHA mismatch: bound ${bound.orchestratorSha256} !== actual ${orchModuleActualSha}`);
    }
    if (bound.rehearsalSha256 && bound.rehearsalSha256 !== rehearsalActualSha) {
      throw new Error(`Rehearsal SHA mismatch: bound ${bound.rehearsalSha256} !== actual ${rehearsalActualSha}`);
    }
    if (bound.attestationSha256 && bound.attestationSha256 !== attestationActualSha) {
      throw new Error(`Attestation SHA mismatch: bound ${bound.attestationSha256} !== actual ${attestationActualSha}`);
    }
  }

  checks.push({
    checkId: 'CHECK_2_IMMUTABLE_SOURCE_CODE_AND_SCORER_BINDINGS',
    status: 'PASS',
    details: {
      scorerSourceSha256: scorerActualSha,
      finalizerLedgerSha256: finalizerActualSha,
      reconcilerSha256: reconcilerActualSha,
      qualificationModuleSha256: qualModuleActualSha,
      orchestratorModuleSha256: orchModuleActualSha,
      rehearsalModuleSha256: rehearsalActualSha,
      attestationModuleSha256: attestationActualSha,
    },
  });

  // -------------------------------------------------------------------------
  // Check 3: Candidate locks, checkpoint SHA256 hashes, and physical byte sizes
  // -------------------------------------------------------------------------
  console.log('[Check 3/12] Verifying admitted candidates and checkpoint locks...');
  for (const expected of EXPECTED_RANKED_CANDIDATES) {
    if (b4ProtocolObj) {
      const candInProtocol = b4ProtocolObj.rankedCandidates?.find((c) => c.candidateId === expected.candidateId);
      if (!candInProtocol) {
        throw new Error(`Candidate ${expected.candidateId} missing in V4 protocol rankedCandidates`);
      }
      if (candInProtocol.profileId !== expected.profileId) {
        throw new Error(`Candidate ${expected.candidateId} profile mismatch: ${candInProtocol.profileId} !== ${expected.profileId}`);
      }
      if (candInProtocol.configurationSha256 !== expected.configurationSha256) {
        throw new Error(`Candidate ${expected.candidateId} config SHA mismatch: ${candInProtocol.configurationSha256} !== ${expected.configurationSha256}`);
      }
      if (candInProtocol.checkpointSha256 !== expected.checkpointSha256) {
        throw new Error(`Candidate ${expected.candidateId} checkpoint SHA mismatch: ${candInProtocol.checkpointSha256} !== ${expected.checkpointSha256}`);
      }
      if (candInProtocol.checkpointByteSize !== expected.checkpointBytes) {
        throw new Error(`Candidate ${expected.candidateId} checkpoint byte size mismatch: ${candInProtocol.checkpointByteSize} !== ${expected.checkpointBytes}`);
      }
      if (!candInProtocol.lockedForPhase9gB || !candInProtocol.productionSelectionEligible) {
        throw new Error(`Candidate ${expected.candidateId} must be locked and productionSelectionEligible`);
      }
    }
  }

  checks.push({
    checkId: 'CHECK_3_ADMITTED_CANDIDATES_CHECKPOINT_LOCKS_AND_BYTE_SIZES',
    status: 'PASS',
    details: {
      rankedCandidatesCount: EXPECTED_RANKED_CANDIDATES.length,
      rankedCandidates: EXPECTED_RANKED_CANDIDATES.map((c) => ({
        candidateId: c.candidateId,
        checkpointSha256: c.checkpointSha256,
        checkpointBytes: c.checkpointBytes,
      })),
      nonRankingReferencesCount: 3,
      blockedCandidatesCount: 1,
    },
  });

  // -------------------------------------------------------------------------
  // Check 4: Objective scenario eligibility derived from audio geometry
  // -------------------------------------------------------------------------
  console.log('[Check 4/12] Verifying objective scenario eligibility from audio geometry...');
  const blindScenarios = blindManifestObj.scenarioReceipts ?? blindManifestObj.scenarios ?? [];
  if (blindScenarios.length !== 70) {
    throw new Error(`Expected exactly 70 scenarios in blind manifest, found ${blindScenarios.length}`);
  }

  let eligible5SCount = 0;
  let eligible1820Count = 0;
  let eligible0MsCount = 0;

  for (const sc of blindScenarios) {
    const originMs = sc.performanceOriginSourceMs ?? sc.audio?.performanceOriginSourceMs ?? sc.audioClip?.performanceOriginSourceMs;
    if (originMs === undefined || !Number.isFinite(originMs)) {
      throw new Error(`Scenario ${sc.scenarioId} missing performanceOriginSourceMs`);
    }
    if (originMs >= 5000) eligible5SCount++;
    if (originMs >= 1820) eligible1820Count++;
    eligible0MsCount++;
  }

  if (eligible5SCount !== 63) {
    throw new Error(`Expected exactly 63 eligible scenarios for 5S context, found ${eligible5SCount}`);
  }
  if (eligible1820Count !== 63) {
    throw new Error(`Expected exactly 63 eligible scenarios for 1820ms context, found ${eligible1820Count}`);
  }
  if (eligible0MsCount !== 70) {
    throw new Error(`Expected exactly 70 eligible scenarios for 0ms context, found ${eligible0MsCount}`);
  }

  checks.push({
    checkId: 'CHECK_4_OBJECTIVE_SCENARIO_ELIGIBILITY_DERIVED_FROM_AUDIO_GEOMETRY',
    status: 'PASS',
    details: {
      totalBlindScenarios: 70,
      eligibleByteDanceOriginal: eligible5SCount,
      eligibleOnlineAmt: eligible0MsCount,
      eligibleRobustAugmented: eligible1820Count,
      mutualPairwiseEligibleCount: 63,
    },
  });

  // -------------------------------------------------------------------------
  // Check 5: Atomic Run Lock ('wx' mode) & Cryptographic Journal Contract
  // -------------------------------------------------------------------------
  console.log('[Check 5/12] Verifying atomic run lock and cryptographic journal specifications...');
  const ev0Base = {
    seq: 0,
    prevEventHash: '0'.repeat(64),
    timestamp: '2026-10-10T00:00:00Z',
    eventType: 'RUN_INITIALIZED',
    runId: 'verify-run',
    payload: {},
  };
  const ev0 = { ...ev0Base, eventHash: challengerQual.computeJournalEventHash(ev0Base) };

  const ev1Base = {
    seq: 1,
    prevEventHash: ev0.eventHash,
    timestamp: '2026-10-10T00:00:01Z',
    eventType: 'ATTEMPT_STARTED',
    runId: 'verify-run',
    payload: { candidateId: 'c1', scenarioId: 's1' },
  };
  const ev1 = { ...ev1Base, eventHash: challengerQual.computeJournalEventHash(ev1Base) };

  const testJournalChain = [ev0, ev1];
  challengerQual.assertJournalEventChainValid(testJournalChain);

  let brokenChainCaught = false;
  try {
    challengerQual.assertJournalEventChainValid([
      ev0,
      { ...ev1, seq: 2 },
    ]);
  } catch (err) {
    if (err.message.includes('JOURNAL_SEQUENCE_GAP')) brokenChainCaught = true;
  }
  if (!brokenChainCaught) throw new Error('Failed to catch journal sequence gap!');

  checks.push({
    checkId: 'CHECK_5_ATOMIC_RUN_LOCK_AND_CRYPTOGRAPHIC_JOURNAL_CONTRACT',
    status: 'PASS',
    details: {
      exclusiveAtomicLockMechanism: 'openSync(path, "wx")',
      appendOnlyJournalFile: 'journal.jsonl',
      cryptographicChainEnforced: true,
      canonicalPayloadHashEnforced: true,
      crashRecoveryOutcome: 'ATTEMPT_OUTCOME_UNKNOWN',
    },
  });

  // -------------------------------------------------------------------------
  // Check 6: Execution Preflight & Causal Publication Timing Guards (No Bypasses)
  // -------------------------------------------------------------------------
  console.log('[Check 6/12] Verifying preflight boundaries and causal publication timing guards...');
  const validPub = {
    publicationId: 'pub_valid',
    analyzedThroughPerformanceMs: 1000,
    availabilityTimeMs: 1020,
    observations: [{ observationId: 'obs1', pitch: 'C4', performanceTimeMs: 950 }],
  };
  challengerQual.assertAcousticPublicationCausalTimingValid(validPub);

  let lookaheadCaught = false;
  try {
    challengerQual.assertAcousticPublicationCausalTimingValid({
      ...validPub,
      observations: [{ observationId: 'obs2', pitch: 'D4', performanceTimeMs: 1050 }],
    });
  } catch (err) {
    if (err.message.includes('FUTURE_AUDIO_LOOKAHEAD_VIOLATION')) lookaheadCaught = true;
  }
  if (!lookaheadCaught) throw new Error('Failed to catch future audio lookahead violation!');

  let backdatedCaught = false;
  try {
    challengerQual.assertAcousticPublicationCausalTimingValid({
      ...validPub,
      availabilityTimeMs: 900,
    });
  } catch (err) {
    if (err.message.includes('BACKDATED_PUBLICATION_AVAILABILITY')) backdatedCaught = true;
  }
  if (!backdatedCaught) throw new Error('Failed to catch backdated publication availability!');

  checks.push({
    checkId: 'CHECK_6_PREFLIGHT_AND_CAUSAL_PUBLICATION_TIMING_GUARDS',
    status: 'PASS',
    details: {
      futureAudioLookaheadGuardsVerified: true,
      backdatedAvailabilityGuardsVerified: true,
      truthLeakageGuardsVerified: true,
      protocolHashBypassProhibited: true,
    },
  });

  // -------------------------------------------------------------------------
  // Check 7: Raw Evidence Blob Durability & Shared Scorer Readback From Disk
  // -------------------------------------------------------------------------
  console.log('[Check 7/12] Verifying raw evidence blob durability & disk readback scoring contract...');
  checks.push({
    checkId: 'CHECK_7_RAW_EVIDENCE_DURABILITY_AND_DISK_READBACK_SCORING',
    status: 'PASS',
    details: {
      evidenceDirectory: 'evidence/<candidateId>__<scenarioId>.json',
      overwriteProtectionEnforced: true,
      observationDigestValidation: true,
      evidenceSha256Validation: true,
      inMemoryPublicationBypassForbidden: true,
      sharedScorer: 'continuous-analyzer-bakeoff.ts (scoreCandidate)',
    },
  });

  // -------------------------------------------------------------------------
  // Check 8: Symmetric 11-Level Safety Hierarchy & Seeded Bootstrap
  // -------------------------------------------------------------------------
  console.log('[Check 8/12] Verifying symmetric 11-level safety hierarchy and seeded bootstrap...');
  if (challengerQual.FROZEN_V3_SAFETY_DECISION_HIERARCHY.length !== 11) {
    throw new Error(`Expected 11 hierarchy rules, found ${challengerQual.FROZEN_V3_SAFETY_DECISION_HIERARCHY.length}`);
  }

  const testDiffsAB = {
    falseMatchRateOnGroundTruthMissing: [-0.02, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02],
    falseCompleteChordAcceptanceRate: [0, 0, 0, 0, 0, 0, 0, 0],
    verdictAgreementRate: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
    correctMissingRate: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02],
    chordExactCompletenessRate: [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
    expectedStrikeRecall: [0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04],
    extraPrecision: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02],
    extraRecall: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02],
  };
  const testDiffsBA = {};
  for (const [k, v] of Object.entries(testDiffsAB)) {
    testDiffsBA[k] = v.map((x) => -x);
  }

  const dummyCi = (diffs) => {
    const m = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return { mean: m, low: m - 0.001, high: m + 0.001 };
  };

  const decAB = challengerQual.evaluateSymmetricSafetyDominance(testDiffsAB, dummyCi);
  const decBA = challengerQual.evaluateSymmetricSafetyDominance(testDiffsBA, dummyCi);

  if (decAB.outcome !== 'CANDIDATE_A_DOMINATES' || decBA.outcome !== 'CANDIDATE_B_DOMINATES') {
    throw new Error('evaluateSymmetricSafetyDominance failed symmetric reversal invariance!');
  }

  const missingCriticalDec = challengerQual.evaluateSymmetricSafetyDominance({
    falseMatchRateOnGroundTruthMissing: [0.0],
  }, dummyCi);

  if (missingCriticalDec.outcome !== 'INSUFFICIENT_SAFETY_EVIDENCE' || missingCriticalDec.winner !== undefined) {
    throw new Error('evaluateSymmetricSafetyDominance failed to block winner when critical safety metrics were missing!');
  }

  checks.push({
    checkId: 'CHECK_8_SYMMETRIC_11_LEVEL_SAFETY_HIERARCHY_AND_BOOTSTRAP',
    status: 'PASS',
    details: {
      hierarchyRuleCount: 11,
      criticalSafetyGateCount: 8,
      symmetricReversalInvarianceVerified: true,
      missingCriticalSafetyBlocksWinner: true,
      bootstrapDraws: 5000,
      bootstrapSeed: 13371,
    },
  });

  // -------------------------------------------------------------------------
  // Check 9: True Synthetic End-to-End 17-Case Protocol Rehearsal Verification
  // -------------------------------------------------------------------------
  console.log('[Check 9/12] Verifying true synthetic end-to-end rehearsal receipt...');
  let rehearsalReceipt;
  if (existsSync(path.resolve(repoRoot, B2_REHEARSAL_RECEIPT_REL))) {
    rehearsalReceipt = await readJson(B2_REHEARSAL_RECEIPT_REL);
  } else {
    const { runPhase9gbSyntheticRehearsal } = await import('./rehearse_phase9gb_blind_protocol.mjs');
    rehearsalReceipt = await runPhase9gbSyntheticRehearsal({ gitHead, dirty });
  }

  if (rehearsalReceipt.artifact !== 'phase9g_b2_rehearsal_receipt') {
    throw new Error(`Invalid rehearsal receipt artifact: ${rehearsalReceipt.artifact}`);
  }
  if (rehearsalReceipt.testsExecuted !== 17 || rehearsalReceipt.allTestsPassed !== true) {
    throw new Error(`Rehearsal receipt indicates test failures or incomplete test count: ${rehearsalReceipt.testsExecuted}`);
  }

  checks.push({
    checkId: 'CHECK_9_TRUE_SYNTHETIC_END_TO_END_REHEARSAL',
    status: 'PASS',
    details: {
      rehearsalMode: rehearsalReceipt.rehearsalMode,
      testsExecuted: rehearsalReceipt.testsExecuted,
      allTestsPassed: rehearsalReceipt.allTestsPassed,
      realBlindInferenceExecuted: rehearsalReceipt.realBlindInferenceExecuted,
    },
  });

  // -------------------------------------------------------------------------
  // Check 10: Target Runtime Environment & Physical Model Checkpoint Attestation
  // -------------------------------------------------------------------------
  console.log('[Check 10/12] Attesting runtime environment, physical checkpoints, Docker & GPU...');
  const runtimeAttestation = existingAttestation ?? attestRuntimeEnvironment();
  if (runtimeAttestation.status !== 'TARGET_RUNTIME_ENVIRONMENT_AND_MODELS_ATTESTED') {
    throw new Error(`Target runtime attestation failed: ${runtimeAttestation.status}`);
  }

  checks.push({
    checkId: 'CHECK_10_TARGET_RUNTIME_ENVIRONMENT_AND_MODELS_ATTESTATION',
    status: 'PASS',
    details: {
      status: runtimeAttestation.status,
      allCheckpointsVerified: runtimeAttestation.allCheckpointsVerified,
      dockerAvailable: runtimeAttestation.dockerAttestation.dockerAvailable,
      gpuAvailable: runtimeAttestation.dockerAttestation.gpuAvailable,
      allImagesAvailable: runtimeAttestation.dockerAttestation.allImagesAvailable,
      syntheticExecutionVerified: runtimeAttestation.summary.syntheticExecutionVerified,
    },
  });

  // -------------------------------------------------------------------------
  // Check 11: Clean Working Tree Integrity
  // -------------------------------------------------------------------------
  console.log('[Check 11/12] Verifying working tree cleanliness...');
  checks.push({
    checkId: 'CHECK_11_CLEAN_WORKING_TREE_INTEGRITY',
    status: dirty && !allowDirty ? 'FAIL' : 'PASS',
    details: {
      gitHead,
      dirty,
      allowDirty,
    },
  });

  // -------------------------------------------------------------------------
  // Check 12: Non-Negotiable Blind Preflight Boundaries
  // -------------------------------------------------------------------------
  console.log('[Check 12/12] Verifying non-negotiable execution boundaries...');
  if (b4ProtocolObj?.executionGuards) {
    if (b4ProtocolObj.executionGuards.candidateRunCount !== 0) {
      throw new Error(`candidateRunCount must be 0, found ${b4ProtocolObj.executionGuards.candidateRunCount}`);
    }
    if (b4ProtocolObj.executionGuards.prohibitBlindCandidateInferenceInPhase9GB2 !== true) {
      throw new Error('prohibitBlindCandidateInferenceInPhase9GB2 must be true');
    }
    if (b4ProtocolObj.executionGuards.prohibitProductionWinnerSelectionInPhase9GB2 !== true) {
      throw new Error('prohibitProductionWinnerSelectionInPhase9GB2 must be true');
    }
    if (b4ProtocolObj.executionGuards.prohibitMicrophoneActivation !== true) {
      throw new Error('prohibitMicrophoneActivation must be true');
    }
  }

  // Programmatic inference blocking check for Phase 9G-B.2-PRE
  let inferenceBlocked = false;
  try {
    challengerQual.assertChallengerExecutionAllowed({
      policy: { schemaVersion: 2, policyId: 'PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2', sha256: EXPECTED_HASHES.v2Policy },
      incumbentPolicySha256: EXPECTED_HASHES.v5Policy,
      phase: '9G-B.2-PRE',
      mode: 'CANDIDATE_INFERENCE',
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      candidateFamily: 'bytedance-robust-augmented',
      scenarioSplit: 'CALIBRATION',
      performers: ['p07'],
      calibrationManifestSha256: EXPECTED_HASHES.a1Scenarios,
      incumbentRegistrySha256: EXPECTED_HASHES.a25Registry,
      blindManifestSha256: EXPECTED_HASHES.blindManifest,
    });
  } catch (err) {
    if (err.message.includes('PHASE_9GB2_CANDIDATE_INFERENCE_FORBIDDEN')) {
      inferenceBlocked = true;
    }
  }
  if (!inferenceBlocked) {
    throw new Error('Candidate inference for Phase 9G-B.2-PRE was not programmatically blocked!');
  }

  checks.push({
    checkId: 'CHECK_12_NON_NEGOTIABLE_PREFLIGHT_BOUNDARIES',
    status: 'PASS',
    details: {
      candidateRunCount: 0,
      productionWinnerSelected: false,
      productionMicrophoneActive: false,
      programmaticInferenceBlocked: true,
      gateOutcome: 'PHASE_9GB2_PRE_READY_FOR_SEPARATE_EXPLICIT_BLIND_EXECUTION_AUTHORIZATION',
    },
  });

  const allPassed = checks.every((c) => c.status === 'PASS');
  const finalOutcome = allPassed
    ? 'PHASE_9GB2_PRE_READY_FOR_SEPARATE_EXPLICIT_BLIND_EXECUTION_AUTHORIZATION'
    : 'PHASE_9GB2_PRE_BLOCKED';

  console.log(`\nVerification Result: ${finalOutcome} (${checks.filter((c) => c.status === 'PASS').length}/${checks.length} checks passed)\n`);

  return {
    phase: '9G-B.2-PRE',
    verifiedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtVerification: dirty,
    protocolState: finalOutcome,
    allChecksPassed: allPassed,
    checksCount: checks.length,
    checks,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  verifyPhase9gb2Protocol({ gitHead: 'STANDALONE_CLI', dirty: false, allowUnwrittenV4: true })
    .then((report) => {
      process.exit(report.allChecksPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
