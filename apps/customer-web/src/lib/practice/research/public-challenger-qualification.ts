/**
 * Phase 9G-A.3: Modern Challenger Qualification Protocol Implementation.
 *
 * Implements execution guards, policy identity verification, candidate context
 * eligibility, and qualification assertions for Phase 9G-A.3 challengers:
 * 1. Robust augmented ByteDance (bytedance-robust-augmented)
 * 2. Transkun V2 Aug (transkun)
 * 3. Aria-AMT (aria-amt)
 * 4. RTT (rtt)
 * 5. D3RM (optional offline accuracy ceiling reference)
 */

import {
  PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256,
  selectCalibrationProfile,
  resolveCalibrationGate2ExactProfile,
  type CalibrationProfileScenarioScore,
  type CalibrationGate2Profile,
} from './public-model-calibration';
import type { CandidateObservation, CandidatePublication, CandidateScenarioRun } from './continuous-analyzer-bakeoff';

export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5 = 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5' as const;
export const CHALLENGER_CALIBRATION_PERFORMERS = ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'] as const;
export const CHALLENGER_BLIND_PERFORMERS = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'] as const;

export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1 = 'PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1' as const;
export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256 = '0ccd4872d6998b67d794baf96cad22c5ccbba3f8ee65a9ac02ba1ad9790ec71b' as const;

export const PHASE_9GA25_REGISTRY_PATH = 'backend/research/reports/phase9g_a25_final_incumbent_registry_2026-10-09.json' as const;
export const PHASE_9GA25_REGISTRY_SHA256 = '935fc1df28652b0927bc788e43e4ff89a2b9f76c2d0b5c7f58e307c5570d2439' as const;

export const PHASE_9GA1_CALIBRATION_SCENARIOS_PATH = 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json' as const;
export const PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256 = '56ef9dfcbb3cfbb64b8e87f9f4dd2d3a519be14412b4908f836926375560067e' as const;

export const PHASE_9GB_BLIND_MANIFEST_PATH = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json' as const;
export const PHASE_9GB_BLIND_MANIFEST_SHA256 = '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab' as const;

export const PHASE_9GA3 = '9G-A.3' as const;

export type ChallengerFamily =
  | 'bytedance-robust-augmented'
  | 'transkun'
  | 'aria-amt'
  | 'rtt'
  | 'd3rm';

export type ProductionLicenseStatus =
  | 'PRODUCTION_LICENSE_ELIGIBLE'
  | 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED'
  | 'LICENSE_OR_USAGE_RIGHTS_UNRESOLVED';

export interface ChallengerPolicyIdentity {
  readonly policyId: string;
  readonly schemaVersion: number;
  readonly sha256?: string;
}

export interface ChallengerExecutionRequest {
  readonly policy: ChallengerPolicyIdentity;
  readonly incumbentPolicySha256: string;
  readonly incumbentRegistrySha256: string;
  readonly blindManifestSha256: string;
  readonly phase: string;
  readonly mode: 'CANDIDATE_INFERENCE' | 'TRUTH_ONLY';
  readonly scenarioSplit: 'CALIBRATION' | 'EVALUATION';
  readonly performers: readonly string[];
}

export function assertChallengerQualificationPolicyIdentity(identity: ChallengerPolicyIdentity): void {
  if (identity.policyId !== PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1) {
    throw new Error(`CHALLENGER_QUALIFICATION_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== 1) {
    throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
  }
  if (identity.sha256 && identity.sha256 !== PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256) {
    throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SHA_MISMATCH:${identity.sha256}`);
  }
}

export function assertChallengerExecutionAllowed(request: ChallengerExecutionRequest): void {
  // 1. Verify Challenger V1 Policy identity
  assertChallengerQualificationPolicyIdentity(request.policy);

  // 2. Independently verify frozen V5 incumbent policy, registry, and blind identities
  if (request.incumbentPolicySha256 !== PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256) {
    throw new Error(`FROZEN_V5_INCUMBENT_POLICY_SHA_MISMATCH:${request.incumbentPolicySha256}`);
  }
  if (request.incumbentRegistrySha256 !== PHASE_9GA25_REGISTRY_SHA256) {
    throw new Error(`FROZEN_A25_INCUMBENT_REGISTRY_SHA_MISMATCH:${request.incumbentRegistrySha256}`);
  }
  if (request.blindManifestSha256 !== PHASE_9GB_BLIND_MANIFEST_SHA256) {
    throw new Error(`FROZEN_BLIND_MANIFEST_SHA_MISMATCH:${request.blindManifestSha256}`);
  }

  // 3. Fail closed on missing, malformed, or non-9G-A.3 phase
  if (!request.phase || request.phase !== PHASE_9GA3) {
    if (request.mode === 'TRUTH_ONLY') {
      throw new Error(`CHALLENGER_TRUTH_ONLY_PHASE_REQUIRED:${request.phase}`);
    }
    throw new Error(`CHALLENGER_EXECUTION_PHASE_REQUIRED:${request.phase}`);
  }

  // 4. Performer set and blind isolation guards
  const performers = [...new Set(request.performers)].sort();
  const includesBlind = performers.some((p) => (CHALLENGER_BLIND_PERFORMERS as readonly string[]).includes(p));

  if (request.mode === 'CANDIDATE_INFERENCE') {
    if (includesBlind) {
      throw new Error('CHALLENGER_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
    }
    if (request.scenarioSplit !== 'CALIBRATION') {
      throw new Error(`CHALLENGER_CANDIDATE_INFERENCE_REQUIRES_CALIBRATION:${request.scenarioSplit}`);
    }
    const expected = [...CHALLENGER_CALIBRATION_PERFORMERS].sort();
    if (performers.length !== expected.length || performers.some((p, i) => p !== expected[i])) {
      throw new Error('CHALLENGER_CALIBRATION_PERFORMER_SET_REQUIRED');
    }
    return;
  }

  if (request.mode === 'TRUTH_ONLY') {
    if (request.scenarioSplit !== 'EVALUATION') {
      throw new Error(`CHALLENGER_TRUTH_ONLY_REQUIRES_EVALUATION:${request.scenarioSplit}`);
    }
    const expected = [...CHALLENGER_BLIND_PERFORMERS].sort();
    if (performers.length !== expected.length || performers.some((p, i) => p !== expected[i])) {
      throw new Error('CHALLENGER_TRUTH_ONLY_BLIND_PERFORMER_SET_REQUIRED');
    }
    return;
  }

  throw new Error(`CHALLENGER_UNKNOWN_EXECUTION_MODE:${String(request.mode)}`);
}

export function runGuardedViennaChallengerExecutorsForTest(
  request: ChallengerExecutionRequest,
  executors: {
    readonly robustByteDance?: () => void;
    readonly transkun?: () => void;
    readonly aria?: () => void;
    readonly rtt?: () => void;
  },
): {
  readonly robustByteDanceCalls: number;
  readonly transkunCalls: number;
  readonly ariaCalls: number;
  readonly rttCalls: number;
} {
  assertChallengerExecutionAllowed(request);
  if (request.mode === 'TRUTH_ONLY') {
    return { robustByteDanceCalls: 0, transkunCalls: 0, ariaCalls: 0, rttCalls: 0 };
  }
  let robustByteDanceCalls = 0;
  let transkunCalls = 0;
  let ariaCalls = 0;
  let rttCalls = 0;

  if (executors.robustByteDance) {
    executors.robustByteDance();
    robustByteDanceCalls += 1;
  }
  if (executors.transkun) {
    executors.transkun();
    transkunCalls += 1;
  }
  if (executors.aria) {
    executors.aria();
    ariaCalls += 1;
  }
  if (executors.rtt) {
    executors.rtt();
    rttCalls += 1;
  }
  return { robustByteDanceCalls, transkunCalls, ariaCalls, rttCalls };
}

export interface CandidateContextEligibility {
  readonly scenarioId: string;
  readonly candidateFamily: ChallengerFamily;
  readonly isEligible: boolean;
  readonly preRollMs: number;
  readonly postRollMs: number;
  readonly requiredWindowMs: number;
  readonly missingContextReason?: string;
}

export function assertCandidateContextEligibilityFrozen(
  eligibilityList: readonly CandidateContextEligibility[],
): void {
  for (const item of eligibilityList) {
    if (!item.scenarioId || !item.candidateFamily) {
      throw new Error('INVALID_ELIGIBILITY_RECORD');
    }
  }
}

export function assertCandidateRawInferenceScoreIndependent(
  observations: readonly CandidateObservation[],
  expectedScorePitches: ReadonlySet<string>,
): { readonly containsOffScorePitch: boolean; readonly offScoreCount: number } {
  let offScoreCount = 0;
  for (const obs of observations) {
    if (!expectedScorePitches.has(obs.pitch)) {
      offScoreCount += 1;
    }
  }
  return {
    containsOffScorePitch: offScoreCount > 0,
    offScoreCount,
  };
}

export function assertCounterfactualAcousticReuseValid(input: {
  readonly baseAudioSha256: string;
  readonly counterfactualAudioSha256: string;
  readonly modelCheckpointSha256: string;
  readonly cachedModelCheckpointSha256: string;
}): boolean {
  if (input.baseAudioSha256 !== input.counterfactualAudioSha256) {
    throw new Error('COUNTERFACTUAL_AUDIO_MISMATCH_CANNOT_REUSE_ACOUSTIC_EVIDENCE');
  }
  if (input.modelCheckpointSha256 !== input.cachedModelCheckpointSha256) {
    throw new Error('MODEL_CHECKPOINT_MISMATCH_CANNOT_REUSE_ACOUSTIC_EVIDENCE');
  }
  return true;
}

export function selectWithinFamilyRepresentative(input: {
  readonly candidateFamily: ChallengerFamily;
  readonly scores: readonly CalibrationProfileScenarioScore[];
  readonly gate2Profiles?: readonly CalibrationGate2Profile[];
}): {
  readonly candidateFamily: ChallengerFamily;
  readonly selectedProfileId: string;
  readonly selectionMethod: string;
} {
  if (input.scores.length === 0) {
    throw new Error(`NO_SCORES_FOR_FAMILY:${input.candidateFamily}`);
  }
  const profileIds = [...new Set(input.scores.map((s) => s.profileId))];
  if (profileIds.length === 1) {
    return {
      candidateFamily: input.candidateFamily,
      selectedProfileId: profileIds[0],
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
    };
  }

  // Gate 1: safety-first paired bootstrap dominance
  const gate1Selection = selectCalibrationProfile(input.scores);
  if (gate1Selection.selectedProfileId) {
    return {
      candidateFamily: input.candidateFamily,
      selectedProfileId: gate1Selection.selectedProfileId,
      selectionMethod: 'GATE1_SAFETY_FIRST_DOMINANCE',
    };
  }

  // Gate 2: latency dominance, context tie-break, neutral hash
  if (input.gate2Profiles && input.gate2Profiles.length > 0) {
    const gate2Selection = resolveCalibrationGate2ExactProfile(input.gate2Profiles);
    if (!gate2Selection.selectedProfileId) {
      throw new Error(`GATE2_UNRESOLVED_FOR_FAMILY:${input.candidateFamily}`);
    }
    return {
      candidateFamily: input.candidateFamily,
      selectedProfileId: gate2Selection.selectedProfileId,
      selectionMethod: gate2Selection.reason,
    };
  }

  throw new Error(`CANNOT_RESOLVE_REPRESENTATIVE_FOR_FAMILY:${input.candidateFamily}`);
}
