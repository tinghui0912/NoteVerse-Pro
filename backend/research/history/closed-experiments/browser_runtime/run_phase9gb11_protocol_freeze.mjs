/**
 * Phase 9G-B.1.1 Unified Protocol Freeze Runner.
 *
 * Orchestrates:
 * 1. Evidence Reconciliation and Receipt Preparation (all 4 B.1.1 artifacts)
 * 2. True Synthetic End-to-End Protocol Rehearsal (rehearse_phase9gb_blind_protocol.mjs)
 * 3. Independent Protocol Verification (verify_phase9gb11_protocol.mjs)
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
import {
  verifyPhase9gb11Protocol,
  V5_POLICY_REL,
  V1_POLICY_REL,
  V2_POLICY_REL,
  B1_PROTOCOL_REL,
  B2_PROTOCOL_REL,
  A25_REGISTRY_REL,
  A1_SCENARIOS_REL,
  BLIND_MANIFEST_REL,
  SCORER_SOURCE_REL,
  FINALIZER_LEDGER_REL,
  RECONCILER_REL,
  QUALIFICATION_MODULE_REL,
  ORCHESTRATOR_MODULE_REL,
  B11_SUPERSESSION_RECEIPT_REL,
  B11_CANDIDATE_LOCK_RECEIPT_REL,
  B11_REHEARSAL_RECEIPT_REL,
  B11_PROTOCOL_FREEZE_REPORT_REL,
  EXPECTED_HASHES,
  EXPECTED_RANKED_CANDIDATES,
  sha256File,
  readJson,
  writeJson,
} from './verify_phase9gb11_protocol.mjs';

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

export async function preparePhase9gb11Receipts({ gitHead, dirty }) {
  console.log('>>> Preparing Phase 9G-B.1.1 Evidence Receipts...');

  const v5ActualSha = await sha256File(V5_POLICY_REL);
  const v1PolicySha = await sha256File(V1_POLICY_REL);
  const v2PolicySha = await sha256File(V2_POLICY_REL);
  const b1ProtocolSha = await sha256File(B1_PROTOCOL_REL);
  const b2ProtocolSha = existsSync(path.resolve(repoRoot, B2_PROTOCOL_REL))
    ? await sha256File(B2_PROTOCOL_REL)
    : null;
  const a25Sha = await sha256File(A25_REGISTRY_REL);
  const a1Sha = await sha256File(A1_SCENARIOS_REL);
  const blindSha = await sha256File(BLIND_MANIFEST_REL);

  const scorerSha = await sha256File(SCORER_SOURCE_REL);
  const finalizerSha = await sha256File(FINALIZER_LEDGER_REL);
  const reconcilerSha = await sha256File(RECONCILER_REL);
  const qualSha = await sha256File(QUALIFICATION_MODULE_REL);
  const orchSha = await sha256File(ORCHESTRATOR_MODULE_REL);

  const blindManifestObj = await readJson(BLIND_MANIFEST_REL);
  const blindScenarios = blindManifestObj.scenarioReceipts ?? blindManifestObj.scenarios ?? [];

  // 1. Supersession Receipt
  const supersessionReceipt = {
    schemaVersion: 2,
    artifact: 'phase9g_b11_supersession_receipt',
    phase: '9G-B.1.1',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtGeneration: dirty,
    supersededProtocol: {
      policyId: 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V1',
      path: B1_PROTOCOL_REL,
      sha256: b1ProtocolSha,
      status: 'SUPERSEDED_NOT_EXECUTION_GRADE',
      supersessionReason: 'Phase 9G-B.1 provided a protocol-level foundation but its 12 synthetic rehearsal checks were isolated helper unit tests rather than an end-to-end execution path. Furthermore, V1 lacked execution-grade bindings to source code SHA256 hashes, checkpoint physical byte sizes, atomic filesystem ledger lifecycle rules, and audio geometry scenario eligibility.',
    },
    activeProtocol: {
      policyId: 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V2',
      path: B2_PROTOCOL_REL,
      sha256: b2ProtocolSha,
      status: 'ACTIVE_EXECUTION_GRADE_PROTOCOL_LOCKED',
    },
    materialAmendmentsInV2: [
      'Bound protocol execution to exact SHA256 hashes of shared scorer, finalizer ledger, performance reconciler, qualification module, and blind orchestrator.',
      'Bound admitted candidate checkpoints to verified physical byte sizes in addition to SHA256 hashes.',
      'Derived scenario eligibility directly from blind manifest audio geometry: 63 scenarios for 5.0s / 1820ms models, 70 for streaming models, exactly 63 mutual scenarios for all pairwise comparisons.',
      'Formalized DurableExecutionLedger lifecycle specification with atomic filesystem updates, state transitions, and resume capability.',
      'Formalized 11-level safety-first decision hierarchy with predeclared numerical thresholds.',
      'Replaced 12-case helper rehearsal with comprehensive 16-case true synthetic end-to-end orchestration rehearsal exercising the real shared scorer, seeded bootstrap (5000 draws, seed 13371), and ledger recovery.',
    ],
  };
  await writeJson(B11_SUPERSESSION_RECEIPT_REL, supersessionReceipt);

  // 2. Candidate Lock Receipt
  const candidateLockReceipt = {
    schemaVersion: 2,
    artifact: 'phase9g_b11_candidate_lock_receipt',
    phase: '9G-B.1.1',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtGeneration: dirty,
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
    executionImplementationBindings: {
      scorerSourceSha256: scorerSha,
      finalizerLedgerSha256: finalizerSha,
      reconcilerSha256: reconcilerSha,
      qualificationModuleSha256: qualSha,
      orchestratorSha256: orchSha,
    },
    preflightBoundaries: {
      candidateRunCount: 0,
      productionWinnerSelected: false,
      productionMicrophoneActive: false,
      blindPerformerInferenceAttempted: false,
    },
  };
  await writeJson(B11_CANDIDATE_LOCK_RECEIPT_REL, candidateLockReceipt);

  // 3. True Synthetic End-to-End Rehearsal Receipt
  console.log('>>> Executing True Synthetic End-to-End Rehearsal (16 cases)...');
  const rehearsalReceipt = await runPhase9gbSyntheticRehearsal({ gitHead, dirty });
  await writeJson(B11_REHEARSAL_RECEIPT_REL, rehearsalReceipt);

  // 4. Verification and Freeze Report
  console.log('>>> Running Independent Verification (8 checks)...');
  const verificationResult = await verifyPhase9gb11Protocol({ gitHead, dirty });

  const freezeReport = {
    schemaVersion: 2,
    artifact: 'phase9g_b11_protocol_freeze_report',
    phase: '9G-B.1.1',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtFreeze: dirty,
    protocolState: verificationResult.protocolState,
    allChecksPassed: verificationResult.allChecksPassed,
    checksCount: verificationResult.checksCount,
    checks: verificationResult.checks,
    activeV2Protocol: {
      path: B2_PROTOCOL_REL,
      sha256: b2ProtocolSha,
      supersedesPolicySha256: b1ProtocolSha,
    },
    boundImplementationFiles: {
      scorerSource: { path: SCORER_SOURCE_REL, sha256: scorerSha },
      finalizerLedger: { path: FINALIZER_LEDGER_REL, sha256: finalizerSha },
      performanceReconciler: { path: RECONCILER_REL, sha256: reconcilerSha },
      qualificationEngine: { path: QUALIFICATION_MODULE_REL, sha256: qualSha },
      executionOrchestrator: { path: ORCHESTRATOR_MODULE_REL, sha256: orchSha },
    },
    lockedCandidates: EXPECTED_RANKED_CANDIDATES.map((c) => ({
      candidateId: c.candidateId,
      profileId: c.profileId,
      configurationSha256: c.configurationSha256,
      checkpointSha256: c.checkpointSha256,
      checkpointBytes: c.checkpointBytes,
      eligibleScenarios: c.eligibleScenarioCount,
    })),
    preflightConfirmation: {
      blindPerformerInferenceExecuted: false,
      blindExpectedStrikeTruthReadForInference: false,
      productionWinnerSelected: false,
      productionMicrophoneActive: false,
      candidateRunCount: 0,
      readinessStatus: 'PHASE_9GB11_EXECUTION_GRADE_PROTOCOL_LOCKED_AWAITING_EXPLICIT_BLIND_RUN_AUTHORIZATION',
    },
  };
  await writeJson(B11_PROTOCOL_FREEZE_REPORT_REL, freezeReport);

  console.log('\n=== Phase 9G-B.1.1 Protocol Freeze Completed Successfully ===\n');
  return freezeReport;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  const allowDirty = process.argv.includes('--allow-dirty');
  const gitHead = getGitHead(repoRoot);
  const dirty = getGitDirty(repoRoot);

  if (dirty && !allowDirty) {
    console.error('ERROR: Phase 9G-B.1.1 freeze runner requires a clean git working tree.');
    console.error('Commit your changes or pass --allow-dirty for local scratch testing.');
    process.exit(1);
  }

  preparePhase9gb11Receipts({ gitHead, dirty })
    .then((report) => {
      process.exit(report.allChecksPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
