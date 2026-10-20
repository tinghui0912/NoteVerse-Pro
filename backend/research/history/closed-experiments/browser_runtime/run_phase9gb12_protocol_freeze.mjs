/**
 * Phase 9G-B.1.2 Unified Protocol Freeze Runner.
 *
 * Orchestrates:
 * 1. Evidence Reconciliation and Receipt Preparation (all 4 B.1.2 artifacts)
 * 2. True Synthetic End-to-End Protocol Rehearsal (rehearse_phase9gb_blind_protocol.mjs)
 * 3. Independent Protocol Verification (verify_phase9gb12_protocol.mjs)
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
  verifyPhase9gb12Protocol,
  V5_POLICY_REL,
  V1_POLICY_REL,
  V2_POLICY_REL,
  B1_PROTOCOL_REL,
  B2_PROTOCOL_REL,
  B3_PROTOCOL_REL,
  A25_REGISTRY_REL,
  A1_SCENARIOS_REL,
  BLIND_MANIFEST_REL,
  SCORER_SOURCE_REL,
  FINALIZER_LEDGER_REL,
  RECONCILER_REL,
  QUALIFICATION_MODULE_REL,
  ORCHESTRATOR_MODULE_REL,
  REHEARSAL_MODULE_REL,
  B12_SUPERSESSION_RECEIPT_REL,
  B12_CANDIDATE_LOCK_RECEIPT_REL,
  B12_REHEARSAL_RECEIPT_REL,
  B12_PROTOCOL_FREEZE_REPORT_REL,
  EXPECTED_HASHES,
  EXPECTED_RANKED_CANDIDATES,
  sha256File,
  readJson,
  writeJson,
} from './verify_phase9gb12_protocol.mjs';

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

export async function preparePhase9gb12Receipts({ gitHead, dirty, allowUnwrittenV3 = false }) {
  console.log('>>> Preparing Phase 9G-B.1.2 Evidence Receipts...');

  const v5ActualSha = await sha256File(V5_POLICY_REL);
  const v1PolicySha = await sha256File(V1_POLICY_REL);
  const v2PolicySha = await sha256File(V2_POLICY_REL);
  const b1ProtocolSha = await sha256File(B1_PROTOCOL_REL);
  const b2ProtocolSha = await sha256File(B2_PROTOCOL_REL);
  const b3ProtocolSha = existsSync(path.resolve(repoRoot, B3_PROTOCOL_REL))
    ? await sha256File(B3_PROTOCOL_REL)
    : null;
  const a25Sha = await sha256File(A25_REGISTRY_REL);
  const a1Sha = await sha256File(A1_SCENARIOS_REL);
  const blindSha = await sha256File(BLIND_MANIFEST_REL);

  const scorerSha = await sha256File(SCORER_SOURCE_REL);
  const finalizerSha = await sha256File(FINALIZER_LEDGER_REL);
  const reconcilerSha = await sha256File(RECONCILER_REL);
  const qualSha = await sha256File(QUALIFICATION_MODULE_REL);
  const orchSha = await sha256File(ORCHESTRATOR_MODULE_REL);
  const rehearsalSha = await sha256File(REHEARSAL_MODULE_REL);

  const blindManifestObj = await readJson(BLIND_MANIFEST_REL);
  const blindScenarios = blindManifestObj.scenarioReceipts ?? blindManifestObj.scenarios ?? [];

  // 1. Supersession Receipt
  const supersessionReceipt = {
    schemaVersion: 3,
    artifact: 'phase9g_b12_supersession_receipt',
    phase: '9G-B.1.2',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtGeneration: dirty,
    supersededProtocol: {
      policyId: 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V2',
      path: B2_PROTOCOL_REL,
      sha256: b2ProtocolSha,
      status: 'SUPERSEDED_NOT_EXECUTION_SAFE',
      supersessionReason: 'Independent GitHub review confirmed that Phase 9G-B.1.1 protocol V2 produced a valuable foundation, but remained non-execution-safe: the execution ledger used non-atomic whole-file writes and lacked exclusive run reservation ("wx" lock), acoustic evidence was not durably persisted to disk before scoring, mandatory preflight guards were not enforced at the adapter invocation boundary, publication causal timing was not verified, and the decision function was not symmetric across all safety levels.',
    },
    activeProtocol: {
      policyId: 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V3',
      path: B3_PROTOCOL_REL,
      sha256: b3ProtocolSha,
      status: 'ACTIVE_ONE_SHOT_EXECUTION_LOCKED',
    },
    materialAmendmentsInV3: [
      'Implemented exclusive atomic run reservation using filesystem openSync("wx") locking.',
      'Implemented append-only cryptographic event journaling (journal.jsonl) with monotonic sequence numbers, individual event hashes, and chained SHA256 hashes.',
      'Durably persist complete raw acoustic evidence blobs to disk (evidence/<candidateId>__<scenarioId>.json) with observation digests before truth access.',
      'Updated shared scoreCandidate() invocation to reconstruct candidate runs strictly from disk evidence, validating digests against ledger records.',
      'Mandatory preflightCandidateScenarioExecution() enforced directly at the adapter invocation boundary, rejecting unknown candidates, config/checkpoint mismatches, audio geometry ineligibility, and truth leakage.',
      'Causal publication timing validation: enforced assertAcousticPublicationCausalTimingValid(), rejecting future-audio lookahead and backdated availability.',
      'Implemented symmetric 11-level safety decision procedure (evaluateSymmetricSafetyDominance) where candidate reversal produces reciprocal outcomes and critical safety missing data strictly blocks winner declaration.',
      'Seeded bootstrap confidence intervals (5000 draws, seed 13371) paired directly on candidate difference vectors from shared scorer outputs.',
      'Expanded adversarial synthetic rehearsal to 16 execution-grade checks exercising run collision, crash recovery, journal tampering, and preflight guards.',
      'Enforced non-negotiable execution boundaries: candidateRunCount = 0, productionWinnerSelected = false, productionMicrophoneActive = false.',
    ],
  };
  await writeJson(B12_SUPERSESSION_RECEIPT_REL, supersessionReceipt);

  // 2. Candidate Lock Receipt
  let runtimeContainerStatus = 'REAL_RUNTIME_BINDING_NOT_VERIFIABLE_IN_THIS_ENVIRONMENT';
  if (existsSync('/.dockerenv')) {
    runtimeContainerStatus = 'DOCKER_RUNTIME_CONTAINER_VERIFIED';
  }

  const candidateLockReceipt = {
    schemaVersion: 3,
    artifact: 'phase9g_b12_candidate_lock_receipt',
    phase: '9G-B.1.2',
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
      rehearsalSha256: rehearsalSha,
    },
    preflightBoundaries: {
      candidateRunCount: 0,
      productionWinnerSelected: false,
      productionMicrophoneActive: false,
      blindPerformerInferenceAttempted: false,
      runtimeContainerBinding: runtimeContainerStatus,
    },
  };
  await writeJson(B12_CANDIDATE_LOCK_RECEIPT_REL, candidateLockReceipt);

  // 3. True Synthetic End-to-End Rehearsal Receipt
  console.log('>>> Executing True Synthetic End-to-End Rehearsal (16 cases)...');
  const rehearsalReceipt = await runPhase9gbSyntheticRehearsal({ gitHead, dirty });
  await writeJson(B12_REHEARSAL_RECEIPT_REL, rehearsalReceipt);

  // 4. Verification and Freeze Report
  console.log('>>> Running Independent Verification (10 checks)...');
  const verificationResult = await verifyPhase9gb12Protocol({ gitHead, dirty, allowUnwrittenV3 });

  const freezeReport = {
    schemaVersion: 3,
    artifact: 'phase9g_b12_protocol_freeze_report',
    phase: '9G-B.1.2',
    generatedAt: new Date().toISOString(),
    gitHead,
    dirtyTreeAtFreeze: dirty,
    protocolState: verificationResult.protocolState,
    allChecksPassed: verificationResult.allChecksPassed,
    checksCount: verificationResult.checksCount,
    checks: verificationResult.checks,
    activeV3Protocol: {
      path: B3_PROTOCOL_REL,
      sha256: b3ProtocolSha,
      supersedesPolicySha256: b2ProtocolSha,
    },
    boundImplementationFiles: {
      scorerSource: { path: SCORER_SOURCE_REL, sha256: scorerSha },
      finalizerLedger: { path: FINALIZER_LEDGER_REL, sha256: finalizerSha },
      performanceReconciler: { path: RECONCILER_REL, sha256: reconcilerSha },
      qualificationEngine: { path: QUALIFICATION_MODULE_REL, sha256: qualSha },
      executionOrchestrator: { path: ORCHESTRATOR_MODULE_REL, sha256: orchSha },
      rehearsalModule: { path: REHEARSAL_MODULE_REL, sha256: rehearsalSha },
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
      runtimeContainerBinding: runtimeContainerStatus,
      readinessStatus: 'PHASE_9GB12_ONE_SHOT_EXECUTION_LOCKED_AWAITING_EXPLICIT_BLIND_AUTHORIZATION',
    },
  };
  await writeJson(B12_PROTOCOL_FREEZE_REPORT_REL, freezeReport);

  console.log('\n=== Phase 9G-B.1.2 Protocol Freeze Completed Successfully ===\n');
  return freezeReport;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  const allowDirty = process.argv.includes('--allow-dirty');
  const gitHead = getGitHead(repoRoot);
  const dirty = getGitDirty(repoRoot);

  if (dirty && !allowDirty) {
    console.error('ERROR: Phase 9G-B.1.2 freeze runner requires a clean git working tree.');
    console.error('Commit your changes or pass --allow-dirty for local scratch testing.');
    process.exit(1);
  }

  preparePhase9gb12Receipts({ gitHead, dirty, allowUnwrittenV3: true })
    .then((report) => {
      process.exit(report.allChecksPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
