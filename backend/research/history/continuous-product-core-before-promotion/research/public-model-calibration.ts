import { createHash } from 'node:crypto';
import {
  PUBLIC_PROXY_BOOTSTRAP_CONFIG,
  publicProxyBootstrapCi,
  type PublicBootstrapConfig,
} from './public-fixed-bpm-benchmark';

export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V1_SHA256 = '5f0decb22200f51d295bbd3c60cd04481eec7661d7844e2b7c48b4f8b42ff56a';
export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2_SHA256 = 'eea0939a2c19727a0a93b2fdd3ce39e07d40dfa40a5f117a903552a080af4d5f';
export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V3_SHA256 = '9c6b3ca6cc46fd902a27cdf27825edd2833753cb15c9285e7c77365b3ff05130';
export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V4_SHA256 = 'b62f85cbc910d4a537214eed68c2d6e3accd3036417b16249d33d2e3a1a7cce9';
export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256 = '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6';

const PUBLIC_MODEL_CALIBRATION_PROTOCOL_ID = 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5';
const PUBLIC_MODEL_CALIBRATION_SCHEMA_VERSION = 5;
const PHASE_9GA = '9G-A';
const PHASE_9GA_CALIBRATION_PERFORMERS = ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'] as const;
const PHASE_9GA_BLIND_PERFORMERS = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'] as const;
const PHASE_9GA_POLICY_PATH = [
  'backend',
  'research',
  'policies',
  'public_model_calibration_protocol_v5_2026-10-09.json',
].join('/');

type Phase9GExecutionMode = 'CANDIDATE_INFERENCE' | 'TRUTH_ONLY';

interface PublicModelCalibrationPolicyIdentity {
  readonly path: string;
  readonly sha256: string;
  readonly policyId: string;
  readonly schemaVersion: number;
}

export interface Phase9GExecutionRequest {
  readonly phase: string;
  readonly mode: Phase9GExecutionMode;
  readonly scenarioSplit: string;
  readonly performers: readonly string[];
  readonly policy: PublicModelCalibrationPolicyIdentity;
}

export interface ByteDanceContextGeometry {
  readonly profileId: string;
  readonly modelInputMs: number;
  readonly nominalOwnedRegionMs?: number;
  readonly interiorPastContextMs?: number;
  readonly maximumFutureContextMs?: number;
  readonly futureContextMs?: number;
  readonly commitWidthMs?: number;
  readonly terminalWindowPolicy?: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1';
}

export const BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES: readonly ByteDanceContextGeometry[] = [
  { profileId: 'CALIBRATED_CONTEXT_1820', modelInputMs: 1820, futureContextMs: 220, commitWidthMs: 600 },
  { profileId: 'CALIBRATED_CONTEXT_3S', modelInputMs: 3000, nominalOwnedRegionMs: 1500, interiorPastContextMs: 750, maximumFutureContextMs: 750, terminalWindowPolicy: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1' },
  { profileId: 'CALIBRATED_CONTEXT_5S', modelInputMs: 5000, nominalOwnedRegionMs: 2500, interiorPastContextMs: 1250, maximumFutureContextMs: 1250, terminalWindowPolicy: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1' },
  { profileId: 'CALIBRATED_CONTEXT_10S', modelInputMs: 10000, nominalOwnedRegionMs: 5000, interiorPastContextMs: 2500, maximumFutureContextMs: 2500, terminalWindowPolicy: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1' },
];

export const BYTEDANCE_PHASE_9GA_THRESHOLD_GRID = {
  onset: [0.15, 0.20, 0.25, 0.30, 0.35],
  frame: [0.05, 0.10, 0.15, 0.20],
} as const;

export const ONLINE_AMT_TIMING_CALIBRATION_V1 = {
  algorithmId: 'ONLINE_AMT_TIMING_CALIBRATION_V1',
  rawTimingCorrectionMs: 0,
  matchWindowMs: 250,
  pitchRule: 'same-pitch-only',
  assignmentPriority: ['maximize-match-count', 'minimize-total-absolute-timing-error', 'deterministic-tie-break'],
  offsetDefinition: 'physicalAttackTimeMs - rawCandidateEventTimeMs',
  calibratedCorrection: 'median of matched signed offsets',
  forbiddenInputs: ['ExpectedStrike timing', 'counterfactual duplicate acoustic evidence', 'BLIND_EVALUATION data'],
} as const;

export const ONLINE_AMT_PHASE_9GA_POLICY_GRID = {
  pseudoIntensity: ['DISABLED', 'NATIVE'],
  onsetBoost: [2.0, 1.0],
  timingCorrection: ONLINE_AMT_TIMING_CALIBRATION_V1.algorithmId,
} as const;

export interface ByteDanceV4WindowPlan {
  readonly inputStartPerformanceMs: number;
  readonly inputEndPerformanceMs: number;
  readonly commitStartPerformanceMs: number;
  readonly commitEndPerformanceMs: number;
}

export function planByteDanceV4ContextWindowsForTest(
  completionMs: number,
  context: ByteDanceContextGeometry,
): readonly ByteDanceV4WindowPlan[] {
  if (context.profileId === 'CALIBRATED_CONTEXT_1820') {
    throw new Error('BYTE_DANCE_1820_USES_HISTORICAL_PLANNER');
  }
  const nominalOwnedRegionMs = context.nominalOwnedRegionMs;
  const maximumFutureContextMs = context.maximumFutureContextMs;
  if (nominalOwnedRegionMs === undefined || maximumFutureContextMs === undefined) {
    throw new Error(`BYTE_DANCE_V4_CONTEXT_GEOMETRY_INCOMPLETE:${context.profileId}`);
  }
  const plans: ByteDanceV4WindowPlan[] = [];
  let start = 0;
  while (start < completionMs || (completionMs === 0 && plans.length === 0)) {
    const end = Math.min(completionMs, start + nominalOwnedRegionMs);
    plans.push({
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputEndPerformanceMs: end + maximumFutureContextMs,
      inputStartPerformanceMs: end + maximumFutureContextMs - context.modelInputMs,
    });
    if (end === completionMs) break;
    start = end;
  }
  return plans;
}

export function onlineAmtTimingCorrectionForInScopePhysicalTruthForTest(
  candidateObservations: readonly { readonly pitch: string; readonly rawDecisionTimeMs: number }[],
  physicalAttacks: readonly { readonly pitch: string; readonly performanceTimeMs: number }[],
  completionMs: number,
): { readonly timingCorrectionMs: number | null; readonly matchedPostScopePhysicalPairCount: number; readonly lateInScopeDecisionPairCount: number } {
  const inScopePhysical = physicalAttacks.filter((attack) => attack.performanceTimeMs >= 0 && attack.performanceTimeMs <= completionMs);
  const pairs = greedySamePitchTimingPairs(candidateObservations, inScopePhysical, ONLINE_AMT_TIMING_CALIBRATION_V1.matchWindowMs);
  const offsets = pairs.map((pair) => pair.physicalTimeMs - pair.rawDecisionTimeMs).sort((left, right) => left - right);
  return {
    timingCorrectionMs: offsets.length === 0 ? null : percentileValue(offsets, 0.5),
    matchedPostScopePhysicalPairCount: 0,
    lateInScopeDecisionPairCount: pairs.filter((pair) => pair.rawDecisionTimeMs > completionMs).length,
  };
}

export function assertPublicModelCalibrationPolicyIdentity(identity: PublicModelCalibrationPolicyIdentity): void {
  const normalizedPath = identity.path.replaceAll('\\', '/');
  if (normalizedPath !== PHASE_9GA_POLICY_PATH) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_PATH_MISMATCH:${identity.path}`);
  }
  if (identity.policyId !== PUBLIC_MODEL_CALIBRATION_PROTOCOL_ID) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== PUBLIC_MODEL_CALIBRATION_SCHEMA_VERSION) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_SCHEMA_MISMATCH:${identity.schemaVersion}`);
  }
  if (identity.sha256 !== PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_SHA_MISMATCH:${identity.sha256}`);
  }
}

export function assertViennaPublicProxyExecutionAllowed(request: Phase9GExecutionRequest): void {
  assertPublicModelCalibrationPolicyIdentity(request.policy);
  const performers = normalizedUniquePerformers(request.performers);
  if (request.mode === 'CANDIDATE_INFERENCE' && includesBlindPerformer(performers)) {
    throw new Error('PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
  }
  if (!request.phase || request.phase !== PHASE_9GA) {
    if (request.mode === 'TRUTH_ONLY') {
      throw new Error(`PHASE_9GA_TRUTH_ONLY_PHASE_REQUIRED:${request.phase}`);
    }
    throw new Error(`PHASE_9GA_EXECUTION_PHASE_REQUIRED:${request.phase}`);
  }
  assertPhase9GExecutionAllowed(request);
}

export function assertPhase9GExecutionAllowed(request: Phase9GExecutionRequest): void {
  assertPublicModelCalibrationPolicyIdentity(request.policy);
  if (!request.phase || request.phase !== PHASE_9GA) {
    throw new Error(`PHASE_9GA_EXECUTION_PHASE_REQUIRED:${request.phase}`);
  }
  const performers = normalizedUniquePerformers(request.performers);
  if (request.mode === 'CANDIDATE_INFERENCE') {
    if (request.scenarioSplit !== 'CALIBRATION') {
      throw new Error(`PHASE_9GA_CANDIDATE_INFERENCE_REQUIRES_CALIBRATION:${request.scenarioSplit}`);
    }
    assertExactPerformerSet(performers, PHASE_9GA_CALIBRATION_PERFORMERS, 'PHASE_9GA_CALIBRATION_PERFORMER_SET_REQUIRED');
    return;
  }
  if (request.mode === 'TRUTH_ONLY') {
    if (request.scenarioSplit !== 'EVALUATION') {
      throw new Error(`PHASE_9GA_TRUTH_ONLY_BLIND_REQUIRES_EVALUATION:${request.scenarioSplit}`);
    }
    assertExactPerformerSet(performers, PHASE_9GA_BLIND_PERFORMERS, 'PHASE_9GA_TRUTH_ONLY_BLIND_PERFORMER_SET_REQUIRED');
    return;
  }
  throw new Error(`PHASE_9GA_UNKNOWN_EXECUTION_MODE:${String(request.mode)}`);
}

export function assertCandidateExecutorReachableForPhase9G(request: Phase9GExecutionRequest): void {
  assertViennaPublicProxyExecutionAllowed(request);
  if (request.mode !== 'CANDIDATE_INFERENCE') {
    throw new Error(`PHASE_9GA_CANDIDATE_EXECUTOR_FORBIDDEN_IN_MODE:${request.mode}`);
  }
}

export function runGuardedViennaCandidateExecutorsForTest(
  request: Phase9GExecutionRequest,
  executors: {
    readonly byteDance: () => void;
    readonly onlineAmt: () => void;
  },
): { readonly byteDanceExecutorCalls: number; readonly onlineAmtExecutorCalls: number } {
  assertViennaPublicProxyExecutionAllowed(request);
  if (request.mode === 'TRUTH_ONLY') {
    return { byteDanceExecutorCalls: 0, onlineAmtExecutorCalls: 0 };
  }
  assertCandidateExecutorReachableForPhase9G(request);
  executors.byteDance();
  executors.onlineAmt();
  return { byteDanceExecutorCalls: 1, onlineAmtExecutorCalls: 1 };
}

export function assertNoBlindPerformerCandidateInference(request: Phase9GExecutionRequest): void {
  const performers = normalizedUniquePerformers(request.performers);
  if (request.mode === 'CANDIDATE_INFERENCE' && includesBlindPerformer(performers)) {
    throw new Error('PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
  }
  assertPhase9GExecutionAllowed(request);
}

export interface CandidateExecutionIdentity {
  readonly candidateId: string;
  readonly candidateConfigurationSha256: string;
  readonly modelIdentity: string;
  readonly runtimeProfileIdentity: string;
}

export interface CandidateSpecificReuseInput {
  readonly candidateId: string;
  readonly sameSourceAudioSha: boolean;
  readonly samePerformanceOrigin: boolean;
  readonly sameCompletion: boolean;
  readonly sameGeometrySha: boolean;
  readonly baseExecutionIdentity: CandidateExecutionIdentity;
  readonly targetExecutionIdentity: CandidateExecutionIdentity;
}

export interface CandidateSpecificReuseDecision {
  readonly candidateId: string;
  readonly status: 'ACOUSTIC_EVIDENCE_REUSED_IDENTICAL_INPUT' | 'ACOUSTIC_EVIDENCE_REUSE_REJECTED';
  readonly baseCandidateConfigurationSha256: string;
  readonly targetCandidateConfigurationSha256: string;
  readonly sameFrozenCandidateConfiguration: boolean;
  readonly sameSourceAudioSha: boolean;
  readonly samePerformanceOrigin: boolean;
  readonly sameCompletion: boolean;
  readonly sameGeometrySha: boolean;
}

export function decideCandidateSpecificAcousticEvidenceReuse(input: CandidateSpecificReuseInput): CandidateSpecificReuseDecision {
  if (input.baseExecutionIdentity.candidateId !== input.candidateId) {
    throw new Error(`ACOUSTIC_REUSE_BASE_CANDIDATE_MISMATCH:${input.baseExecutionIdentity.candidateId}`);
  }
  if (input.targetExecutionIdentity.candidateId !== input.candidateId) {
    throw new Error(`ACOUSTIC_REUSE_TARGET_CANDIDATE_MISMATCH:${input.targetExecutionIdentity.candidateId}`);
  }
  const sameFrozenCandidateConfiguration =
    input.baseExecutionIdentity.candidateConfigurationSha256 === input.targetExecutionIdentity.candidateConfigurationSha256;
  const reusable = input.sameSourceAudioSha
    && input.samePerformanceOrigin
    && input.sameCompletion
    && input.sameGeometrySha
    && sameFrozenCandidateConfiguration
    && input.baseExecutionIdentity.modelIdentity === input.targetExecutionIdentity.modelIdentity
    && input.baseExecutionIdentity.runtimeProfileIdentity === input.targetExecutionIdentity.runtimeProfileIdentity;
  return {
    candidateId: input.candidateId,
    status: reusable ? 'ACOUSTIC_EVIDENCE_REUSED_IDENTICAL_INPUT' : 'ACOUSTIC_EVIDENCE_REUSE_REJECTED',
    baseCandidateConfigurationSha256: input.baseExecutionIdentity.candidateConfigurationSha256,
    targetCandidateConfigurationSha256: input.targetExecutionIdentity.candidateConfigurationSha256,
    sameFrozenCandidateConfiguration,
    sameSourceAudioSha: input.sameSourceAudioSha,
    samePerformanceOrigin: input.samePerformanceOrigin,
    sameCompletion: input.sameCompletion,
    sameGeometrySha: input.sameGeometrySha,
  };
}

export type CalibrationScenarioFamily =
  | 'BASE_ORIGINAL'
  | 'COUNTERFACTUAL_MISSING_NOTE'
  | 'COUNTERFACTUAL_EXTRA_NOTE'
  | 'COUNTERFACTUAL_WRONG_SEMITONE'
  | 'COUNTERFACTUAL_INCOMPLETE_CHORD';

export type CalibrationSelectionMetricName =
  | 'criticalFalseMatchRate'
  | 'incompleteChordFalseCompleteRate'
  | 'baseVerdictAgreementRate'
  | 'criticalCorrectMissingRate'
  | 'baseChordExactCompletenessRate'
  | 'baseExpectedStrikeRecall'
  | 'extraNoteExtraPrecision'
  | 'extraNoteExtraRecall'
  | 'baseTimingMedianMs'
  | 'baseTimingP95Ms';

type ScenarioRawMetricName =
  | 'falseMatchRateOnGroundTruthMissing'
  | 'falseCompleteChordAcceptanceRate'
  | 'verdictAgreementRate'
  | 'correctMissingRate'
  | 'chordExactCompletenessRate'
  | 'expectedStrikeRecall'
  | 'extraPrecision'
  | 'extraRecall'
  | 'timingAbsoluteMedianMs'
  | 'timingAbsoluteP95Ms';

export interface CalibrationScenarioMetricValue {
  readonly value: number;
  readonly numerator?: number;
  readonly denominator?: number;
}

export interface CalibrationProfileScenarioScore {
  readonly profileId: string;
  readonly scenarioId: string;
  readonly family: CalibrationScenarioFamily;
  readonly metrics: Partial<Record<ScenarioRawMetricName, CalibrationScenarioMetricValue>>;
}

export interface CalibrationProfileAbsoluteAggregate {
  readonly profileId: string;
  readonly metric: CalibrationSelectionMetricName;
  readonly value: number | null;
  readonly scenarioCount: number;
  readonly pooledNumerator?: number;
  readonly pooledDenominator?: number;
}

export interface CalibrationPairedProfileComparison {
  readonly metric: CalibrationSelectionMetricName;
  readonly leftProfileId: string;
  readonly rightProfileId: string;
  readonly pairedScenarioCount: number;
  readonly meanDifferenceLeftMinusRight: number | null;
  readonly bootstrap95Ci: { readonly low: number; readonly high: number; readonly seed: number; readonly draws: number } | null;
}

export interface CalibrationProfileSelection {
  readonly status: 'SELECTED' | 'GATE_1_TIE';
  readonly selectedProfileId: string | null;
  readonly remainingProfileIds: readonly string[];
  readonly decisions: readonly {
    readonly metric: CalibrationSelectionMetricName;
    readonly direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';
    readonly remainingProfileIds: readonly string[];
    readonly pairwiseComparisons: readonly CalibrationPairedProfileComparison[];
    readonly dominatedProfileIds: readonly string[];
    readonly pairwiseDominanceCycles: readonly (readonly string[])[];
    readonly cycleTreatedAsTie: boolean;
  }[];
  readonly absoluteAggregates: readonly CalibrationProfileAbsoluteAggregate[];
}

export interface CalibrationGate2Profile {
  readonly profileId: string;
  readonly contextProfileId: string;
  readonly modelInputMs: number;
  readonly onsetThreshold?: number;
  readonly frameThreshold?: number;
  readonly finalizedFeedbackAgeP95Ms: number | null;
  readonly configurationSha256: string;
}

export interface CalibrationGate2LatencyRow {
  readonly profileId: string;
  readonly contextProfileId: string;
  readonly onsetThreshold: number | null;
  readonly frameThreshold: number | null;
  readonly finalizedFeedbackAgeP95Ms: number | null;
  readonly deltaFromBestLatencyMs: number | null;
  readonly latencyDominated: boolean;
}

export interface CalibrationGate2Resolution {
  readonly selectedProfileId: string | null;
  readonly status: 'SELECTED' | 'TIE_UNRESOLVED';
  readonly reason:
    | 'GATE2_FINALIZED_FEEDBACK_AGE_P95_MS'
    | 'GATE2_CONTEXT_SIZE_TIE_BREAK'
    | 'NON_PERFORMANCE_NEUTRAL_HASH'
    | 'GATE2_LATENCY_UNAVAILABLE';
  readonly latencyThresholdMs: number;
  readonly latencyRows: readonly CalibrationGate2LatencyRow[];
  readonly profilesAfterLatency: readonly string[];
  readonly profilesAfterContext: readonly string[];
  readonly neutralTieKeys: readonly {
    readonly profileId: string;
    readonly tieKeySha256: string;
  }[];
}

const CRITICAL_FAMILIES = [
  'COUNTERFACTUAL_MISSING_NOTE',
  'COUNTERFACTUAL_WRONG_SEMITONE',
  'COUNTERFACTUAL_INCOMPLETE_CHORD',
] as const;

const CALIBRATION_PRIORITY: readonly {
  readonly name: CalibrationSelectionMetricName;
  readonly rawMetric: ScenarioRawMetricName;
  readonly direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';
  readonly families: readonly CalibrationScenarioFamily[];
  readonly minimumEffect: number;
  readonly minimumSamples: number;
}[] = [
  { name: 'criticalFalseMatchRate', rawMetric: 'falseMatchRateOnGroundTruthMissing', direction: 'LOWER_IS_BETTER', families: CRITICAL_FAMILIES, minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'incompleteChordFalseCompleteRate', rawMetric: 'falseCompleteChordAcceptanceRate', direction: 'LOWER_IS_BETTER', families: ['COUNTERFACTUAL_INCOMPLETE_CHORD'], minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseVerdictAgreementRate', rawMetric: 'verdictAgreementRate', direction: 'HIGHER_IS_BETTER', families: ['BASE_ORIGINAL'], minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'criticalCorrectMissingRate', rawMetric: 'correctMissingRate', direction: 'HIGHER_IS_BETTER', families: CRITICAL_FAMILIES, minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseChordExactCompletenessRate', rawMetric: 'chordExactCompletenessRate', direction: 'HIGHER_IS_BETTER', families: ['BASE_ORIGINAL'], minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseExpectedStrikeRecall', rawMetric: 'expectedStrikeRecall', direction: 'HIGHER_IS_BETTER', families: ['BASE_ORIGINAL'], minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'extraNoteExtraPrecision', rawMetric: 'extraPrecision', direction: 'HIGHER_IS_BETTER', families: ['COUNTERFACTUAL_EXTRA_NOTE'], minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'extraNoteExtraRecall', rawMetric: 'extraRecall', direction: 'HIGHER_IS_BETTER', families: ['COUNTERFACTUAL_EXTRA_NOTE'], minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseTimingMedianMs', rawMetric: 'timingAbsoluteMedianMs', direction: 'LOWER_IS_BETTER', families: ['BASE_ORIGINAL'], minimumEffect: 5, minimumSamples: 8 },
  { name: 'baseTimingP95Ms', rawMetric: 'timingAbsoluteP95Ms', direction: 'LOWER_IS_BETTER', families: ['BASE_ORIGINAL'], minimumEffect: 10, minimumSamples: 8 },
];

export function selectCalibrationProfile(
  scores: readonly CalibrationProfileScenarioScore[],
  bootstrap: PublicBootstrapConfig = PUBLIC_PROXY_BOOTSTRAP_CONFIG,
): CalibrationProfileSelection {
  const profileIds = [...new Set(scores.map((score) => score.profileId))].sort();
  if (profileIds.length === 0) throw new Error('CALIBRATION_PROFILE_SELECTION_REQUIRES_PROFILES');
  if (bootstrap.draws < 5_000) throw new Error('CALIBRATION_PROFILE_SELECTION_REQUIRES_5000_BOOTSTRAP_DRAWS');
  let remaining = profileIds;
  const decisions: CalibrationProfileSelection['decisions'][number][] = [];
  const absoluteAggregates = profileIds.flatMap((profileId) =>
    CALIBRATION_PRIORITY.map((priority) => absoluteAggregate(scores, profileId, priority))
  );
  for (const priority of CALIBRATION_PRIORITY) {
    if (remaining.length <= 1) break;
    const pairwiseComparisons = pairwiseComparisonsForPriority(scores, remaining, priority, bootstrap);
    const dominance = dominanceForPriority(pairwiseComparisons, priority);
    if (pairwiseComparisons.length === 0 || dominance.edges.length === 0) {
      decisions.push({
        metric: priority.name,
        direction: priority.direction,
        remainingProfileIds: remaining,
        pairwiseComparisons,
        dominatedProfileIds: [],
        pairwiseDominanceCycles: dominance.cycles,
        cycleTreatedAsTie: dominance.cycles.length > 0,
      });
      continue;
    }
    const cycleProfiles = new Set(dominance.cycles.flat());
    const dominatedProfileIds = [...new Set(dominance.edges
      .map((edge) => edge.to)
      .filter((profileId) => !cycleProfiles.has(profileId)))]
      .sort();
    remaining = remaining.filter((profileId) => !dominatedProfileIds.includes(profileId)).sort();
    decisions.push({
      metric: priority.name,
      direction: priority.direction,
      remainingProfileIds: remaining,
      pairwiseComparisons,
      dominatedProfileIds,
      pairwiseDominanceCycles: dominance.cycles,
      cycleTreatedAsTie: dominance.cycles.length > 0,
    });
  }
  return {
    status: remaining.length === 1 ? 'SELECTED' : 'GATE_1_TIE',
    selectedProfileId: remaining.length === 1 ? remaining[0] : null,
    remainingProfileIds: remaining,
    decisions,
    absoluteAggregates,
  };
}

export function resolveCalibrationGate2ExactProfile(
  profiles: readonly CalibrationGate2Profile[],
  latencyThresholdMs = 100,
): CalibrationGate2Resolution {
  if (profiles.length === 0) {
    throw new Error('CALIBRATION_GATE2_REQUIRES_PROFILES');
  }
  if (!Number.isFinite(latencyThresholdMs) || latencyThresholdMs <= 0) {
    throw new Error(`CALIBRATION_GATE2_INVALID_LATENCY_THRESHOLD:${latencyThresholdMs}`);
  }
  const ordered = [...profiles].sort((left, right) => left.profileId.localeCompare(right.profileId));
  const finiteLatencies = ordered
    .map((profile) => profile.finalizedFeedbackAgeP95Ms)
    .filter((value): value is number => Number.isFinite(value));
  const bestLatency = finiteLatencies.length === ordered.length ? Math.min(...finiteLatencies) : null;
  const latencyRows = ordered.map((profile): CalibrationGate2LatencyRow => {
    const latency = profile.finalizedFeedbackAgeP95Ms;
    const delta = bestLatency === null || latency === null ? null : latency - bestLatency;
    return {
      profileId: profile.profileId,
      contextProfileId: profile.contextProfileId,
      onsetThreshold: profile.onsetThreshold ?? null,
      frameThreshold: profile.frameThreshold ?? null,
      finalizedFeedbackAgeP95Ms: latency,
      deltaFromBestLatencyMs: delta,
      latencyDominated: delta !== null && delta >= latencyThresholdMs,
    };
  });
  const profilesAfterLatency = ordered
    .filter((profile) => {
      const row = latencyRows.find((candidate) => candidate.profileId === profile.profileId)!;
      return !row.latencyDominated;
    });
  const minimumContextMs = Math.min(...profilesAfterLatency.map((profile) => profile.modelInputMs));
  const profilesAfterContext = profilesAfterLatency
    .filter((profile) => profile.modelInputMs === minimumContextMs)
    .sort((left, right) => left.profileId.localeCompare(right.profileId));
  if (profilesAfterContext.length === 1) {
    return {
      selectedProfileId: profilesAfterContext[0].profileId,
      status: 'SELECTED',
      reason: bestLatency === null
        ? 'GATE2_LATENCY_UNAVAILABLE'
        : profilesAfterLatency.length === 1 && ordered.length > 1
          ? 'GATE2_FINALIZED_FEEDBACK_AGE_P95_MS'
          : 'GATE2_CONTEXT_SIZE_TIE_BREAK',
      latencyThresholdMs,
      latencyRows,
      profilesAfterLatency: profilesAfterLatency.map((profile) => profile.profileId),
      profilesAfterContext: profilesAfterContext.map((profile) => profile.profileId),
      neutralTieKeys: [],
    };
  }
  const neutralTieKeys = profilesAfterContext
    .map((profile) => ({
      profileId: profile.profileId,
      tieKeySha256: sha256Hex([
        'NOTEVERSE_NEUTRAL_CALIBRATION_TIE_V1',
        PUBLIC_MODEL_CALIBRATION_PROTOCOL_V4_SHA256,
        profile.configurationSha256,
      ].join('\n')),
    }))
    .sort((left, right) => left.tieKeySha256.localeCompare(right.tieKeySha256) || left.profileId.localeCompare(right.profileId));
  return {
    selectedProfileId: neutralTieKeys[0]?.profileId ?? null,
    status: neutralTieKeys.length > 0 ? 'SELECTED' : 'TIE_UNRESOLVED',
    reason: 'NON_PERFORMANCE_NEUTRAL_HASH',
    latencyThresholdMs,
    latencyRows,
    profilesAfterLatency: profilesAfterLatency.map((profile) => profile.profileId),
    profilesAfterContext: profilesAfterContext.map((profile) => profile.profileId),
    neutralTieKeys,
  };
}

function pairwiseComparisonsForPriority(
  scores: readonly CalibrationProfileScenarioScore[],
  profileIds: readonly string[],
  priority: typeof CALIBRATION_PRIORITY[number],
  bootstrap: PublicBootstrapConfig,
): CalibrationPairedProfileComparison[] {
  const sorted = [...profileIds].sort();
  const comparisons: CalibrationPairedProfileComparison[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      comparisons.push(pairedProfileComparison(scores, sorted[leftIndex], sorted[rightIndex], priority, bootstrap));
    }
  }
  return comparisons;
}

function dominanceForPriority(
  comparisons: readonly CalibrationPairedProfileComparison[],
  priority: typeof CALIBRATION_PRIORITY[number],
): {
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly cycles: readonly (readonly string[])[];
} {
  const edges = comparisons.flatMap((comparison) => {
    const direction = dominanceDirection(comparison, priority);
    if (direction === 'LEFT_DOMINATES_RIGHT') {
      return [{ from: comparison.leftProfileId, to: comparison.rightProfileId }];
    }
    if (direction === 'RIGHT_DOMINATES_LEFT') {
      return [{ from: comparison.rightProfileId, to: comparison.leftProfileId }];
    }
    return [];
  });
  return { edges, cycles: dominanceCycles(edges) };
}

function dominanceDirection(
  comparison: CalibrationPairedProfileComparison,
  priority: typeof CALIBRATION_PRIORITY[number],
): 'LEFT_DOMINATES_RIGHT' | 'RIGHT_DOMINATES_LEFT' | 'TIE' {
  if (comparison.pairedScenarioCount < priority.minimumSamples || comparison.meanDifferenceLeftMinusRight === null || comparison.bootstrap95Ci === null) {
    return 'TIE';
  }
  const mean = comparison.meanDifferenceLeftMinusRight;
  const ci = comparison.bootstrap95Ci;
  if (priority.direction === 'LOWER_IS_BETTER') {
    if (-mean >= priority.minimumEffect && ci.high < 0) return 'LEFT_DOMINATES_RIGHT';
    if (mean >= priority.minimumEffect && ci.low > 0) return 'RIGHT_DOMINATES_LEFT';
    return 'TIE';
  }
  if (mean >= priority.minimumEffect && ci.low > 0) return 'LEFT_DOMINATES_RIGHT';
  if (-mean >= priority.minimumEffect && ci.high < 0) return 'RIGHT_DOMINATES_LEFT';
  return 'TIE';
}

function dominanceCycles(edges: readonly { readonly from: string; readonly to: string }[]): readonly (readonly string[])[] {
  const nodes = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort();
  const outgoing = new Map(nodes.map((node) => [node, edges.filter((edge) => edge.from === node).map((edge) => edge.to)]));
  const cycles = new Set<string>();
  for (const node of nodes) {
    findCycles(node, node, [], outgoing, cycles);
  }
  return [...cycles].map((cycle) => cycle.split('|'));
}

function findCycles(
  start: string,
  current: string,
  path: readonly string[],
  outgoing: ReadonlyMap<string, readonly string[]>,
  cycles: Set<string>,
): void {
  const nextPath = [...path, current];
  for (const next of outgoing.get(current) ?? []) {
    if (next === start && nextPath.length > 1) {
      cycles.add([...nextPath].sort().join('|'));
      continue;
    }
    if (nextPath.includes(next)) continue;
    findCycles(start, next, nextPath, outgoing, cycles);
  }
}

export function pairedProfileComparison(
  scores: readonly CalibrationProfileScenarioScore[],
  leftProfileId: string,
  rightProfileId: string,
  priority: typeof CALIBRATION_PRIORITY[number],
  bootstrap: PublicBootstrapConfig = PUBLIC_PROXY_BOOTSTRAP_CONFIG,
): CalibrationPairedProfileComparison {
  const left = scenarioMetricMap(scores, leftProfileId, priority);
  const right = scenarioMetricMap(scores, rightProfileId, priority);
  const deltas = [...left.entries()].filter(([key]) => right.has(key)).map(([key, value]) => value - right.get(key)!);
  if (deltas.length === 0) {
    return { metric: priority.name, leftProfileId, rightProfileId, pairedScenarioCount: 0, meanDifferenceLeftMinusRight: null, bootstrap95Ci: null };
  }
  return {
    metric: priority.name,
    leftProfileId,
    rightProfileId,
    pairedScenarioCount: deltas.length,
    meanDifferenceLeftMinusRight: mean(deltas),
    bootstrap95Ci: deltas.length < 2 ? null : publicProxyBootstrapCi(deltas, bootstrap),
  };
}

function absoluteAggregate(
  scores: readonly CalibrationProfileScenarioScore[],
  profileId: string,
  priority: typeof CALIBRATION_PRIORITY[number],
): CalibrationProfileAbsoluteAggregate {
  const values = metricEntries(scores, profileId, priority);
  if (values.length === 0) return { profileId, metric: priority.name, value: null, scenarioCount: 0 };
  const numeratorEntries = values.filter((entry) => entry.metric.numerator !== undefined && entry.metric.denominator !== undefined);
  if (numeratorEntries.length > 0) {
    const pooledNumerator = numeratorEntries.reduce((sum, entry) => sum + entry.metric.numerator!, 0);
    const pooledDenominator = numeratorEntries.reduce((sum, entry) => sum + entry.metric.denominator!, 0);
    return {
      profileId,
      metric: priority.name,
      value: pooledDenominator > 0 ? pooledNumerator / pooledDenominator : null,
      scenarioCount: values.length,
      pooledNumerator,
      pooledDenominator,
    };
  }
  return { profileId, metric: priority.name, value: mean(values.map((entry) => entry.metric.value)), scenarioCount: values.length };
}

function scenarioMetricMap(
  scores: readonly CalibrationProfileScenarioScore[],
  profileId: string,
  priority: typeof CALIBRATION_PRIORITY[number],
): Map<string, number> {
  return new Map(metricEntries(scores, profileId, priority).map((entry) => [entry.key, entry.metric.value]));
}

function metricEntries(
  scores: readonly CalibrationProfileScenarioScore[],
  profileId: string,
  priority: typeof CALIBRATION_PRIORITY[number],
): { key: string; metric: CalibrationScenarioMetricValue }[] {
  return scores.flatMap((score) => {
    if (score.profileId !== profileId || !priority.families.includes(score.family)) return [];
    const metric = score.metrics[priority.rawMetric];
    if (!metric || !Number.isFinite(metric.value)) return [];
    if (metric.denominator !== undefined && metric.denominator <= 0) return [];
    return [{ key: `${score.family}|${score.scenarioId}`, metric }];
  });
}

function normalizedUniquePerformers(performers: readonly string[]): readonly string[] {
  return [...new Set(performers)].sort();
}

function includesBlindPerformer(performers: readonly string[]): boolean {
  return performers.some((performer) => (PHASE_9GA_BLIND_PERFORMERS as readonly string[]).includes(performer));
}

function assertExactPerformerSet(actual: readonly string[], expected: readonly string[], code: string): void {
  const same = actual.length === expected.length && actual.every((item, index) => item === expected[index]);
  if (!same) {
    if (includesBlindPerformer(actual)) throw new Error('PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
    throw new Error(`${code}:actual=${actual.join(',')}:expected=${expected.join(',')}`);
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('MEAN_REQUIRES_VALUES');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function greedySamePitchTimingPairs(
  candidateObservations: readonly { readonly pitch: string; readonly rawDecisionTimeMs: number }[],
  physicalAttacks: readonly { readonly pitch: string; readonly performanceTimeMs: number }[],
  matchWindowMs: number,
): { readonly rawDecisionTimeMs: number; readonly physicalTimeMs: number }[] {
  const pairs: { rawDecisionTimeMs: number; physicalTimeMs: number }[] = [];
  const pitches = new Set([...candidateObservations.map((item) => item.pitch), ...physicalAttacks.map((item) => item.pitch)]);
  for (const pitch of pitches) {
    const candidates = candidateObservations.filter((item) => item.pitch === pitch).sort((left, right) => left.rawDecisionTimeMs - right.rawDecisionTimeMs);
    const physical = physicalAttacks.filter((item) => item.pitch === pitch).sort((left, right) => left.performanceTimeMs - right.performanceTimeMs);
    const used = new Set<number>();
    for (const candidate of candidates) {
      let bestIndex = -1;
      let bestDistance = Infinity;
      for (let index = 0; index < physical.length; index += 1) {
        if (used.has(index)) continue;
        const distance = Math.abs(candidate.rawDecisionTimeMs - physical[index].performanceTimeMs);
        if (distance <= matchWindowMs && distance < bestDistance) {
          bestIndex = index;
          bestDistance = distance;
        }
      }
      if (bestIndex >= 0) {
        used.add(bestIndex);
        pairs.push({ rawDecisionTimeMs: candidate.rawDecisionTimeMs, physicalTimeMs: physical[bestIndex].performanceTimeMs });
      }
    }
  }
  return pairs;
}

function percentileValue(sortedValues: readonly number[], quantile: number): number {
  if (sortedValues.length === 0) throw new Error('PERCENTILE_REQUIRES_VALUES');
  const index = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}
