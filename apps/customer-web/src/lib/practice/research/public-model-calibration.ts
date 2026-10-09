import type { PublicPairedMetricComparison } from './public-fixed-bpm-benchmark';

const PUBLIC_MODEL_CALIBRATION_PROTOCOL_ID = 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V1';
const PUBLIC_MODEL_CALIBRATION_SCHEMA_VERSION = 1;
const PHASE_9GA = '9G-A';
const PHASE_9GA_CALIBRATION_PERFORMERS = ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'] as const;
const PHASE_9GA_BLIND_PERFORMERS = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'] as const;
const PHASE_9GA_POLICY_FILE = 'public_model_calibration_protocol_v1_2026-10-09.json';

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
  {
    profileId: 'CURRENT_BASELINE',
    modelInputMs: 1820,
    futureContextMs: 220,
    commitWidthMs: 600,
  },
  {
    profileId: 'INTERMEDIATE_CONTEXT_3S',
    modelInputMs: 3000,
    ownedCentralRegionMs: 1500,
    pastContextMs: 750,
    futureContextMs: 750,
  },
  {
    profileId: 'INTERMEDIATE_CONTEXT_5S',
    modelInputMs: 5000,
    ownedCentralRegionMs: 2500,
    pastContextMs: 1250,
    futureContextMs: 1250,
  },
  {
    profileId: 'UPSTREAM_10S_REFERENCE',
    modelInputMs: 10000,
    ownedCentralRegionMs: 5000,
    pastContextMs: 2500,
    futureContextMs: 2500,
  },
];

const BYTEDANCE_PHASE_9GA_THRESHOLD_GRID = {
  onset: [0.15, 0.20, 0.25, 0.30, 0.35],
  frame: [0.05, 0.10, 0.15, 0.20],
} as const;

export const ONLINE_AMT_TIMING_CALIBRATION_V1 = {
  algorithmId: 'ONLINE_AMT_TIMING_CALIBRATION_V1',
  rawTimingCorrectionMs: 0,
  matchWindowMs: 250,
  pitchRule: 'same-pitch-only',
  assignmentPriority: [
    'maximize-match-count',
    'minimize-total-absolute-timing-error',
    'deterministic-tie-break',
  ],
  offsetDefinition: 'physicalAttackTimeMs - rawCandidateEventTimeMs',
  calibratedCorrection: 'median of matched signed offsets',
  forbiddenInputs: [
    'ExpectedStrike timing',
    'counterfactual duplicate acoustic evidence',
    'BLIND_EVALUATION data',
  ],
} as const;

const ONLINE_AMT_PHASE_9GA_POLICY_GRID = {
  pseudoIntensity: ['DISABLED', 'NATIVE'],
  onsetBoost: [2.0, 1.0],
  timingCorrection: ONLINE_AMT_TIMING_CALIBRATION_V1.algorithmId,
} as const;

export function assertPublicModelCalibrationPolicyIdentity(
  identity: PublicModelCalibrationPolicyIdentity,
): void {
  if (!identity.path.replaceAll('\\', '/').endsWith(PHASE_9GA_POLICY_FILE)) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_PATH_MISMATCH:${identity.path}`);
  }
  if (identity.policyId !== PUBLIC_MODEL_CALIBRATION_PROTOCOL_ID) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== PUBLIC_MODEL_CALIBRATION_SCHEMA_VERSION) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_SCHEMA_MISMATCH:${identity.schemaVersion}`);
  }
  if (!/^[a-f0-9]{64}$/.test(identity.sha256)) {
    throw new Error(`PUBLIC_MODEL_CALIBRATION_POLICY_SHA_INVALID:${identity.sha256}`);
  }
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
  assertPhase9GExecutionAllowed(request);
  if (request.mode !== 'CANDIDATE_INFERENCE') {
    throw new Error(`PHASE_9GA_CANDIDATE_EXECUTOR_FORBIDDEN_IN_MODE:${request.mode}`);
  }
}

function assertNoBlindPerformerCandidateInference(request: Phase9GExecutionRequest): void {
  const performers = normalizedUniquePerformers(request.performers);
  if (
    request.phase === PHASE_9GA
    && request.mode === 'CANDIDATE_INFERENCE'
    && performers.some((performer) => (PHASE_9GA_BLIND_PERFORMERS as readonly string[]).includes(performer))
  ) {
    throw new Error('PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
  }
  assertPhase9GExecutionAllowed(request);
}

interface CalibrationMetricEstimate {
  readonly meanDifference: number;
  readonly bootstrap95Ci: { readonly low: number; readonly high: number } | null;
  readonly pairedScenarioCount: number;
}

export interface CalibrationProfileEvidence {
  readonly profileId: string;
  readonly metrics: {
    readonly criticalFalseMatchRate: CalibrationMetricEstimate;
    readonly incompleteChordFalseCompleteRate: CalibrationMetricEstimate;
    readonly baseVerdictAgreementRate: CalibrationMetricEstimate;
    readonly criticalCorrectMissingRate: CalibrationMetricEstimate;
    readonly baseChordExactCompletenessRate: CalibrationMetricEstimate;
    readonly baseExpectedStrikeRecall: CalibrationMetricEstimate;
    readonly extraNoteExtraPrecision: CalibrationMetricEstimate;
    readonly extraNoteExtraRecall: CalibrationMetricEstimate;
    readonly baseTimingMedianMs: CalibrationMetricEstimate;
    readonly baseTimingP95Ms: CalibrationMetricEstimate;
  };
  readonly latency?: {
    readonly medianMs: number;
    readonly p95Ms: number;
  };
}

export interface CalibrationProfileSelection {
  readonly status: 'SELECTED' | 'GATE_1_TIE';
  readonly selectedProfileId: string | null;
  readonly remainingProfileIds: readonly string[];
  readonly decisions: readonly {
    readonly metric: string;
    readonly direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';
    readonly remainingProfileIds: readonly string[];
  }[];
}

type CalibrationMetricName = keyof CalibrationProfileEvidence['metrics'];

const CALIBRATION_PRIORITY: readonly {
  readonly name: CalibrationMetricName;
  readonly direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';
  readonly minimumEffect: number;
  readonly minimumSamples: number;
}[] = [
  { name: 'criticalFalseMatchRate', direction: 'LOWER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'incompleteChordFalseCompleteRate', direction: 'LOWER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseVerdictAgreementRate', direction: 'HIGHER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'criticalCorrectMissingRate', direction: 'HIGHER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseChordExactCompletenessRate', direction: 'HIGHER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseExpectedStrikeRecall', direction: 'HIGHER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'extraNoteExtraPrecision', direction: 'HIGHER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'extraNoteExtraRecall', direction: 'HIGHER_IS_BETTER', minimumEffect: 0.01, minimumSamples: 8 },
  { name: 'baseTimingMedianMs', direction: 'LOWER_IS_BETTER', minimumEffect: 5, minimumSamples: 8 },
  { name: 'baseTimingP95Ms', direction: 'LOWER_IS_BETTER', minimumEffect: 10, minimumSamples: 8 },
];

export function selectCalibrationProfile(
  profiles: readonly CalibrationProfileEvidence[],
): CalibrationProfileSelection {
  if (profiles.length === 0) throw new Error('CALIBRATION_PROFILE_SELECTION_REQUIRES_PROFILES');
  let remaining = [...profiles].sort((left, right) => left.profileId.localeCompare(right.profileId));
  const decisions: CalibrationProfileSelection['decisions'][number][] = [];
  for (const priority of CALIBRATION_PRIORITY) {
    if (remaining.length <= 1) break;
    const best = bestProfileForMetric(remaining, priority.name, priority.direction);
    remaining = remaining.filter((profile) =>
      !isMeaningfullyWorseThanBest(profile.metrics[priority.name], best.metrics[priority.name], priority)
    );
    decisions.push({
      metric: priority.name,
      direction: priority.direction,
      remainingProfileIds: remaining.map((profile) => profile.profileId),
    });
  }
  return {
    status: remaining.length === 1 ? 'SELECTED' : 'GATE_1_TIE',
    selectedProfileId: remaining.length === 1 ? remaining[0].profileId : null,
    remainingProfileIds: remaining.map((profile) => profile.profileId),
    decisions,
  };
}

function pooledCriticalMetric(
  metrics: readonly PublicPairedMetricComparison[],
): CalibrationMetricEstimate {
  const measured = metrics.filter((metric) =>
    metric.status === 'MEASURED'
    && metric.meanDifferenceByteDanceMinusOnlineAmt !== null
    && metric.bootstrap95Ci !== null
  );
  const totalSamples = measured.reduce((sum, metric) => sum + metric.sampleCount, 0);
  if (measured.length === 0 || totalSamples === 0) {
    return { meanDifference: 0, bootstrap95Ci: null, pairedScenarioCount: 0 };
  }
  return {
    meanDifference: measured.reduce((sum, metric) =>
      sum + metric.meanDifferenceByteDanceMinusOnlineAmt! * metric.sampleCount, 0) / totalSamples,
    bootstrap95Ci: {
      low: measured.reduce((sum, metric) => sum + metric.bootstrap95Ci!.low * metric.sampleCount, 0) / totalSamples,
      high: measured.reduce((sum, metric) => sum + metric.bootstrap95Ci!.high * metric.sampleCount, 0) / totalSamples,
    },
    pairedScenarioCount: totalSamples,
  };
}

function bestProfileForMetric(
  profiles: readonly CalibrationProfileEvidence[],
  metric: CalibrationMetricName,
  direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER',
): CalibrationProfileEvidence {
  return [...profiles].sort((left, right) => {
    const delta = left.metrics[metric].meanDifference - right.metrics[metric].meanDifference;
    return (direction === 'LOWER_IS_BETTER' ? delta : -delta) || left.profileId.localeCompare(right.profileId);
  })[0];
}

function isMeaningfullyWorseThanBest(
  candidate: CalibrationMetricEstimate,
  best: CalibrationMetricEstimate,
  priority: typeof CALIBRATION_PRIORITY[number],
): boolean {
  if (candidate.pairedScenarioCount < priority.minimumSamples || best.pairedScenarioCount < priority.minimumSamples) {
    return false;
  }
  if (!candidate.bootstrap95Ci || !best.bootstrap95Ci) return false;
  const difference = candidate.meanDifference - best.meanDifference;
  const worseMagnitude = priority.direction === 'LOWER_IS_BETTER' ? difference : -difference;
  if (worseMagnitude < priority.minimumEffect) return false;
  const ciDifference = {
    low: candidate.bootstrap95Ci.low - best.bootstrap95Ci.high,
    high: candidate.bootstrap95Ci.high - best.bootstrap95Ci.low,
  };
  return priority.direction === 'LOWER_IS_BETTER'
    ? ciDifference.low > 0
    : ciDifference.high < 0;
}

function normalizedUniquePerformers(performers: readonly string[]): readonly string[] {
  return [...new Set(performers)].sort();
}

function assertExactPerformerSet(
  actual: readonly string[],
  expected: readonly string[],
  code: string,
): void {
  const same = actual.length === expected.length && actual.every((item, index) => item === expected[index]);
  if (!same) {
    const includesBlind = actual.some((performer) => (PHASE_9GA_BLIND_PERFORMERS as readonly string[]).includes(performer));
    if (includesBlind) throw new Error('PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
    throw new Error(`${code}:actual=${actual.join(',')}:expected=${expected.join(',')}`);
  }
}
