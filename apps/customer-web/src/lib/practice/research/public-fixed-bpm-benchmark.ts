import { createHash } from 'node:crypto';

import { DEFAULT_ASSIGNMENT_WINDOW_MS } from '../local-core/continuous-evaluation-session';
import {
  MAX_PRACTICE_TEMPO_BPM,
  MIN_PRACTICE_TEMPO_BPM,
  isCustomTempoValid,
} from '../local-core/practice-tempo';
import {
  buildBakeoffReport,
  scoreCandidate,
  type BakeoffScore,
  type BenchmarkScenario,
  type CandidateDefinition,
  type CandidateScenarioRun,
} from './continuous-analyzer-bakeoff';
import { BYTEDANCE_CHUNKED_BASELINE_CONFIG } from './bytedance-score-aware-chunked';
import { ONLINE_AMT_STREAMING_BASELINE_CONFIG } from './online-amt-stateful-streaming';

type PublicBenchmarkLayer = 'PRIMARY_FIXED_GRID_PROXY' | 'SECONDARY_HUMAN_FIXED_BPM_PROXY';
type PublicScenarioFamily =
  | 'BASE_ORIGINAL'
  | 'COUNTERFACTUAL_MISSING_NOTE'
  | 'COUNTERFACTUAL_EXTRA_NOTE'
  | 'COUNTERFACTUAL_WRONG_SEMITONE'
  | 'COUNTERFACTUAL_INCOMPLETE_CHORD';
export type PublicLayerResult = 'BYTE_DANCE_BETTER' | 'ONLINE_AMT_BETTER' | 'NO_CLEAR_WINNER' | 'UNAVAILABLE';
export type OverallPublicEvidenceConclusion =
  | 'PREFERRED_ON_PUBLIC_FIXED_BPM_EVIDENCE'
  | 'PREFERRED_ON_SECONDARY_HUMAN_PROXY'
  | 'NO_CLEAR_WINNER_ON_PUBLIC_FIXED_BPM_PROXY';
type PublicDatasetRole =
  | 'PRIMARY_FIXED_GRID_PROXY'
  | 'SECONDARY_HUMAN_FIXED_BPM_PROXY'
  | 'SECONDARY_ACOUSTIC_PROXY'
  | 'EXCLUDED_KNOWN_TRAINING_OVERLAP';

export type PublicDatasetProvenance = {
  datasetId: string;
  datasetVersion: string;
  sourceUrl: string;
  license: string;
  role: PublicDatasetRole;
  trainingOverlapStatus: 'KNOWN_OVERLAP' | 'KNOWN_DISJOINT' | 'UNKNOWN';
  fixedGridProvenance?: {
    audioAndMidiSameTake: boolean;
    independentScoreTruth: boolean;
    constantTempoGrid: boolean;
    configuredBpmSource: 'EXPLICIT_SCORE_OR_MIDI_TEMPO' | 'DATASET_DOCUMENTATION';
  };
};

export type SecondaryBpmFitDiagnostics = {
  method: 'MEDIAN_LOCAL_MS_PER_QUARTER';
  rawFittedBpm: number;
  configuredIntegerBpm: number;
  alignmentAnchorCount: number;
  absoluteResidualP95Ms: number;
  groundTruthExpectedStrikeMatchRate: number;
};

export type PublicScenarioManifest = {
  schemaVersion: 1;
  manifestId: string;
  layer: PublicBenchmarkLayer;
  dataset: PublicDatasetProvenance;
  scenarioFamilies: readonly PublicScenarioFamily[];
  scenarioIds: readonly string[];
  scenarioManifestFrozenBeforeInference: boolean;
  frozenAt?: string;
  candidateOutputIncluded?: boolean;
  officialProductEvaluation: false;
};

type PublicBenchmarkMetricDecision = {
  metric: keyof BakeoffScore['metrics'];
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
};

export type PublicPairedMetricName =
  | 'verdictAgreementRate'
  | 'falseMatchRateOnGroundTruthMissing'
  | 'correctMissingRate'
  | 'chordExactCompletenessRate'
  | 'falseCompleteChordAcceptanceRate'
  | 'expectedStrikeRecall'
  | 'extraPrecision'
  | 'extraRecall'
  | 'timingAbsoluteMedianMs'
  | 'timingAbsoluteP95Ms';

export type PublicBootstrapConfig = {
  seed: number;
  draws: number;
};

export type PublicPairedMetricComparison = {
  status: 'MEASURED' | 'NOT_EVALUATED';
  sampleCount: number;
  meanDifferenceByteDanceMinusOnlineAmt: number | null;
  bootstrap95Ci: { low: number; high: number; seed: number; draws: number } | null;
};

export type PublicPairedComparison = {
  pairedScenarioCount: number;
  bootstrap: PublicBootstrapConfig;
  metrics: Record<PublicPairedMetricName, PublicPairedMetricComparison>;
};

export type PublicFamilyEvidenceStatus =
  | 'MEASURED'
  | 'INSUFFICIENT_FAMILY_EVIDENCE'
  | 'NOT_EVALUATED';

export type PublicSecondaryDecisionInput = {
  base: PublicPairedComparison;
  families?: Partial<Record<Exclude<PublicScenarioFamily, 'BASE_ORIGINAL'>, {
    status: PublicFamilyEvidenceStatus;
    paired: PublicPairedComparison;
  }>>;
};

export const PUBLIC_PROXY_BOOTSTRAP_CONFIG: PublicBootstrapConfig = {
  seed: 13_371,
  draws: 5_000,
};

const PUBLIC_PAIRED_METRICS: readonly PublicPairedMetricName[] = [
  'verdictAgreementRate',
  'falseMatchRateOnGroundTruthMissing',
  'correctMissingRate',
  'chordExactCompletenessRate',
  'falseCompleteChordAcceptanceRate',
  'expectedStrikeRecall',
  'extraPrecision',
  'extraRecall',
  'timingAbsoluteMedianMs',
  'timingAbsoluteP95Ms',
];

const PUBLIC_FIXED_BPM_METRIC_DECISION_ORDER: readonly PublicBenchmarkMetricDecision[] = [
  { metric: 'verdictAgreementRate', direction: 'HIGHER_BETTER' },
  { metric: 'falseMatchRateOnGroundTruthMissing', direction: 'LOWER_BETTER' },
  { metric: 'falseCompleteChordAcceptanceRate', direction: 'LOWER_BETTER' },
  { metric: 'correctMissingRate', direction: 'HIGHER_BETTER' },
  { metric: 'chordExactCompletenessRate', direction: 'HIGHER_BETTER' },
  { metric: 'expectedStrikeRecall', direction: 'HIGHER_BETTER' },
  { metric: 'extraPrecision', direction: 'HIGHER_BETTER' },
  { metric: 'extraRecall', direction: 'HIGHER_BETTER' },
  { metric: 'timingAbsoluteMedianMs', direction: 'LOWER_BETTER' },
  { metric: 'timingAbsoluteP95Ms', direction: 'LOWER_BETTER' },
] as const;

export function assertPublicDatasetMayEnterWinnerEvidence(dataset: PublicDatasetProvenance): void {
  if (['maestro', 'asap', 'nasap', 'asap-nasap'].includes(dataset.datasetId.toLowerCase())) {
    throw new Error('MAESTRO/ASAP-derived datasets are excluded from ByteDance-vs-Online-AMT winner evidence.');
  }
  if (dataset.role === 'EXCLUDED_KNOWN_TRAINING_OVERLAP' || dataset.trainingOverlapStatus === 'KNOWN_OVERLAP') {
    throw new Error('Known training-overlap datasets cannot enter public winner evidence.');
  }
}

export function assertPrimaryFixedGridProvenance(dataset: PublicDatasetProvenance): void {
  assertPublicDatasetMayEnterWinnerEvidence(dataset);
  if (dataset.role !== 'PRIMARY_FIXED_GRID_PROXY') {
    throw new Error('PRIMARY_FIXED_GRID_PROXY requires an explicitly primary dataset role.');
  }
  const provenance = dataset.fixedGridProvenance;
  if (
    !provenance?.audioAndMidiSameTake
    || !provenance.independentScoreTruth
    || !provenance.constantTempoGrid
    || !provenance.configuredBpmSource
  ) {
    throw new Error('PRIMARY_FIXED_GRID_PROXY requires explicit fixed-grid score/audio/MIDI provenance.');
  }
}

export function validateSecondaryViennaFit(diagnostics: SecondaryBpmFitDiagnostics): void {
  if (
    diagnostics.method !== 'MEDIAN_LOCAL_MS_PER_QUARTER'
    || diagnostics.alignmentAnchorCount <= 0
    || diagnostics.groundTruthExpectedStrikeMatchRate < 0.95
    || diagnostics.absoluteResidualP95Ms > DEFAULT_ASSIGNMENT_WINDOW_MS / 2
  ) {
    throw new Error('SECONDARY Vienna fixed-BPM proxy failed candidate-independent BPM-fit eligibility.');
  }
  const configuredIntegerBpm = productIntegerBpm(diagnostics.rawFittedBpm);
  if (diagnostics.configuredIntegerBpm !== configuredIntegerBpm) {
    throw new Error('SECONDARY Vienna configuredIntegerBpm must equal the product-derived custom tempo.');
  }
}

export function productIntegerBpm(rawBpm: number): number {
  if (!Number.isFinite(rawBpm) || rawBpm <= 0) throw new Error('Configured BPM requires a positive finite value.');
  const bpm = Math.round(rawBpm);
  if (!isCustomTempoValid(bpm)) {
    throw new Error(
      `Configured BPM must be within the product custom tempo range ${MIN_PRACTICE_TEMPO_BPM}-${MAX_PRACTICE_TEMPO_BPM}.`
    );
  }
  return bpm;
}

export function validatePublicScenarioManifest(manifest: PublicScenarioManifest): void {
  if (manifest.schemaVersion !== 1 || !manifest.manifestId) throw new Error('Unsupported public benchmark manifest.');
  if (manifest.scenarioIds.length === 0) throw new Error('Public benchmark manifest cannot claim a frozen benchmark with zero scenarios.');
  if (manifest.candidateOutputIncluded) throw new Error('Public scenario manifest must be frozen before candidate output.');
  if (!manifest.scenarioManifestFrozenBeforeInference) throw new Error('Public scenario manifest must be frozen before inference.');
  if (manifest.officialProductEvaluation !== false) throw new Error('Public proxy scenarios cannot become official product EVALUATION.');
  if (manifest.layer === 'PRIMARY_FIXED_GRID_PROXY') assertPrimaryFixedGridProvenance(manifest.dataset);
  else assertPublicDatasetMayEnterWinnerEvidence(manifest.dataset);
}

export function canonicalPublicScenarioManifestSha256(manifest: PublicScenarioManifest): string {
  validatePublicScenarioManifest(manifest);
  return sha256Hex(canonicalJson(manifest));
}

export function assertCounterfactualPreservesAudioAndMidi(input: {
  base: BenchmarkScenario;
  mutated: BenchmarkScenario;
}): void {
  if (
    input.base.source.sourceAudioSha256 !== input.mutated.source.sourceAudioSha256
    || input.base.source.sourceAudioPath !== input.mutated.source.sourceAudioPath
    || input.base.source.sourceMidiSha256 !== input.mutated.source.sourceMidiSha256
    || input.base.source.sourceMidiPath !== input.mutated.source.sourceMidiPath
  ) {
    throw new Error('Counterfactual scenarios may mutate score truth only; audio and physical MIDI identity must stay fixed.');
  }
}

export function assertMatchedCandidateAudioIdentity(input: {
  scenario: BenchmarkScenario;
  byteDanceRun: CandidateScenarioRun;
  onlineAmtRun: CandidateScenarioRun;
}): void {
  if (
    input.byteDanceRun.scenarioId !== input.scenario.scenarioId
    || input.onlineAmtRun.scenarioId !== input.scenario.scenarioId
  ) {
    throw new Error('Matched public comparison requires both runs to bind the same scenario and source audio identity.');
  }
}

export function scoreFixedGridGroundTruthWithLedger(scenario: BenchmarkScenario): BakeoffScore {
  return scoreCandidate(scenario, {
    candidateId: 'physical-midi-ground-truth',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: 'Physical MIDI ground truth through ContinuousFinalizationLedger',
      adapterVersion: 'public-fixed-bpm-ground-truth-v1',
      configurationSha256: sha256Hex('physical-midi-ground-truth-v1'),
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  }, {
    candidateId: 'physical-midi-ground-truth',
    scenarioId: scenario.scenarioId,
    publications: [{
      publicationId: `${scenario.scenarioId}:physical-midi-ground-truth`,
      analyzedThroughPerformanceMs: scenario.completion?.performanceTimeMs ?? Math.max(...scenario.expectedStrikes.map((strike) => strike.expectedPerformanceTimeMs)),
      observations: scenario.physicalGroundTruth?.attacks.map((attack) => ({
        observationId: attack.physicalEventId,
        pitch: attack.pitch,
        performanceTimeMs: attack.performanceTimeMs,
        confidence: 1,
      })) ?? [],
    }],
  });
}

export function buildPublicDiagnosticBakeoffReport(input: {
  scenarios: readonly BenchmarkScenario[];
  candidates: readonly CandidateDefinition[];
  runs: readonly CandidateScenarioRun[];
}) {
  const report = buildBakeoffReport({
    policy: {
      policyId: 'public-fixed-bpm-proxy-policy',
      path: 'public-fixed-bpm-proxy-policy',
      schemaVersion: 1,
      sha256: sha256Hex(canonicalJson(PUBLIC_FIXED_BPM_METRIC_DECISION_ORDER)),
    },
    benchmarkManifest: {
      manifestId: 'public-fixed-bpm-proxy-diagnostic',
      path: 'public-fixed-bpm-proxy-manifest',
      schemaVersion: 1,
      sha256: sha256Hex(canonicalJson(input.scenarios.map((scenario) => scenario.scenarioId))),
    },
    gitHead: 'UNKNOWN',
    dirtyTree: false,
    command: 'buildPublicDiagnosticBakeoffReport',
    runtimeEnvironment: { environment: 'typescript-unit-or-research-runner' },
    scenarios: input.scenarios,
    candidateDefinitions: input.candidates,
    scenarioRuns: input.runs,
  });
  return {
    ...report,
    comparativeRank: null,
    absoluteGateStatus: 'NOT_EVALUATED' as const,
    officialProductEvaluation: false,
  };
}

export function buildPublicPairedComparison(input: {
  scores: readonly BakeoffScore[];
  byteDanceCandidateId?: string;
  onlineAmtCandidateId?: string;
  bootstrap?: PublicBootstrapConfig;
}): PublicPairedComparison {
  const byteDanceCandidateId = input.byteDanceCandidateId ?? 'bytedance-score-aware-chunked-dev-v1';
  const onlineAmtCandidateId = input.onlineAmtCandidateId ?? 'online-amt-stateful-modern-compat-dev-v1';
  const bootstrap = input.bootstrap ?? PUBLIC_PROXY_BOOTSTRAP_CONFIG;
  if (bootstrap.draws < 5_000) throw new Error('Public proxy paired bootstrap requires at least 5000 draws.');
  const byScenario = new Map<string, Partial<Record<string, BakeoffScore>>>();
  for (const score of input.scores) {
    const entry = byScenario.get(score.scenarioId) ?? {};
    entry[score.candidateId] = score;
    byScenario.set(score.scenarioId, entry);
  }
  const pairs = [...byScenario.values()].flatMap((entry) =>
    entry[byteDanceCandidateId] && entry[onlineAmtCandidateId]
      ? [{ byteDance: entry[byteDanceCandidateId], onlineAmt: entry[onlineAmtCandidateId] }]
      : []
  );
  const metrics = Object.fromEntries(PUBLIC_PAIRED_METRICS.map((name) => {
    const values = pairs.flatMap((pair) => {
      const left = pair.byteDance?.metrics[name];
      const right = pair.onlineAmt?.metrics[name];
      return left?.status === 'MEASURED' && right?.status === 'MEASURED' ? [left.value - right.value] : [];
    });
    return [name, pairedMetric(values, bootstrap)];
  })) as Record<PublicPairedMetricName, PublicPairedMetricComparison>;
  return { pairedScenarioCount: pairs.length, bootstrap, metrics };
}

export function decideSecondaryHumanFixedBpmProxy(input: PublicSecondaryDecisionInput): PublicLayerResult {
  const verdict = input.base.metrics.verdictAgreementRate;
  if (verdict.status !== 'MEASURED' || verdict.sampleCount === 0 || verdict.meanDifferenceByteDanceMinusOnlineAmt === null) {
    return 'NO_CLEAR_WINNER';
  }
  const diff = verdict.meanDifferenceByteDanceMinusOnlineAmt;
  if (Math.abs(diff) < 0.01) return 'NO_CLEAR_WINNER';
  const verdictCi = verdict.bootstrap95Ci;
  if (!verdictCi || (verdictCi.low <= 0 && verdictCi.high >= 0)) return 'NO_CLEAR_WINNER';
  const apparentWinner: PublicLayerResult = diff > 0 ? 'BYTE_DANCE_BETTER' : 'ONLINE_AMT_BETTER';
  const criticalFamilies: readonly Exclude<PublicScenarioFamily, 'BASE_ORIGINAL'>[] = [
    'COUNTERFACTUAL_MISSING_NOTE',
    'COUNTERFACTUAL_WRONG_SEMITONE',
    'COUNTERFACTUAL_INCOMPLETE_CHORD',
  ];
  for (const family of criticalFamilies) {
    const evidence = input.families?.[family];
    if (!evidence || evidence.status === 'INSUFFICIENT_FAMILY_EVIDENCE' || evidence.status === 'NOT_EVALUATED') {
      return 'NO_CLEAR_WINNER';
    }
  }
  for (const paired of [input.base, ...Object.values(input.families ?? {}).map((entry) => entry.paired)]) {
    for (const metric of ['falseMatchRateOnGroundTruthMissing', 'falseCompleteChordAcceptanceRate'] as const) {
      const safety = paired.metrics[metric];
      if (safety.status !== 'MEASURED' || !safety.bootstrap95Ci || safety.meanDifferenceByteDanceMinusOnlineAmt === null) continue;
      const safetyDiff = safety.meanDifferenceByteDanceMinusOnlineAmt;
      const byteDanceMateriallyWorse = safetyDiff >= 0.01 && safety.bootstrap95Ci.low > 0;
      const onlineAmtMateriallyWorse = safetyDiff <= -0.01 && safety.bootstrap95Ci.high < 0;
      if (apparentWinner === 'BYTE_DANCE_BETTER' && byteDanceMateriallyWorse) return 'NO_CLEAR_WINNER';
      if (apparentWinner === 'ONLINE_AMT_BETTER' && onlineAmtMateriallyWorse) return 'NO_CLEAR_WINNER';
    }
  }
  return apparentWinner;
}

export function decideOverallPublicEvidence(input: {
  primary: PublicLayerResult;
  secondary: PublicLayerResult;
}): OverallPublicEvidenceConclusion {
  if (input.primary === 'BYTE_DANCE_BETTER' || input.primary === 'ONLINE_AMT_BETTER') {
    if (input.secondary === 'UNAVAILABLE' || input.secondary === 'NO_CLEAR_WINNER' || input.secondary === input.primary) {
      return 'PREFERRED_ON_PUBLIC_FIXED_BPM_EVIDENCE';
    }
    return 'NO_CLEAR_WINNER_ON_PUBLIC_FIXED_BPM_PROXY';
  }
  if (input.primary === 'UNAVAILABLE') {
    if (input.secondary === 'BYTE_DANCE_BETTER' || input.secondary === 'ONLINE_AMT_BETTER') {
      return 'PREFERRED_ON_SECONDARY_HUMAN_PROXY';
    }
  }
  return 'NO_CLEAR_WINNER_ON_PUBLIC_FIXED_BPM_PROXY';
}

export function assertFrozenCandidateConfigsUnchanged(): void {
  if (BYTEDANCE_CHUNKED_BASELINE_CONFIG.onsetThreshold !== 0.2 || BYTEDANCE_CHUNKED_BASELINE_CONFIG.frameThreshold !== 0.2) {
    throw new Error('ByteDance frozen thresholds changed.');
  }
  if (
    ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz !== 16_000
    || ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples !== 512
    || ONLINE_AMT_STREAMING_BASELINE_CONFIG.timingCorrectionMs !== -158
  ) {
    throw new Error('Online-AMT frozen streaming config changed.');
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pairedMetric(values: readonly number[], bootstrap: PublicBootstrapConfig): PublicPairedMetricComparison {
  if (values.length === 0) {
    return {
      status: 'NOT_EVALUATED',
      sampleCount: 0,
      meanDifferenceByteDanceMinusOnlineAmt: null,
      bootstrap95Ci: null,
    };
  }
  return {
    status: 'MEASURED',
    sampleCount: values.length,
    meanDifferenceByteDanceMinusOnlineAmt: mean(values),
    bootstrap95Ci: values.length < 2 ? null : bootstrapCi(values, bootstrap),
  };
}

export function publicProxyBootstrapCi(
  values: readonly number[],
  bootstrap: PublicBootstrapConfig = PUBLIC_PROXY_BOOTSTRAP_CONFIG,
): { low: number; high: number; seed: number; draws: number } {
  return bootstrapCi(values, bootstrap);
}

function bootstrapCi(
  values: readonly number[],
  bootstrap: PublicBootstrapConfig,
): { low: number; high: number; seed: number; draws: number } {
  if (values.length === 0) throw new Error('Cannot bootstrap an empty vector.');
  if (bootstrap.draws < 5_000) throw new Error('Public proxy paired bootstrap requires at least 5000 draws.');
  const random = mulberry32(bootstrap.seed);
  const draws: number[] = [];
  for (let draw = 0; draw < bootstrap.draws; draw += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      const sampleIndex = Math.min(values.length - 1, Math.floor(random() * values.length));
      sum += values[sampleIndex];
    }
    draws.push(sum / values.length);
  }
  draws.sort((left, right) => left - right);
  return {
    low: percentile(draws, 0.025),
    high: percentile(draws, 0.975),
    seed: bootstrap.seed,
    draws: bootstrap.draws,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('Cannot compute percentile for an empty vector.');
  const index = (values.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
