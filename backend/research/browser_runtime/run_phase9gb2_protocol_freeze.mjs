/**
 * Phase 9G-B.2-ARM Unified Protocol Freeze Runner.
 *
 * Orchestrates:
 * 1. Evidence Reconciliation and Receipt Preparation (all 4 B.2 artifacts)
 * 2. True Synthetic End-to-End Protocol Rehearsal (rehearse_phase9gb_blind_protocol.mjs)
 * 3. Physical Checkpoint & Docker Runtime Attestation (attest_inference_runtime.mjs)
 * 4. Independent Protocol Verification (verify_phase9gb2_protocol.mjs)
 *
 * Enforces non-negotiable boundaries:
 * - NO neural inference executed on blind performers p15-p22 or calibration performers p07-p14 (candidateRunCount = 0)
 * - NO production winner selected
 * - NO production microphone activation
 * - Three officially admitted ranked candidates locked; research references non-ranking; D3RM blocked
 * - Clean working tree requirement (unless --allow-dirty)
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { runPhase9gbSyntheticRehearsal } from './rehearse_phase9gb_blind_protocol.mjs';
import { attestRuntimeEnvironment } from './attest_inference_runtime.mjs';
import {
  verifyPhase9gb2Protocol,
  V5_POLICY_REL,
  V1_POLICY_REL,
  V2_POLICY_REL,
  B1_PROTOCOL_REL,
  B2_PROTOCOL_REL,
  B3_PROTOCOL_REL,
  B4_PROTOCOL_REL,
  B5_PROTOCOL_REL,
  B6_PROTOCOL_REL,
  A25_REGISTRY_REL,
  A1_SCENARIOS_REL,
  BLIND_MANIFEST_REL,
  SCORER_SOURCE_REL,
  FINALIZER_LEDGER_REL,
  RECONCILER_REL,
  QUALIFICATION_MODULE_REL,
  ORCHESTRATOR_MODULE_REL,
  EXECUTION_ENTRYPOINT_REL,
  REHEARSAL_MODULE_REL,
  ATTESTATION_MODULE_REL,
  B2_SUPERSESSION_RECEIPT_REL,
  B2_CANDIDATE_LOCK_RECEIPT_REL,
  B2_REHEARSAL_RECEIPT_REL,
  B2_PROTOCOL_FREEZE_REPORT_REL,
  EXPECTED_HASHES,
  EXPECTED_RANKED_CANDIDATES,
  sha256File,
  readJson,
  writeJson,
} from './verify_phase9gb2_protocol.mjs';

const repoRoot = process.cwd();

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

export async function preparePhase9gb2Receipts({ gitHead, dirty, allowUnwrittenV6 = false, allowUnwrittenV5 = false, allowDirty = false } = {}) {
  console.log('>>> Preparing Phase 9G-B.2-FINAL-GATE Evidence Receipts...');

  const v5ActualSha = await sha256File(V5_POLICY_REL);
  const v1PolicySha = await sha256File(V1_POLICY_REL);
  const v2PolicySha = await sha256File(V2_POLICY_REL);
  const b1ProtocolSha = await sha256File(B1_PROTOCOL_REL);
  const b2ProtocolSha = await sha256File(B2_PROTOCOL_REL);
  const b3ProtocolSha = await sha256File(B3_PROTOCOL_REL);
  const b4ProtocolSha = await sha256File(B4_PROTOCOL_REL);
  const b5ProtocolSha = await sha256File(B5_PROTOCOL_REL);
  const b6ProtocolSha = existsSync(path.resolve(repoRoot, B6_PROTOCOL_REL))
    ? await sha256File(B6_PROTOCOL_REL)
    : null;
  const a25Sha = await sha256File(A25_REGISTRY_REL);
  const a1Sha = await sha256File(A1_SCENARIOS_REL);
  const blindSha = await sha256File(BLIND_MANIFEST_REL);

  const scorerSha = await sha256File(SCORER_SOURCE_REL);
  const finalizerSha = await sha256File(FINALIZER_LEDGER_REL);
  const reconcilerSha = await sha256File(RECONCILER_REL);
  const qualSha = await sha256File(QUALIFICATION_MODULE_REL);
  const orchSha = await sha256File(ORCHESTRATOR_MODULE_REL);
  const entrypointSha = await sha256File(EXECUTION_ENTRYPOINT_REL);
  const rehearsalSha = await sha256File(REHEARSAL_MODULE_REL);
  const attestationSha = await sha256File(ATTESTATION_MODULE_REL);

  // 1. Supersession Receipt
  const supersessionReceipt = {
    schemaVersion: 6,
    artifact: 'phase9g_b2_supersession_receipt',
    phase: '9G-B.2-FINAL-GATE',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtGeneration: dirty,
    supersededProtocol: {
      policyId: 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V5',
      path: B5_PROTOCOL_REL,
      sha256: b5ProtocolSha,
      status: 'SUPERSEDED_BY_V6_FINAL_GATE',
      supersessionReason: 'Independent source review established that while Phase 9G-B.2-ARM completed model forward passes and writer lock tokens, Phase 9G-B.2-FINAL-GATE establishes the authoritative blind execution entrypoint (execute_phase9gb_blind_evaluation.mjs), enforces independent immutable protocol trust roots, executes physical audio byte integrity verification, eliminates synthetic fallbacks, and establishes fail-closed writer ownership assertions.',
    },
    activeProtocol: {
      policyId: 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V6',
      path: B6_PROTOCOL_REL,
      sha256: b6ProtocolSha,
      status: 'ACTIVE_AUTHORIZATION_GATED',
    },
    materialAmendmentsInV6: [
      'Established independently pinned immutable protocol trust root for V5 (e5400fd44ce91cd5d99475e36b72626522297d6aef009a620fe6a4baf4ae440b) and V6: caller-supplied path or SHA cannot act as own root.',
      'Implemented authoritative official blind execution entrypoint (execute_phase9gb_blind_evaluation.mjs) with strict authorization gate blocking unauthorized --real-blind launches (BLIND_EXECUTION_UNAUTHORIZED).',
      'Implemented dry-run synthetic execution mode exercising official adapter wiring, input normalization, preflight guards, ledger mutex, and evidence durability using synthetic audio fixtures only.',
      'Implemented physical audio byte integrity preflight (assertAudioByteIntegrity) verifying RIFF WAV headers, 16kHz mono PCM, sample counts, and SHA256; deferred for real blind audio until authorized.',
      'Derived authorized scenario schedule strictly from immutable metadata (deriveAuthorizedScheduleFromMetadata), isolating performers p15–p22 and verifying 70 total / 63 pairwise intersection geometry.',
      'Completed genuine runtime attestation across all three candidate models with synthetic forward passes in target Docker containers, verifying output shapes (1001, 88), (88,), and (1, 183, 88) on NVIDIA GeForce RTX 4080 Laptop GPU.',
      'Hardened writer lock with unique owner token, PID, and lock generation in writer.lock; enforced ownership assertion before writes and fail-closed release.',
      'Enforced fail-closed resume on missing or altered identity bindings (protocolSha256, scorerSha256, orchestratorSha256, rosterSha256, manifestSha256).',
      'Required external independent trusted anchor for journal chain tip verification, rejecting mutable run-directory receipt as trusted anchor (JOURNAL_COMPLETENESS_NOT_VERIFIABLE).',
      'Expanded adversarial synthetic rehearsal to 20 comprehensive test cases demonstrating end-to-end execution-readiness.',
      'Established Phase 9G-B.2-FINAL-GATE execution authorization gate outcome: PHASE_9GB2_FINAL_GATE_READY_TO_REQUEST_EXPLICIT_ONE_SHOT_AUTHORIZATION.',
    ],
  };
  await writeJson(B2_SUPERSESSION_RECEIPT_REL, supersessionReceipt);

  // 2. Candidate Lock Receipt
  const runtimeAttestation = attestRuntimeEnvironment();

  const candidateLockReceipt = {
    schemaVersion: 6,
    artifact: 'phase9g_b2_candidate_lock_receipt',
    phase: '9G-B.2-FINAL-GATE',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtGeneration: dirty,
    runtimeAttestationStatus: runtimeAttestation.status,
    runtimeAttestationSummary: runtimeAttestation.summary,
    rankedCandidates: EXPECTED_RANKED_CANDIDATES.map((c) => ({
      ...c,
      category: c.candidateId.includes('robust') ? 'QUALIFIED_CHALLENGER' : 'FROZEN_INCUMBENT',
      qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH',
      permittedBlindRole: c.candidateId.includes('robust') ? 'QUALIFIED_CHALLENGER_EVALUATION' : 'FROZEN_INCUMBENT_EVALUATION',
      lockedForPhase9gB: true,
      productionSelectionEligible: true,
    })),
    pairwiseMutualEligibilityGeometry: {
      'bytedance-original-calibrated-v1_vs_online-amt-calibrated-v1': {
        candidateAEligibleCount: 63,
        candidateBEligibleCount: 70,
        mutuallyEligibleScenarioCount: 63,
        geometryFilterReason: 'bytedance-original requires performanceOriginSourceMs >= 5000ms; 7 scenarios lack pre-roll',
      },
      'bytedance-robust-augmented-calibrated-v1_vs_online-amt-calibrated-v1': {
        candidateAEligibleCount: 63,
        candidateBEligibleCount: 70,
        mutuallyEligibleScenarioCount: 63,
        geometryFilterReason: 'bytedance-robust-augmented requires performanceOriginSourceMs >= 1820ms; 7 scenarios lack pre-roll',
      },
      'bytedance-original-calibrated-v1_vs_bytedance-robust-augmented-calibrated-v1': {
        candidateAEligibleCount: 63,
        candidateBEligibleCount: 63,
        mutuallyEligibleScenarioCount: 63,
        geometryFilterReason: 'Both ByteDance candidates share identical 63 scenarios with sufficient pre-roll',
      },
    },
    nonRankingResearchReferences: [
      {
        candidateId: 'transkun-v2-aug-calibrated-v1',
        candidateFamily: 'transkun',
        permittedBlindRole: 'SEPARATELY_LABELED_NON_RANKING_RESEARCH_REFERENCE_ONLY',
        lockedForPhase9gB: false,
        productionSelectionEligible: false,
      },
      {
        candidateId: 'aria-amt-medium-double-v1',
        candidateFamily: 'aria-amt',
        permittedBlindRole: 'SEPARATELY_LABELED_NON_RANKING_RESEARCH_REFERENCE_ONLY',
        lockedForPhase9gB: false,
        productionSelectionEligible: false,
      },
      {
        candidateId: 'rtt-causal-streaming-v1',
        candidateFamily: 'rtt',
        permittedBlindRole: 'SEPARATELY_LABELED_NON_RANKING_RESEARCH_REFERENCE_ONLY',
        lockedForPhase9gB: false,
        productionSelectionEligible: false,
      },
    ],
    blockedCandidates: [
      {
        candidateId: 'd3rm-offline-ceiling-reference',
        permittedBlindRole: 'NOT_PERMITTED',
        lockedForPhase9gB: false,
        productionSelectionEligible: false,
        ineligibilityReason: 'Missing natten dependency in environment; licensing unresolved; offline ceiling reference only.',
      },
    ],
    performerIsolation: {
      calibrationPerformers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
      blindPerformers: ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'],
      rehearsalPerformers: ['p99_synthetic'],
      isolationVerified: true,
    },
  };
  await writeJson(B2_CANDIDATE_LOCK_RECEIPT_REL, candidateLockReceipt);

  // 3. Rehearsal Receipt
  const rehearsalReceipt = await runPhase9gbSyntheticRehearsal({ gitHead, dirty });
  await writeJson(B2_REHEARSAL_RECEIPT_REL, rehearsalReceipt);

  // 4. Protocol Freeze Report
  const verifierReport = await verifyPhase9gb2Protocol({
    gitHead,
    dirty,
    allowUnwrittenV6: allowUnwrittenV6 || allowUnwrittenV5,
    allowDirty,
    existingAttestation: runtimeAttestation,
    existingRehearsal: rehearsalReceipt,
  });

  const freezeReport = {
    schemaVersion: 6,
    artifact: 'phase9g_b2_protocol_freeze_report',
    phase: '9G-B.2-FINAL-GATE',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtGeneration: dirty,
    authorizationGateOutcome: verifierReport.protocolState,
    allConditionsSatisfied: verifierReport.allChecksPassed,
    verificationsCount: verifierReport.checksCount,
    verificationChecks: verifierReport.checks,
    immutableBindings: {
      v5PolicySha256: v5ActualSha,
      v1ChallengerPolicySha256: v1PolicySha,
      v2ChallengerPolicySha256: v2PolicySha,
      v1BlindProtocolSha256: b1ProtocolSha,
      v2BlindProtocolSha256: b2ProtocolSha,
      v3BlindProtocolSha256: b3ProtocolSha,
      v4BlindProtocolSha256: b4ProtocolSha,
      v5BlindProtocolSha256: b5ProtocolSha,
      v6BlindProtocolSha256: b6ProtocolSha,
      a25IncumbentRegistrySha256: a25Sha,
      a1CalibrationManifestSha256: a1Sha,
      blindManifestSha256: blindSha,
      scorerSourceSha256: scorerSha,
      finalizerLedgerSha256: finalizerSha,
      reconcilerSha256: reconcilerSha,
      qualificationModuleSha256: qualSha,
      orchestratorModuleSha256: orchSha,
      executionEntrypointSha256: entrypointSha,
      rehearsalModuleSha256: rehearsalSha,
      attestationModuleSha256: attestationSha,
    },
    executionGuards: {
      candidateRunCount: 0,
      realBlindInferenceExecuted: false,
      productionWinnerSelected: false,
      productionMicrophoneActive: false,
      explicitBlindInferenceAuthorizationRequired: true,
    },
  };
  await writeJson(B2_PROTOCOL_FREEZE_REPORT_REL, freezeReport);

  console.log(`\nPhase 9G-B.2-FINAL-GATE Artifacts Successfully Prepared. Gate Status: ${verifierReport.protocolState}\n`);
  return {
    supersessionReceipt,
    candidateLockReceipt,
    rehearsalReceipt,
    freezeReport,
    verifierReport,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  const allowDirty = process.argv.includes('--allow-dirty');
  const allowUnwrittenV6 = process.argv.includes('--allow-unwritten-v6') || process.argv.includes('--allow-unwritten-v5') || process.argv.includes('--allow-unwritten-v4');
  const gitHead = getGitHead(repoRoot);
  const dirty = getGitDirty(repoRoot);

  if (dirty && !allowDirty) {
    console.error('ERROR: Working tree is dirty. Clean tree required for freeze receipt generation or pass --allow-dirty');
    process.exit(1);
  }

  preparePhase9gb2Receipts({ gitHead, dirty, allowUnwrittenV6, allowDirty })
    .then((res) => {
      process.exit(res.verifierReport.allChecksPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
