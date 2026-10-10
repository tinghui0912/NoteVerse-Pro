/**
 * Phase 9G-A.3 & 9G-A.3.1: Modern Challenger Qualification Protocol Implementation.
 *
 * Implements execution guards, policy identity verification, candidate context
 * eligibility, raw-cache integrity assertions, and score independence verification for:
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

export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2 = 'PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2' as const;
export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256 = 'b467e9aad917808f307346482477d1d4a4716aed665bd2662e87445231d12f8c' as const;

export const PHASE_9GA25_REGISTRY_PATH = 'backend/research/reports/phase9g_a25_final_incumbent_registry_2026-10-09.json' as const;
export const PHASE_9GA25_REGISTRY_SHA256 = '935fc1df28652b0927bc788e43e4ff89a2b9f76c2d0b5c7f58e307c5570d2439' as const;

export const PHASE_9GA1_CALIBRATION_SCENARIOS_PATH = 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json' as const;
export const PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256 = '56ef9dfcbb3cfbb64b8e87f9f4dd2d3a519be14412b4908f836926375560067e' as const;

export const PHASE_9GB_BLIND_MANIFEST_PATH = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json' as const;
export const PHASE_9GB_BLIND_MANIFEST_SHA256 = '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab' as const;

export const PHASE_9GA3 = '9G-A.3' as const;
export const PHASE_9GA31 = '9G-A.3.1' as const;

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
  readonly calibrationManifestSha256?: string;
  readonly phase: string;
  readonly mode: 'CANDIDATE_INFERENCE' | 'TRUTH_ONLY';
  readonly scenarioSplit: 'CALIBRATION' | 'EVALUATION';
  readonly performers: readonly string[];
}

export function assertChallengerQualificationPolicyIdentity(identity: ChallengerPolicyIdentity): void {
  if (identity.policyId === PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2) {
    if (identity.schemaVersion !== 2) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
    }
    if (identity.sha256 && identity.sha256 !== PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SHA_MISMATCH:${identity.sha256}`);
    }
    return;
  }

  if (identity.policyId === PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1) {
    if (identity.schemaVersion !== 1) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
    }
    if (identity.sha256 && identity.sha256 !== PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SHA_MISMATCH:${identity.sha256}`);
    }
    return;
  }

  throw new Error(`CHALLENGER_QUALIFICATION_POLICY_ID_MISMATCH:${identity.policyId}`);
}

export function assertChallengerExecutionAllowed(request: ChallengerExecutionRequest): void {
  // 1. Verify Challenger Policy identity
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
  if (request.calibrationManifestSha256 && request.calibrationManifestSha256 !== PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256) {
    throw new Error(`FROZEN_CALIBRATION_MANIFEST_SHA_MISMATCH:${request.calibrationManifestSha256}`);
  }

  // 3. Fail closed on missing, malformed, or non-9G-A phase
  const allowedPhases = [PHASE_9GA3, PHASE_9GA31] as const;
  if (!request.phase || !allowedPhases.includes(request.phase as typeof allowedPhases[number])) {
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

export interface IncumbentProfileRecord {
  readonly candidateId: string;
  readonly candidateFamily: string;
  readonly profileId: string;
  readonly configurationSha256: string;
  readonly checkpointSha256: string;
  readonly selectionStatus: string;
  readonly qualificationStatus: string;
  readonly LOCKED_FOR_PHASE_9G_B: boolean;
}

export function validateA25IncumbentRegistry(registryRaw: any): readonly IncumbentProfileRecord[] {
  if (!registryRaw || typeof registryRaw !== 'object') {
    throw new Error('INVALID_INCUMBENT_REGISTRY');
  }
  const profiles = registryRaw.profiles;
  if (!Array.isArray(profiles) || profiles.length !== 2) {
    throw new Error(`INCUMBENT_PROFILE_COUNT_MUST_BE_EXACTLY_TWO:got ${profiles?.length}`);
  }
  const bytedance = profiles.find((p: any) => p.candidateId === 'bytedance-original-calibrated-v1');
  const onlineAmt = profiles.find((p: any) => p.candidateId === 'online-amt-calibrated-v1');
  if (!bytedance || !onlineAmt) {
    throw new Error('MISSING_REQUIRED_INCUMBENT_PROFILES');
  }
  if (
    bytedance.profileId !== 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10'
    || bytedance.configurationSha256 !== '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285'
    || bytedance.checkpointSha256 !== 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141'
    || bytedance.LOCKED_FOR_PHASE_9G_B !== true
  ) {
    throw new Error('BYTEDANCE_INCUMBENT_IDENTITY_MISMATCH');
  }
  if (
    onlineAmt.profileId !== 'online-amt-calibration-native-boost-1'
    || onlineAmt.configurationSha256 !== '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375'
    || onlineAmt.checkpointSha256 !== '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0'
    || onlineAmt.LOCKED_FOR_PHASE_9G_B !== true
  ) {
    throw new Error('ONLINE_AMT_INCUMBENT_IDENTITY_MISMATCH');
  }
  return profiles;
}

export interface ChallengerCheckpointVerification {
  readonly candidateFamily: ChallengerFamily;
  readonly checkpointPath: string;
  readonly expectedSha256: string;
  readonly expectedBytes: number;
  readonly actualSha256: string;
  readonly actualBytes: number;
}

export function assertCheckpointIdentityStrict(check: ChallengerCheckpointVerification): void {
  if (check.actualSha256 !== check.expectedSha256) {
    throw new Error(`CHECKPOINT_SHA_MISMATCH:${check.candidateFamily}:expected ${check.expectedSha256}, got ${check.actualSha256}`);
  }
  if (check.actualBytes !== check.expectedBytes) {
    throw new Error(`CHECKPOINT_BYTES_MISMATCH:${check.candidateFamily}:expected ${check.expectedBytes}, got ${check.actualBytes}`);
  }
}

export function validateRobustByteDanceRawCache(rawData: any, expectedWindows: readonly any[]): boolean {
  if (!rawData || !Array.isArray(rawData.chunks)) {
    throw new Error('INVALID_ROBUST_BYTEDANCE_RAW_CACHE_SCHEMA');
  }
  if (rawData.chunks.length !== expectedWindows.length) {
    throw new Error(`ROBUST_BYTEDANCE_RAW_CACHE_WINDOW_COUNT_MISMATCH:expected ${expectedWindows.length}, got ${rawData.chunks.length}`);
  }
  const chunkMap = new Map<string, any>(rawData.chunks.map((c: any) => [c.windowId, c]));
  for (const win of expectedWindows) {
    const chunk = chunkMap.get(win.windowId);
    if (!chunk) throw new Error(`MISSING_WINDOW_IN_RAW_CACHE:${win.windowId}`);
    if (chunk.contextProfileId !== win.contextProfileId) throw new Error(`CONTEXT_MISMATCH_IN_RAW_CACHE:${win.windowId}`);
    if (chunk.inputSampleCount !== win.inputSampleCount) throw new Error(`SAMPLE_COUNT_MISMATCH_IN_RAW_CACHE:${win.windowId}`);
    const ro = chunk.rawOutputs;
    if (!ro?.frame_output?.data || !ro?.reg_onset_output?.data) throw new Error(`RAW_OUTPUTS_MISSING_IN_CACHE:${win.windowId}`);
    if (!ro.frame_output.float32ByteSha256 || !ro.reg_onset_output.float32ByteSha256) throw new Error(`FLOAT32_SHA_MISSING_IN_CACHE:${win.windowId}`);
  }
  return true;
}

export function validateTranscriptionRawCache(rawData: any, expectedAudioKeys: readonly string[]): boolean {
  if (!rawData || !rawData.transcriptions || typeof rawData.transcriptions !== 'object') {
    throw new Error('INVALID_TRANSCRIPTION_RAW_CACHE_SCHEMA');
  }
  for (const key of expectedAudioKeys) {
    const trans = rawData.transcriptions[key];
    if (!trans) throw new Error(`MISSING_AUDIO_IN_TRANSCRIPTION_CACHE:${key}`);
    if (!Array.isArray(trans.notes)) throw new Error(`MISSING_NOTES_IN_TRANSCRIPTION_CACHE:${key}`);
  }
  return true;
}

export interface CandidateContextEligibility {
  readonly scenarioId: string;
  readonly candidateFamily: ChallengerFamily;
  readonly isEligible: boolean;
  readonly preRollMs: number;
  readonly postRollMs: number;
  readonly requiredWindowMs: number;
  readonly contextProfileId?: string;
  readonly missingContextReason?: string;
  readonly scopeKind?: string;
}

export function deriveCandidateContextEligibility(input: {
  readonly scenarios: readonly any[];
  readonly candidateFamily: ChallengerFamily;
  readonly contextGeometries?: readonly any[];
}): CandidateContextEligibility[] {
  const result: CandidateContextEligibility[] = [];
  for (const scenario of input.scenarios) {
    const preRollMs = Math.max(0, scenario.audio.performanceOriginSourceMs - scenario.audio.clipStartMs);
    const postRollMs = Math.max(0, scenario.audio.clipEndMs - (scenario.audio.performanceOriginSourceMs + (scenario.completion?.performanceTimeMs ?? 30000)));

    if (input.candidateFamily === 'bytedance-robust-augmented') {
      const contexts = input.contextGeometries ?? [];
      for (const ctx of contexts) {
        const requiredWindowMs = ctx.modelInputMs;
        const requiredPreRoll = ctx.preRollRequiredMs ?? (ctx.modelInputMs - (ctx.maximumFutureContextMs ?? 0));
        const requiredPostRoll = ctx.maximumFutureContextMs ?? 0;
        const isEligible = preRollMs >= requiredPreRoll && postRollMs >= requiredPostRoll;
        result.push({
          scenarioId: scenario.scenarioId,
          candidateFamily: input.candidateFamily,
          contextProfileId: ctx.profileId,
          isEligible,
          preRollMs,
          postRollMs,
          requiredWindowMs,
          missingContextReason: isEligible ? undefined : 'INSUFFICIENT_PRE_OR_POST_ROLL_AUDIO',
          scopeKind: 'VARIABLE_CONTEXT_WINDOW',
        });
      }
    } else {
      // Whole-recording or segmentwise offline
      result.push({
        scenarioId: scenario.scenarioId,
        candidateFamily: input.candidateFamily,
        isEligible: true,
        preRollMs,
        postRollMs,
        requiredWindowMs: scenario.audio.clipEndMs - scenario.audio.clipStartMs,
        scopeKind: 'WHOLE_RECORDING_SOURCE_CONSUMED',
      });
    }
  }
  return result;
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

export function assertAcousticEvidenceScoreIndependent(
  baseRuns: readonly CandidateScenarioRun[],
  counterfactualRuns: readonly CandidateScenarioRun[],
  scenarioPairMap: ReadonlyMap<string, string>,
): { readonly verifiedScenarioCount: number; readonly identicalRunsCount: number } {
  let verified = 0;
  const baseRunMap = new Map(baseRuns.map((r) => [r.scenarioId, r]));

  for (const cfRun of counterfactualRuns) {
    const baseScenarioId = scenarioPairMap.get(cfRun.scenarioId);
    if (!baseScenarioId) continue;
    const baseRun = baseRunMap.get(baseScenarioId);
    if (!baseRun) continue;

    const baseObs = baseRun.publications.flatMap((p) => p.observations);
    const cfObs = cfRun.publications.flatMap((p) => p.observations);
    if (baseObs.length !== cfObs.length) {
      throw new Error(
        `SCORE_CONDITIONED_ACOUSTIC_OUTPUT_DETECTED:${cfRun.scenarioId}:observation count changed across counterfactual (${baseObs.length} vs ${cfObs.length})`
      );
    }
    for (let i = 0; i < baseObs.length; i++) {
      if (baseObs[i].pitch !== cfObs[i].pitch || Math.abs(baseObs[i].performanceTimeMs - cfObs[i].performanceTimeMs) > 1e-6) {
        throw new Error(`SCORE_CONDITIONED_ACOUSTIC_OUTPUT_DETECTED:${cfRun.scenarioId}:observation ${i} altered across counterfactual`);
      }
    }
    verified += 1;
  }
  return { verifiedScenarioCount: verified, identicalRunsCount: verified };
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

export function assertModelStateDictCompatibility(
  stateDictKeys: readonly string[],
  modelKeys: readonly string[],
  strict: boolean,
): { missingKeys: string[]; unexpectedKeys: string[] } {
  const modelKeySet = new Set(modelKeys);
  const stateDictKeySet = new Set(stateDictKeys);
  const missingKeys = modelKeys.filter((k) => !stateDictKeySet.has(k));
  const unexpectedKeys = stateDictKeys.filter((k) => !modelKeySet.has(k));

  if (strict && (missingKeys.length > 0 || unexpectedKeys.length > 0)) {
    throw new Error(
      `MODEL_STATE_DICT_MISMATCH: missing=${missingKeys.length}, unexpected=${unexpectedKeys.length}`
    );
  }
  return { missingKeys, unexpectedKeys };
}

export function assertCandidateCausalStreamingClaimsValid(candidate: {
  readonly candidateFamily: string;
  readonly executionMode?: string;
  readonly causalStreamingSupported?: boolean;
  readonly claimedStreaming?: boolean;
  readonly reportedFrameLatencyMs?: number | null;
}): void {
  if (candidate.candidateFamily === 'rtt') {
    if (
      candidate.causalStreamingSupported === true ||
      candidate.claimedStreaming === true ||
      candidate.executionMode === 'CAUSAL_STREAMING' ||
      (candidate.reportedFrameLatencyMs !== null && candidate.reportedFrameLatencyMs !== undefined)
    ) {
      throw new Error('RTT_CAUSAL_STREAMING_EXECUTION_FORBIDDEN: RTT is segmentwise offline reference only');
    }
  }
}

export function assertPublicationTimingValid(
  pub: {
    readonly availabilityTimeMs: number;
    readonly analyzedThroughPerformanceMs: number;
    readonly observations: readonly { readonly performanceTimeMs: number }[];
  },
  audio: {
    readonly clipStartMs: number;
    readonly clipEndMs: number;
    readonly performanceOriginSourceMs: number;
  },
  isCausal: boolean,
): void {
  if (isCausal) {
    if (pub.availabilityTimeMs < pub.analyzedThroughPerformanceMs) {
      throw new Error('AVAILABILITY_PRECEDES_ANALYZED_TIME_IN_CAUSAL_PUBLICATION');
    }
    const futureLeak = pub.observations.some(
      (o) => o.performanceTimeMs > pub.analyzedThroughPerformanceMs
    );
    if (futureLeak) {
      throw new Error('FUTURE_AUDIO_LEAK_IN_CAUSAL_PUBLICATION');
    }
  }
}

export function assertWholeRecordingPublicationTiming(
  pub: {
    readonly availabilityTimeMs: number;
    readonly analyzedThroughPerformanceMs: number;
  },
  audio: {
    readonly clipStartMs: number;
    readonly clipEndMs: number;
    readonly performanceOriginSourceMs: number;
  },
  inferenceLatencyMs: number,
): void {
  const sourceEndPerformanceMs = audio.clipEndMs - audio.performanceOriginSourceMs;
  if (pub.availabilityTimeMs < sourceEndPerformanceMs + inferenceLatencyMs) {
    throw new Error('WHOLE_RECORDING_PUBLICATION_PRECEDES_SOURCE_AUDIO_END');
  }
}

export function assertAriaPerFileLatencyReportValid(record: {
  readonly perFileLatencyStatus: string;
  readonly inferenceLatencyMs?: number | null;
  readonly batchWallTimeSeconds?: number;
}): void {
  if (record.perFileLatencyStatus === 'NOT_MEASURED' && record.inferenceLatencyMs !== null && record.inferenceLatencyMs !== undefined) {
    throw new Error('BATCH_AVERAGE_LATENCY_CANNOT_MASQUERADE_AS_PER_FILE_LATENCY');
  }
}

export function evaluatePairwiseComparison(
  candidateAId: string,
  candidateBId: string,
  runsA?: readonly any[],
  runsB?: readonly any[],
): { readonly status: 'EVALUATED' | 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE'; readonly reason?: string } {
  if (!runsA || !runsB || runsA.length === 0 || runsB.length === 0) {
    return {
      status: 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE',
      reason: 'Incumbent or candidate scenario-level runs not persisted; refusing to invent runs',
    };
  }
  return { status: 'EVALUATED' };
}

export function assertCleanWorkingTree(isDirty: boolean): void {
  if (isDirty) {
    throw new Error('EXECUTION_DIRTY_TREE_FORBIDDEN: Must execute from clean git working tree');
  }
}

export function assertCandidateQualificationForPhase9GB(candidate: {
  readonly candidateFamily: string;
  readonly qualificationStatus: string;
  readonly lockedForPhase9gB: boolean;
}): void {
  if (candidate.lockedForPhase9gB) {
    if (candidate.qualificationStatus !== 'CALIBRATED_AND_LOCKED_FOR_RESEARCH' && candidate.qualificationStatus !== 'CALIBRATED_AND_LOCKED') {
      throw new Error(`UNQUALIFIED_CANDIDATE_CANNOT_BE_LOCKED_FOR_PHASE_9G_B:${candidate.candidateFamily}:${candidate.qualificationStatus}`);
    }
  }
}

export function assertContextEligibilityScoreIndependent(
  baseEligibility: readonly CandidateContextEligibility[],
  cfEligibility: readonly CandidateContextEligibility[],
): void {
  if (baseEligibility.length !== cfEligibility.length) {
    throw new Error('CONTEXT_ELIGIBILITY_COUNT_MISMATCH');
  }
  for (let i = 0; i < baseEligibility.length; i++) {
    const b = baseEligibility[i];
    const c = cfEligibility[i];
    if (
      b.isEligible !== c.isEligible ||
      b.preRollMs !== c.preRollMs ||
      b.postRollMs !== c.postRollMs ||
      b.requiredWindowMs !== c.requiredWindowMs
    ) {
      throw new Error(`CONTEXT_ELIGIBILITY_ALTERED_BY_COUNTERFACTUAL:${b.scenarioId}`);
    }
  }
}
