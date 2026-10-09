import {
  PUBLIC_PROXY_BOOTSTRAP_CONFIG,
  publicProxyBootstrapCi,
  type PublicBootstrapConfig,
} from './public-fixed-bpm-benchmark';

export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V1_SHA256 = '5f0decb22200f51d295bbd3c60cd04481eec7661d7844e2b7c48b4f8b42ff56a';
export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2_SHA256 = 'eea0939a2c19727a0a93b2fdd3ce39e07d40dfa40a5f117a903552a080af4d5f';

const PUBLIC_MODEL_CALIBRATION_PROTOCOL_ID = 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2';
const PUBLIC_MODEL_CALIBRATION_SCHEMA_VERSION = 2;
const PHASE_9GA = '9G-A';
const PHASE_9GA_CALIBRATION_PERFORMERS = ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'] as const;
const PHASE_9GA_BLIND_PERFORMERS = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'] as const;
const PHASE_9GA_POLICY_PATH = [
  'backend',
  'research',
  'policies',
  'public_model_calibration_protocol_v2_2026-10-09.json',
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
  readonly ownedCentralRegionMs?: number;
  readonly pastContextMs?: number;
  readonly futureContextMs: number;
  readonly commitWidthMs?: number;
}

export const BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES: readonly ByteDanceContextGeometry[] = [
  { profileId: 'CURRENT_BASELINE', modelInputMs: 1820, futureContextMs: 220, commitWidthMs: 600 },
  { profileId: 'INTERMEDIATE_CONTEXT_3S', modelInputMs: 3000, ownedCentralRegionMs: 1500, pastContextMs: 750, futureContextMs: 750 },
  { profileId: 'INTERMEDIATE_CONTEXT_5S', modelInputMs: 5000, ownedCentralRegionMs: 2500, pastContextMs: 1250, futureContextMs: 1250 },
  { profileId: 'UPSTREAM_10S_REFERENCE', modelInputMs: 10000, ownedCentralRegionMs: 5000, pastContextMs: 2500, futureContextMs: 2500 },
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
  if (identity.sha256 !== PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2_SHA256) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_SHA_MISMATCH:${identity.sha256}`);
  }
}

export function assertViennaPublicProxyExecutionAllowed(request: Phase9GExecutionRequest): void {
  assertPublicModelCalibrationPolicyIdentity(request.policy);
  const performers = normalizedUniquePerformers(request.performers);
  if (request.mode === 'CANDIDATE_INFERENCE' && includesBlindPerformer(performers)) {
    throw new Error('PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
  }
  if (request.phase !== PHASE_9GA) {
    if (request.mode === 'CANDIDATE_INFERENCE') return;
    throw new Error(`PHASE_9GA_TRUTH_ONLY_PHASE_REQUIRED:${request.phase}`);
  }
  assertPhase9GExecutionAllowed(request);
}

export function assertPhase9GExecutionAllowed(request: Phase9GExecutionRequest): void {
  assertPublicModelCalibrationPolicyIdentity(request.policy);
  if (request.phase !== PHASE_9GA) {
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
  }[];
  readonly absoluteAggregates: readonly CalibrationProfileAbsoluteAggregate[];
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
    const best = bestProfileForPriority(scores, remaining, priority);
    if (!best) {
      decisions.push({ metric: priority.name, direction: priority.direction, remainingProfileIds: remaining, pairwiseComparisons: [] });
      continue;
    }
    const pairwiseComparisons = remaining
      .filter((profileId) => profileId !== best)
      .map((profileId) => pairedProfileComparison(scores, best, profileId, priority, bootstrap));
    remaining = remaining.filter((profileId) => {
      if (profileId === best) return true;
      const comparison = pairwiseComparisons.find((item) => item.rightProfileId === profileId);
      return !comparison || !isRightProfileMeaningfullyWorse(comparison, priority);
    }).sort();
    decisions.push({ metric: priority.name, direction: priority.direction, remainingProfileIds: remaining, pairwiseComparisons });
  }
  return {
    status: remaining.length === 1 ? 'SELECTED' : 'GATE_1_TIE',
    selectedProfileId: remaining.length === 1 ? remaining[0] : null,
    remainingProfileIds: remaining,
    decisions,
    absoluteAggregates,
  };
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

function bestProfileForPriority(
  scores: readonly CalibrationProfileScenarioScore[],
  profileIds: readonly string[],
  priority: typeof CALIBRATION_PRIORITY[number],
): string | null {
  const aggregates = profileIds
    .map((profileId) => absoluteAggregate(scores, profileId, priority))
    .filter((aggregate) => aggregate.value !== null) as (CalibrationProfileAbsoluteAggregate & { value: number })[];
  if (aggregates.length === 0) return null;
  return aggregates.sort((left, right) => {
    const delta = left.value - right.value;
    return (priority.direction === 'LOWER_IS_BETTER' ? delta : -delta) || left.profileId.localeCompare(right.profileId);
  })[0].profileId;
}

function isRightProfileMeaningfullyWorse(
  comparison: CalibrationPairedProfileComparison,
  priority: typeof CALIBRATION_PRIORITY[number],
): boolean {
  if (comparison.pairedScenarioCount < priority.minimumSamples || comparison.meanDifferenceLeftMinusRight === null || comparison.bootstrap95Ci === null) {
    return false;
  }
  if (priority.direction === 'LOWER_IS_BETTER') {
    const rightMinusLeft = -comparison.meanDifferenceLeftMinusRight;
    return rightMinusLeft >= priority.minimumEffect && comparison.bootstrap95Ci.high < 0;
  }
  return comparison.meanDifferenceLeftMinusRight >= priority.minimumEffect && comparison.bootstrap95Ci.low > 0;
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
