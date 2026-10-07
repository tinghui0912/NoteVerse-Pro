import { ContinuousFinalizationLedger } from '../local-core/continuous-finalization-ledger';
import { DEFAULT_ASSIGNMENT_WINDOW_MS } from '../local-core/continuous-evaluation-session';
import { assignObservedAttacksToExpectedStrikes } from '../audio-analysis/continuous/performance-reconciler';
import type { CompletedContinuousEvaluation } from '../completed-performance';

type BenchmarkSplit = 'DEVELOPMENT' | 'CALIBRATION' | 'EVALUATION';
type AggregateSplit = BenchmarkSplit | 'ALL_SPLITS_DIAGNOSTIC_ONLY';
export type CandidateStrategyKind = 'CHUNKED' | 'STREAMING';
export type MetricStatus = 'MEASURED' | 'NOT_EVALUATED' | 'INSUFFICIENT_DATA' | 'MISSING_DATA';
type CorpusOverlapStatus = 'KNOWN_OVERLAP' | 'KNOWN_DISJOINT' | 'UNKNOWN';
type ComparativeOutcome =
  | 'RANKED'
  | 'INSUFFICIENT_EVALUATION_SET'
  | 'INELIGIBLE_SPLIT_LEAKAGE'
  | 'INCOMPLETE_EVALUATION_COVERAGE'
  | 'EVALUATION_READY_NO_COMPARATOR_POLICY';

type BenchmarkExpectedStrike = {
  strikeId: string;
  groupId: string;
  pitch: string;
  expectedPerformanceTimeMs: number;
  renderNoteIds: readonly string[];
};

type PhysicalGroundTruthAttack = {
  physicalEventId: string;
  pitch: string;
  performanceTimeMs: number;
};

export type BenchmarkScenario = {
  scenarioId: string;
  schemaVersion: 1;
  split: BenchmarkSplit;
  familyTags: readonly string[];
  source: {
    sourceAudioPath: string;
    sourceAudioSha256: string;
    sourceMidiPath?: string;
    sourceMidiSha256?: string;
    provenance: string;
  };
  audio: {
    nativeSampleRateHz: number;
    channelPolicy: string;
    clipStartMs: number;
    clipEndMs: number;
    performanceOriginSourceMs: number;
    sourceDurationMs?: number;
    pcmIdentity: string;
  };
  expectedStrikes: readonly BenchmarkExpectedStrike[];
  physicalGroundTruth?: {
    status: 'RECORDED' | 'PLANNED_NOT_RECORDED' | 'MISSING';
    sourceKind?: 'PAIRED_PHYSICAL_MIDI' | 'SYNTHETIC_HARNESS';
    source: string;
    attacks: readonly PhysicalGroundTruthAttack[];
  };
  completion?: {
    kind: 'NATURAL' | 'MANUAL';
    performanceTimeMs: number;
  };
  taxonomy?: {
    groups?: Record<string, readonly string[]>;
  };
  corpusOverlapStatus: CorpusOverlapStatus;
};

export type CandidateObservation = {
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence?: number;
};

export type CandidatePublication = {
  publicationId: string;
  observations: readonly CandidateObservation[];
  analyzedThroughPerformanceMs: number;
  availabilityTimeMs?: number;
  diagnostics?: {
    strategyShape?: CandidateStrategyKind;
    chunkIndex?: number;
    inputStartMs?: number;
    inputEndMs?: number;
    inferenceLatencyMs?: number;
    publicationDelayMs?: number;
    requiredFutureContextMs?: number;
    modelInferenceLatencyMs?: number;
    adapterOverheadMs?: number;
    totalPublicationDelayMs?: number;
    candidateProcessingLatencyMs?: number;
    inputReadyAtMs?: number;
    inferenceStartAtMs?: number;
    queueDelayMs?: number;
  };
};

export type CandidateDefinition = {
  candidateId: string;
  strategyKind: CandidateStrategyKind;
  identity: {
    modelRuntime: string;
    modelCheckpointSha256?: string;
    adapterVersion: string;
    sourceGitHead?: string;
    configurationSha256: string;
    trainingDataOverlapStatus: CorpusOverlapStatus;
  };
};

export type CandidateScenarioRun = {
  candidateId: string;
  scenarioId: string;
  publications: readonly CandidatePublication[];
  runProvenance?: {
    command?: string;
    runtime?: string;
    environment?: Record<string, string>;
  };
};

type MetricNumber =
  | {
      status: 'MEASURED';
      sampleCount: number;
      value: number;
      numerator?: number;
      denominator?: number;
    }
  | {
      status: 'NOT_EVALUATED' | 'INSUFFICIENT_DATA' | 'MISSING_DATA';
      sampleCount: number;
      reason: string;
    };

type ExtraDiagnostics = {
  matchedPhysicalExtras: number;
  missedPhysicalExtras: number;
  falseCandidateExtras: number;
};

type MetricSamples = {
  timingAbsoluteErrorsMs: number[];
  finalizedFeedbackAgesMs: number[];
  inferenceLatencyMs: number[];
  publicationDelayMs: number[];
  feedbackAgeFinalizedStrikeCount: number;
  feedbackAgeMeasuredStrikeCount: number;
  feedbackAgeMissingAvailabilityCount: number;
};

export type BakeoffScore = {
  scenarioId: string;
  scenarioSplit: BenchmarkSplit;
  candidateId: string;
  strategyKind: CandidateStrategyKind;
  candidateRunStatus: MetricStatus;
  groundTruthStatus: MetricStatus;
  candidateEvaluation: CompletedContinuousEvaluation;
  groundTruthEvaluation?: CompletedContinuousEvaluation;
  metrics: {
    expectedStrikeRecall: MetricNumber;
    falseMatchRateOnGroundTruthMissing: MetricNumber;
    correctMissingRate: MetricNumber;
    verdictAgreementRate: MetricNumber;
    timingAbsoluteMedianMs: MetricNumber;
    timingAbsoluteP95Ms: MetricNumber;
    chordExactCompletenessRate: MetricNumber;
    falseCompleteChordAcceptanceRate: MetricNumber;
    extraPrecision: MetricNumber;
    extraRecall: MetricNumber;
    finalizedFeedbackAgeP50Ms: MetricNumber;
    finalizedFeedbackAgeP95Ms: MetricNumber;
    inferenceLatencyP50Ms: MetricNumber;
    inferenceLatencyP95Ms: MetricNumber;
    publicationDelayP50Ms: MetricNumber;
    publicationDelayP95Ms: MetricNumber;
  };
  extraDiagnostics: ExtraDiagnostics;
  metricSamples: MetricSamples;
  familyMetrics: Record<string, {
    expectedStrikeRecall: MetricNumber;
    falseMatchRateOnGroundTruthMissing: MetricNumber;
  }>;
};

type CandidateSplitCoverage = {
  expectedScenarioCount: number;
  runPresentCount: number;
  groundTruthScoreableCount: number;
  candidateCompleteEvaluationCount: number;
  candidateIncompleteAnalysisCount: number;
  missingRunCount: number;
  notScoreableGroundTruthCount: number;
};

type AggregateMetricVector = {
  expectedStrikeRecall: MetricNumber;
  falseMatchRateOnGroundTruthMissing: MetricNumber;
  correctMissingRate: MetricNumber;
  verdictAgreementRate: MetricNumber;
  chordExactCompletenessRate: MetricNumber;
  falseCompleteChordAcceptanceRate: MetricNumber;
  extraPrecision: MetricNumber;
  extraRecall: MetricNumber;
  timingAbsoluteMedianMs: MetricNumber;
  timingAbsoluteP95Ms: MetricNumber;
  finalizedFeedbackAgeP50Ms: MetricNumber;
  finalizedFeedbackAgeP95Ms: MetricNumber;
  inferenceLatencyP50Ms: MetricNumber;
  inferenceLatencyP95Ms: MetricNumber;
  publicationDelayP50Ms: MetricNumber;
  publicationDelayP95Ms: MetricNumber;
  extraDiagnostics: ExtraDiagnostics;
  feedbackAgeCoverage: {
    finalizedStrikeCount: number;
    measuredStrikeCount: number;
    missingAvailabilityCount: number;
  };
};

export function validateBenchmarkScenario(scenario: BenchmarkScenario): void {
  if (scenario.schemaVersion !== 1) throw new Error('Unsupported benchmark scenario schemaVersion.');
  if (!scenario.scenarioId) throw new Error('Benchmark scenario requires scenarioId.');
  if (!['DEVELOPMENT', 'CALIBRATION', 'EVALUATION'].includes(scenario.split)) {
    throw new Error('Benchmark scenario requires a valid split.');
  }
  if (!scenario.source?.sourceAudioPath || !scenario.source.sourceAudioSha256) {
    throw new Error('Benchmark scenario requires source audio identity.');
  }
  if (
    scenario.physicalGroundTruth?.status === 'RECORDED'
    && (scenario.physicalGroundTruth.sourceKind ?? 'PAIRED_PHYSICAL_MIDI') === 'PAIRED_PHYSICAL_MIDI'
    && !scenario.source.sourceMidiSha256
  ) {
    throw new Error('Recorded physical ground truth requires synchronized source MIDI identity.');
  }
  if (!Number.isFinite(scenario.audio.nativeSampleRateHz) || scenario.audio.nativeSampleRateHz <= 0) {
    throw new Error('Benchmark scenario requires positive native sample rate.');
  }
  if (
    !Number.isFinite(scenario.audio.clipStartMs)
    || !Number.isFinite(scenario.audio.clipEndMs)
    || !Number.isFinite(scenario.audio.performanceOriginSourceMs)
    || scenario.audio.clipStartMs < 0
    || scenario.audio.clipEndMs < scenario.audio.clipStartMs
    || scenario.audio.performanceOriginSourceMs < scenario.audio.clipStartMs
    || scenario.audio.performanceOriginSourceMs > scenario.audio.clipEndMs
  ) {
    throw new Error('Benchmark scenario requires finite ordered audio clip bounds and performance origin.');
  }
  if (
    scenario.audio.sourceDurationMs !== undefined
    && (
      !Number.isFinite(scenario.audio.sourceDurationMs)
      || scenario.audio.sourceDurationMs < scenario.audio.clipEndMs
    )
  ) {
    throw new Error('Benchmark scenario clip exceeds declared source duration.');
  }
  const completion = completionTimeMs(scenario);
  if (!Number.isFinite(completion) || completion < 0) {
    throw new Error('Benchmark scenario requires finite non-negative completion time.');
  }
  if (scenario.audio.clipEndMs < scenario.audio.performanceOriginSourceMs + completion) {
    throw new Error('Benchmark scenario clip must contain the full owned performance interval.');
  }
  if (!Array.isArray(scenario.expectedStrikes) || scenario.expectedStrikes.length === 0) {
    throw new Error('Benchmark scenario requires ExpectedStrike timeline.');
  }
  const strikeIds = new Set<string>();
  const groupTimes = new Map<string, number>();
  for (const strike of scenario.expectedStrikes) {
    if (
      !strike.strikeId
      || !strike.groupId
      || !strike.pitch
      || !Number.isFinite(strike.expectedPerformanceTimeMs)
      || strike.expectedPerformanceTimeMs < 0
    ) {
      throw new Error('Benchmark ExpectedStrike has invalid identity, pitch, or expected time.');
    }
    if (strikeIds.has(strike.strikeId)) {
      throw new Error(`Duplicate ExpectedStrike id: ${strike.strikeId}`);
    }
    strikeIds.add(strike.strikeId);
    const groupTime = groupTimes.get(strike.groupId);
    if (groupTime !== undefined && groupTime !== strike.expectedPerformanceTimeMs) {
      throw new Error(`ExpectedStrike group ${strike.groupId} contains different expected times.`);
    }
    groupTimes.set(strike.groupId, strike.expectedPerformanceTimeMs);
    if (scenario.completion?.kind === 'NATURAL' && strike.expectedPerformanceTimeMs > completion) {
      throw new Error('Natural completion cannot occur before an ExpectedStrike in the scenario.');
    }
  }
  if (scenario.physicalGroundTruth) {
    const physicalIds = new Set<string>();
    for (const attack of scenario.physicalGroundTruth.attacks) {
      if (
        !attack.physicalEventId
        || !attack.pitch
        || !Number.isFinite(attack.performanceTimeMs)
        || attack.performanceTimeMs < 0
      ) {
        throw new Error('Physical ground truth attack has invalid identity, pitch, or time.');
      }
      if (attack.performanceTimeMs > completion) {
        throw new Error('Physical ground truth attack cannot occur beyond scenario completion.');
      }
      if (physicalIds.has(attack.physicalEventId)) {
        throw new Error(`Duplicate physical event id: ${attack.physicalEventId}`);
      }
      physicalIds.add(attack.physicalEventId);
    }
  }
}

export function detectSplitLeakage(scenarios: readonly BenchmarkScenario[]): readonly string[] {
  const byHash = new Map<string, Set<BenchmarkSplit>>();
  for (const scenario of scenarios) {
    const splits = byHash.get(scenario.source.sourceAudioSha256) ?? new Set<BenchmarkSplit>();
    splits.add(scenario.split);
    byHash.set(scenario.source.sourceAudioSha256, splits);
  }
  return [...byHash.entries()]
    .filter(([, splits]) => splits.size > 1)
    .map(([sourceAudioSha256, splits]) =>
      `${sourceAudioSha256} appears in protected splits: ${[...splits].sort().join(',')}`
    );
}

export function classifyExistingPracticeAudioCorpus(input: {
  manifest: { scenarios?: unknown[] };
  profileManifest: { scenarios?: unknown[] };
  pairedGroundTruthManifest: { scenarios?: { status?: string }[] };
  bytedanceTargetCount?: number;
  hasOnlineAmtReports: boolean;
  hasRttReports: boolean;
}): Record<string, {
  status: 'HISTORICAL_REGRESSION_ONLY' | 'METADATA_ONLY_PLANNED' | 'IMMEDIATELY_SCOREABLE' | 'HISTORICAL_EVIDENCE_ONLY';
  reason: string;
  scenarioCount?: number;
}> {
  const pairedRecordedCount = (input.pairedGroundTruthManifest.scenarios ?? [])
    .filter((scenario) => scenario.status === 'recorded' || scenario.status === 'RECORDED')
    .length;
  return {
    practiceAudioManifest: {
      status: 'HISTORICAL_REGRESSION_ONLY',
      reason: 'Old manifests encode startup/score-following expectations and reusable WAV assets, not current Continuous product truth.',
      scenarioCount: input.manifest.scenarios?.length ?? 0,
    },
    practiceAudioProfileManifest: {
      status: 'HISTORICAL_REGRESSION_ONLY',
      reason: 'Profile manifest contains historical startup/following semantics and should not define Practice v2 Continuous truth.',
      scenarioCount: input.profileManifest.scenarios?.length ?? 0,
    },
    pairedGroundTruthManifest: {
      status: pairedRecordedCount > 0 ? 'IMMEDIATELY_SCOREABLE' : 'METADATA_ONLY_PLANNED',
      reason: pairedRecordedCount > 0
        ? 'Recorded paired MIDI + microphone evidence can support physical metrics.'
        : 'Planned paired scenarios establish the desired physical-truth principle but cannot produce measured accuracy.',
      scenarioCount: input.pairedGroundTruthManifest.scenarios?.length ?? 0,
    },
    bytedanceTargetVerifierTargets: {
      status: 'HISTORICAL_EVIDENCE_ONLY',
      reason: 'Historical target-verifier families inform taxonomy but must be explicitly translated before Practice v2 scoring.',
      scenarioCount: input.bytedanceTargetCount,
    },
    onlineAmtReports: {
      status: 'HISTORICAL_EVIDENCE_ONLY',
      reason: input.hasOnlineAmtReports
        ? 'Online-AMT reports remain historical until rerun through the new bake-off contract.'
        : 'No Online-AMT reports were provided to classify.',
    },
    rttReports: {
      status: 'HISTORICAL_EVIDENCE_ONLY',
      reason: input.hasRttReports
        ? 'RTT reports remain historical until rerun through the new bake-off contract.'
        : 'No RTT reports were provided to classify.',
    },
  };
}

export function scoreCandidate(
  scenario: BenchmarkScenario,
  definition: CandidateDefinition,
  run: CandidateScenarioRun
): BakeoffScore {
  validateBenchmarkScenario(scenario);
  validateCandidateDefinition(definition);
  validateCandidateScenarioRun(scenario, definition, run);
  const candidateEvaluation = runFinalization(scenario, run.publications, definition.candidateId, false);
  const samples = metricSamples(scenario, run.publications, definition.candidateId);

  if (!scenario.physicalGroundTruth || scenario.physicalGroundTruth.status !== 'RECORDED') {
    return {
      scenarioId: scenario.scenarioId,
      scenarioSplit: scenario.split,
      candidateId: definition.candidateId,
      strategyKind: definition.strategyKind,
      candidateRunStatus: 'MEASURED',
      groundTruthStatus: scenario.physicalGroundTruth?.status === 'PLANNED_NOT_RECORDED'
        ? 'INSUFFICIENT_DATA'
        : 'MISSING_DATA',
      candidateEvaluation,
      metrics: notEvaluatedMetrics('physical ground truth is not recorded'),
      extraDiagnostics: { matchedPhysicalExtras: 0, missedPhysicalExtras: 0, falseCandidateExtras: 0 },
      metricSamples: samples,
      familyMetrics: familyMetrics(scenario, undefined, candidateEvaluation),
    };
  }

  const groundTruthEvaluation = runFinalization(
    scenario,
    [{
      publicationId: 'ground-truth',
      observations: scenario.physicalGroundTruth.attacks.map((attack) => ({
        observationId: attack.physicalEventId,
        pitch: attack.pitch,
        performanceTimeMs: attack.performanceTimeMs,
        confidence: 1,
      })),
      analyzedThroughPerformanceMs: completionTimeMs(scenario),
      availabilityTimeMs: completionTimeMs(scenario),
    }],
    'ground-truth',
    true
  );
  return {
    scenarioId: scenario.scenarioId,
    scenarioSplit: scenario.split,
    candidateId: definition.candidateId,
    strategyKind: definition.strategyKind,
    candidateRunStatus: 'MEASURED',
    groundTruthStatus: groundTruthEvaluation.status === 'COMPLETE' ? 'MEASURED' : 'INSUFFICIENT_DATA',
    candidateEvaluation,
    groundTruthEvaluation,
    metrics: computeMetrics(scenario, groundTruthEvaluation, candidateEvaluation, samples),
    extraDiagnostics: extraDiagnostics(groundTruthEvaluation, candidateEvaluation),
    metricSamples: samples,
    familyMetrics: familyMetrics(scenario, groundTruthEvaluation, candidateEvaluation),
  };
}

export function fakeCandidate(
  scenario: BenchmarkScenario,
  kind: 'PERFECT' | 'EMPTY' | 'DUPLICATE_EXTRA' | 'DELAYED_ACCURATE' | 'INCOMPLETE',
  strategyKind: CandidateStrategyKind = 'CHUNKED'
): { definition: CandidateDefinition; run: CandidateScenarioRun } {
  const definition: CandidateDefinition = {
    candidateId: `fake-${kind.toLowerCase()}-${strategyKind.toLowerCase()}`,
    strategyKind,
    identity: {
      modelRuntime: `fake-${kind.toLowerCase()}`,
      adapterVersion: 'phase9d-fake-v1',
      configurationSha256: stableHash({ kind, strategyKind }),
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };
  const observations = scenario.physicalGroundTruth?.status === 'RECORDED'
    ? scenario.physicalGroundTruth.attacks.map((attack) => ({
        observationId: `fake:${kind}:${attack.physicalEventId}`,
        pitch: attack.pitch,
        performanceTimeMs: attack.performanceTimeMs,
        confidence: 1,
      }))
    : [];
  const withDuplicates = kind === 'DUPLICATE_EXTRA'
    ? [
        ...observations,
        { observationId: 'fake:duplicate:c4', pitch: 'C4', performanceTimeMs: 111, confidence: 0.8 },
        { observationId: 'fake:wrong:bb4', pitch: 'Bb4', performanceTimeMs: 700, confidence: 0.7 },
      ]
    : observations;
  const finalCoverage = kind === 'INCOMPLETE'
    ? Math.max(0, completionTimeMs(scenario) - 1_000)
    : completionTimeMs(scenario);
  return {
    definition,
    run: {
      candidateId: definition.candidateId,
      scenarioId: scenario.scenarioId,
      publications: [{
        publicationId: `fake-${kind.toLowerCase()}-publication`,
        observations: kind === 'EMPTY' ? [] : withDuplicates.filter((observation) => observation.performanceTimeMs <= finalCoverage),
        analyzedThroughPerformanceMs: finalCoverage,
        availabilityTimeMs: kind === 'DELAYED_ACCURATE' ? finalCoverage + 1_000 : finalCoverage,
        diagnostics: {
          strategyShape: strategyKind,
          inferenceLatencyMs: kind === 'DELAYED_ACCURATE' ? 900 : 10,
          publicationDelayMs: kind === 'DELAYED_ACCURATE' ? 1_000 : 10,
        },
      }],
    },
  };
}

export function buildBakeoffReport(input: {
  scenarios: readonly BenchmarkScenario[];
  candidateDefinitions: readonly CandidateDefinition[];
  scenarioRuns: readonly CandidateScenarioRun[];
  gitHead: string;
  command: string;
  policy: { policyId: string; path: string; schemaVersion: number; sha256: string };
  benchmarkManifest: { manifestId: string; path: string; schemaVersion: number; sha256: string };
  dirtyTree: boolean;
  runtimeEnvironment?: Record<string, string>;
}): {
  schemaVersion: 3;
  generatedAt: string;
  gitHead: string;
  command: string;
  dirtyTree: boolean;
  policy: { policyId: string; path: string; schemaVersion: number; sha256: string };
  benchmarkManifest: { manifestId: string; path: string; schemaVersion: number; sha256: string };
  runtimeEnvironment: Record<string, string>;
  scenarioCountsBySplit: Record<BenchmarkSplit, number>;
  scoreableScenarioCount: number;
  missingOrUnrecordedScenarioCount: number;
  skippedScenarioCount: number;
  candidateDefinitionCount: number;
  candidateScenarioRunCount: number;
  splitLeakage: readonly string[];
  comparativeOutcome: ComparativeOutcome;
  resultSummary: Record<string, { comparativeRank: number | null; absoluteGateStatus: MetricStatus }>;
  candidateCoverage: Record<string, Record<AggregateSplit, CandidateSplitCoverage>>;
  aggregateMetrics: Record<string, Record<AggregateSplit, AggregateMetricVector>>;
  aggregateFamilyMetrics: Record<string, Record<AggregateSplit, Record<string, {
    expectedStrikeRecall: MetricNumber;
    falseMatchRateOnGroundTruthMissing: MetricNumber;
  }>>>;
  scores: readonly BakeoffScore[];
} {
  const splitLeakage = detectSplitLeakage(input.scenarios);
  validateScenarios(input.scenarios);
  validateScenarioRuns(input.scenarios, input.candidateDefinitions, input.scenarioRuns);
  const scores: BakeoffScore[] = [];
  for (const scenario of input.scenarios) {
    for (const definition of input.candidateDefinitions) {
      const run = input.scenarioRuns.find((candidateRun) =>
        candidateRun.candidateId === definition.candidateId && candidateRun.scenarioId === scenario.scenarioId
      );
      if (run) {
        scores.push(scoreCandidate(scenario, definition, run));
      } else {
        scores.push(missingRunScore(scenario, definition));
      }
    }
  }
  const evaluationScenarios = input.scenarios.filter((scenario) => scenario.split === 'EVALUATION');
  const candidateCoverage = Object.fromEntries(input.candidateDefinitions.map((definition) => [
    definition.candidateId,
    coverageBySplit(input.scenarios, scores.filter((score) => score.candidateId === definition.candidateId)),
  ])) as Record<string, Record<AggregateSplit, CandidateSplitCoverage>>;
  const comparativeOutcome = comparativeOutcomeFor({
    splitLeakage,
    evaluationScenarios,
    candidateCoverage,
  });
  const resultSummary = Object.fromEntries(input.candidateDefinitions.map((definition) => [definition.candidateId, {
    comparativeRank: null,
    absoluteGateStatus: 'NOT_EVALUATED' as MetricStatus,
  }]));
  const aggregateMetrics = Object.fromEntries(input.candidateDefinitions.map((definition) => [
    definition.candidateId,
    aggregateBySplit(scores.filter((score) => score.candidateId === definition.candidateId), aggregateCandidateMetrics),
  ])) as Record<string, Record<AggregateSplit, AggregateMetricVector>>;
  const familyAggregates = Object.fromEntries(input.candidateDefinitions.map((definition) => [
    definition.candidateId,
    aggregateBySplit(scores.filter((score) => score.candidateId === definition.candidateId), aggregateFamilyMetrics),
  ])) as Record<string, Record<AggregateSplit, Record<string, {
    expectedStrikeRecall: MetricNumber;
    falseMatchRateOnGroundTruthMissing: MetricNumber;
  }>>>;
  const scenarioCountsBySplit = input.scenarios.reduce<Record<BenchmarkSplit, number>>((counts, scenario) => {
    counts[scenario.split] += 1;
    return counts;
  }, { DEVELOPMENT: 0, CALIBRATION: 0, EVALUATION: 0 });
  return {
    schemaVersion: 3,
    generatedAt: new Date(0).toISOString(),
    gitHead: input.gitHead,
    command: input.command,
    dirtyTree: input.dirtyTree,
    policy: input.policy,
    benchmarkManifest: input.benchmarkManifest,
    runtimeEnvironment: input.runtimeEnvironment ?? {},
    scenarioCountsBySplit,
    scoreableScenarioCount: input.scenarios.filter((scenario) => scenario.physicalGroundTruth?.status === 'RECORDED').length,
    missingOrUnrecordedScenarioCount: input.scenarios.filter((scenario) => scenario.physicalGroundTruth?.status !== 'RECORDED').length,
    skippedScenarioCount: scores.filter((score) => score.candidateRunStatus === 'MISSING_DATA').length,
    candidateDefinitionCount: input.candidateDefinitions.length,
    candidateScenarioRunCount: input.scenarioRuns.length,
    splitLeakage,
    comparativeOutcome,
    resultSummary,
    candidateCoverage,
    aggregateMetrics,
    aggregateFamilyMetrics: familyAggregates,
    scores,
  };
}

export function sourceAudioTimeToPerformanceMs(scenario: BenchmarkScenario, sourceAudioTimeMs: number): number {
  validateBenchmarkScenario(scenario);
  if (!Number.isFinite(sourceAudioTimeMs)) throw new Error('Source audio time must be finite.');
  return sourceAudioTimeMs - scenario.audio.performanceOriginSourceMs;
}

export function performanceTimeToSourceAudioMs(scenario: BenchmarkScenario, performanceTimeMs: number): number {
  validateBenchmarkScenario(scenario);
  if (!Number.isFinite(performanceTimeMs)) throw new Error('Performance time must be finite.');
  return performanceTimeMs + scenario.audio.performanceOriginSourceMs;
}

export function isOwnedPerformanceTime(scenario: BenchmarkScenario, performanceTimeMs: number): boolean {
  validateBenchmarkScenario(scenario);
  return performanceTimeMs >= 0 && performanceTimeMs <= completionTimeMs(scenario);
}

function missingRunScore(scenario: BenchmarkScenario, definition: CandidateDefinition): BakeoffScore {
  const familyMetrics = Object.fromEntries([...new Set([
    ...scenario.familyTags,
    ...Object.values(scenario.taxonomy?.groups ?? {}).flat(),
  ])].map((tag) => [tag, {
    expectedStrikeRecall: missingDataMetric('candidate scenario run missing'),
    falseMatchRateOnGroundTruthMissing: missingDataMetric('candidate scenario run missing'),
  }]));
  return {
    scenarioId: scenario.scenarioId,
    scenarioSplit: scenario.split,
    candidateId: definition.candidateId,
    strategyKind: definition.strategyKind,
    candidateRunStatus: 'MISSING_DATA',
    groundTruthStatus: scenario.physicalGroundTruth?.status === 'RECORDED' ? 'MEASURED' : 'MISSING_DATA',
    candidateEvaluation: { status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' },
    metrics: missingDataMetrics('candidate scenario run missing'),
    extraDiagnostics: { matchedPhysicalExtras: 0, missedPhysicalExtras: 0, falseCandidateExtras: 0 },
    metricSamples: emptyMetricSamples(),
    familyMetrics,
  };
}

function comparativeOutcomeFor(input: {
  splitLeakage: readonly string[];
  evaluationScenarios: readonly BenchmarkScenario[];
  candidateCoverage: Record<string, Record<AggregateSplit, CandidateSplitCoverage>>;
}): ComparativeOutcome {
  if (input.evaluationScenarios.length === 0) {
    return 'INSUFFICIENT_EVALUATION_SET';
  }
  if (input.splitLeakage.length > 0) {
    return 'INELIGIBLE_SPLIT_LEAKAGE';
  }
  const incomplete = Object.values(input.candidateCoverage).some((coverage) => {
    const evaluation = coverage.EVALUATION;
    return evaluation.expectedScenarioCount === 0
      || evaluation.runPresentCount !== evaluation.expectedScenarioCount
      || evaluation.groundTruthScoreableCount !== evaluation.expectedScenarioCount
      || evaluation.candidateCompleteEvaluationCount !== evaluation.expectedScenarioCount
      || evaluation.candidateIncompleteAnalysisCount > 0
      || evaluation.missingRunCount > 0
      || evaluation.notScoreableGroundTruthCount > 0;
  });
  return incomplete ? 'INCOMPLETE_EVALUATION_COVERAGE' : 'EVALUATION_READY_NO_COMPARATOR_POLICY';
}

function coverageBySplit(
  scenarios: readonly BenchmarkScenario[],
  scores: readonly BakeoffScore[]
): Record<AggregateSplit, CandidateSplitCoverage> {
  return Object.fromEntries(allAggregateSplits().map((split) => {
    const splitScores = split === 'ALL_SPLITS_DIAGNOSTIC_ONLY'
      ? scores
      : scores.filter((score) => score.scenarioSplit === split);
    const splitScenarios = split === 'ALL_SPLITS_DIAGNOSTIC_ONLY'
      ? scenarios
      : scenarios.filter((scenario) => scenario.split === split);
    const coverage: CandidateSplitCoverage = {
      expectedScenarioCount: splitScenarios.length,
      runPresentCount: splitScores.filter((score) => score.candidateRunStatus !== 'MISSING_DATA').length,
      groundTruthScoreableCount: splitScores.filter((score) => score.groundTruthStatus === 'MEASURED').length,
      candidateCompleteEvaluationCount: splitScores.filter((score) => score.candidateEvaluation.status === 'COMPLETE').length,
      candidateIncompleteAnalysisCount: splitScores.filter((score) => score.candidateEvaluation.status === 'UNAVAILABLE').length,
      missingRunCount: splitScores.filter((score) => score.candidateRunStatus === 'MISSING_DATA').length,
      notScoreableGroundTruthCount: splitScores.filter((score) => score.groundTruthStatus !== 'MEASURED').length,
    };
    return [split, coverage];
  })) as Record<AggregateSplit, CandidateSplitCoverage>;
}

function aggregateBySplit<T>(
  scores: readonly BakeoffScore[],
  aggregate: (scores: readonly BakeoffScore[]) => T
): Record<AggregateSplit, T> {
  return Object.fromEntries(allAggregateSplits().map((split) => [
    split,
    aggregate(split === 'ALL_SPLITS_DIAGNOSTIC_ONLY'
      ? scores
      : scores.filter((score) => score.scenarioSplit === split)),
  ])) as Record<AggregateSplit, T>;
}

function allAggregateSplits(): AggregateSplit[] {
  return ['DEVELOPMENT', 'CALIBRATION', 'EVALUATION', 'ALL_SPLITS_DIAGNOSTIC_ONLY'];
}

function validateCandidateScenarioRun(
  scenario: BenchmarkScenario,
  definition: CandidateDefinition,
  run: CandidateScenarioRun
): void {
  if (run.candidateId !== definition.candidateId || run.scenarioId !== scenario.scenarioId) {
    throw new Error('Candidate scenario run must be bound to the scored candidateId and scenarioId.');
  }
  const completion = completionTimeMs(scenario);
  const seenPublications = new Set<string>();
  const seenObservations = new Map<string, CandidateObservation>();
  let previousCoverage = 0;
  let previousAvailability = Number.NEGATIVE_INFINITY;
  for (const [index, publication] of run.publications.entries()) {
    if (!publication.publicationId) throw new Error('Candidate publication requires publicationId.');
    if (seenPublications.has(publication.publicationId)) {
      throw new Error(`Duplicate candidate publicationId: ${publication.publicationId}`);
    }
    seenPublications.add(publication.publicationId);
    if (!Number.isFinite(publication.analyzedThroughPerformanceMs) || publication.analyzedThroughPerformanceMs < 0) {
      throw new Error('Candidate publication requires finite non-negative coverage.');
    }
    if (publication.analyzedThroughPerformanceMs > completion) {
      throw new Error('Candidate publication coverage cannot exceed scenario completion.');
    }
    if (index > 0 && publication.analyzedThroughPerformanceMs < previousCoverage) {
      throw new Error('Candidate publication coverage must be monotonically non-decreasing in canonical order.');
    }
    previousCoverage = publication.analyzedThroughPerformanceMs;
    if (publication.availabilityTimeMs !== undefined) {
      if (!Number.isFinite(publication.availabilityTimeMs) || publication.availabilityTimeMs < 0) {
        throw new Error('Candidate publication availability time must be finite and non-negative.');
      }
      if (publication.availabilityTimeMs < publication.analyzedThroughPerformanceMs) {
        throw new Error('Candidate publication availability time cannot be earlier than analyzed coverage.');
      }
      if (publication.availabilityTimeMs < previousAvailability) {
        throw new Error('Candidate publication availability time must not move backward in canonical order.');
      }
      previousAvailability = publication.availabilityTimeMs;
    }
    const publicationIds = new Set<string>();
    for (const observation of publication.observations) {
      if (
        !observation.observationId
        || !observation.pitch
        || !Number.isFinite(observation.performanceTimeMs)
        || observation.performanceTimeMs < 0
      ) {
        throw new Error('Candidate observation requires finite non-negative event time, pitch, and identity.');
      }
      if (observation.performanceTimeMs > publication.analyzedThroughPerformanceMs) {
        throw new Error('Candidate observation event time cannot exceed its publication coverage.');
      }
      if (publicationIds.has(observation.observationId)) {
        throw new Error(`Candidate publication contains duplicate observationId: ${observation.observationId}`);
      }
      publicationIds.add(observation.observationId);
      const existing = seenObservations.get(observation.observationId);
      if (existing && !candidateObservationsEqual(existing, observation)) {
        throw new Error(`Candidate observationId already exists with different evidence: ${observation.observationId}`);
      }
      seenObservations.set(observation.observationId, observation);
    }
  }
}

function validateCandidateDefinition(definition: CandidateDefinition): void {
  if (
    !definition.candidateId
    || !['CHUNKED', 'STREAMING'].includes(definition.strategyKind)
    || !definition.identity.modelRuntime
    || !definition.identity.adapterVersion
    || !definition.identity.configurationSha256
    || !['KNOWN_OVERLAP', 'KNOWN_DISJOINT', 'UNKNOWN'].includes(definition.identity.trainingDataOverlapStatus)
  ) {
    throw new Error('CandidateDefinition requires complete candidate identity and strategy metadata.');
  }
  if (
    definition.identity.modelCheckpointSha256 !== undefined
    && !/^[a-f0-9]{64}$/i.test(definition.identity.modelCheckpointSha256)
  ) {
    throw new Error('CandidateDefinition modelCheckpointSha256 must be a 64-character SHA256 hex digest.');
  }
}

function validateScenarios(scenarios: readonly BenchmarkScenario[]): void {
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    validateBenchmarkScenario(scenario);
    if (ids.has(scenario.scenarioId)) {
      throw new Error(`Duplicate benchmark scenarioId: ${scenario.scenarioId}`);
    }
    ids.add(scenario.scenarioId);
  }
}

function validateScenarioRuns(
  scenarios: readonly BenchmarkScenario[],
  definitions: readonly CandidateDefinition[],
  runs: readonly CandidateScenarioRun[]
): void {
  const candidateIds = new Set<string>();
  for (const definition of definitions) {
    validateCandidateDefinition(definition);
    if (candidateIds.has(definition.candidateId)) {
      throw new Error(`Duplicate CandidateDefinition candidateId: ${definition.candidateId}`);
    }
    candidateIds.add(definition.candidateId);
  }
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.scenarioId));
  const keys = new Set<string>();
  for (const run of runs) {
    if (!candidateIds.has(run.candidateId)) {
      throw new Error(`Candidate scenario run references unknown candidateId: ${run.candidateId}`);
    }
    if (!scenarioIds.has(run.scenarioId)) {
      throw new Error(`Candidate scenario run references unknown scenarioId: ${run.scenarioId}`);
    }
    const key = `${run.candidateId}\0${run.scenarioId}`;
    if (keys.has(key)) {
      throw new Error(`Duplicate candidate scenario run: ${run.candidateId} / ${run.scenarioId}`);
    }
    keys.add(key);
  }
}

function runFinalization(
  scenario: BenchmarkScenario,
  publications: readonly CandidatePublication[],
  sourceId: string,
  ownsCompleteCoverage: boolean
): CompletedContinuousEvaluation {
  const ledger = new ContinuousFinalizationLedger({
    expectedStrikes: scenario.expectedStrikes,
    assignmentWindowMs: DEFAULT_ASSIGNMENT_WINDOW_MS,
  });
  for (const publication of publications) {
    ledger.publishObservations(
      publication.observations.map((observation) => ({
        observationId: `${sourceId}:${observation.observationId}`,
        pitch: observation.pitch,
        performanceTimeMs: observation.performanceTimeMs,
        confidence: observation.confidence ?? 1,
        source: 'ACOUSTIC' as const,
      })),
      publication.analyzedThroughPerformanceMs
    );
  }
  ledger.complete({
    reason: scenario.completion?.kind === 'MANUAL' ? 'STOPPED_BY_USER' : 'SCOPE_COMPLETED',
    performanceTimeMs: completionTimeMs(scenario),
    terminalPerformanceMs: completionTimeMs(scenario),
  });
  if (ownsCompleteCoverage && publications.at(-1)?.analyzedThroughPerformanceMs !== completionTimeMs(scenario)) {
    ledger.advanceAnalysisThrough(completionTimeMs(scenario));
  }
  return ledger.completedEvaluation();
}

function metricSamples(
  scenario: BenchmarkScenario,
  publications: readonly CandidatePublication[],
  sourceId: string
): MetricSamples {
  const ledger = new ContinuousFinalizationLedger({
    expectedStrikes: scenario.expectedStrikes,
    assignmentWindowMs: DEFAULT_ASSIGNMENT_WINDOW_MS,
  });
  const finalized = new Set<string>();
  const finalizedFeedbackAgesMs: number[] = [];
  let feedbackAgeFinalizedStrikeCount = 0;
  let feedbackAgeMissingAvailabilityCount = 0;
  let completionApplied = false;
  const completionAt = completionTimeMs(scenario);
  const completeAtPerformanceBoundary = () => {
    if (completionApplied) return;
    ledger.complete({
      reason: scenario.completion?.kind === 'MANUAL' ? 'STOPPED_BY_USER' : 'SCOPE_COMPLETED',
      performanceTimeMs: completionAt,
      terminalPerformanceMs: completionAt,
    });
    completionApplied = true;
    recordNewFinalized(completionAt);
  };
  const recordNewFinalized = (availabilityTimeMs: number | undefined) => {
    for (const strike of ledger.snapshot().strikes) {
      if (strike.verdict === 'PENDING' || finalized.has(strike.strikeId)) continue;
      finalized.add(strike.strikeId);
      feedbackAgeFinalizedStrikeCount += 1;
      if (availabilityTimeMs === undefined) {
        feedbackAgeMissingAvailabilityCount += 1;
        continue;
      }
      const eventTime = strike.verdict === 'MATCHED'
        ? strike.expectedPerformanceTimeMs + strike.timingOffsetMs
        : strike.expectedPerformanceTimeMs;
      finalizedFeedbackAgesMs.push(availabilityTimeMs - eventTime);
    }
  };
  for (const publication of publications) {
    if (
      !completionApplied
      && publication.availabilityTimeMs !== undefined
      && publication.availabilityTimeMs >= completionAt
    ) {
      completeAtPerformanceBoundary();
    }
    ledger.publishObservations(
      publication.observations.map((observation) => ({
        observationId: `${sourceId}:${observation.observationId}`,
        pitch: observation.pitch,
        performanceTimeMs: observation.performanceTimeMs,
        confidence: observation.confidence ?? 1,
        source: 'ACOUSTIC' as const,
      })),
      publication.analyzedThroughPerformanceMs
    );
    recordNewFinalized(publication.availabilityTimeMs);
  }
  completeAtPerformanceBoundary();
  const latency = latencyDiagnostics(publications);
  return {
    timingAbsoluteErrorsMs: [],
    finalizedFeedbackAgesMs,
    inferenceLatencyMs: latency.inference,
    publicationDelayMs: latency.publicationDelay,
    feedbackAgeFinalizedStrikeCount,
    feedbackAgeMeasuredStrikeCount: finalizedFeedbackAgesMs.length,
    feedbackAgeMissingAvailabilityCount,
  };
}

function computeMetrics(
  scenario: BenchmarkScenario,
  groundTruth: CompletedContinuousEvaluation,
  candidate: CompletedContinuousEvaluation,
  samples: MetricSamples
): BakeoffScore['metrics'] {
  if (groundTruth.status !== 'COMPLETE' || candidate.status !== 'COMPLETE') {
    return {
      ...notEvaluatedMetrics('finalization did not complete'),
      finalizedFeedbackAgeP50Ms: distributionMetric(samples.finalizedFeedbackAgesMs, 'median'),
      finalizedFeedbackAgeP95Ms: distributionMetric(samples.finalizedFeedbackAgesMs, 'p95'),
      inferenceLatencyP50Ms: distributionMetric(samples.inferenceLatencyMs, 'median'),
      inferenceLatencyP95Ms: distributionMetric(samples.inferenceLatencyMs, 'p95'),
      publicationDelayP50Ms: distributionMetric(samples.publicationDelayMs, 'median'),
      publicationDelayP95Ms: distributionMetric(samples.publicationDelayMs, 'p95'),
    };
  }
  const candidateByStrike = new Map(candidate.strikes.map((strike) => [strike.strikeId, strike]));
  const gtMatched = groundTruth.strikes.filter((strike) => strike.result === 'MATCHED');
  const candidateTrueMatched = gtMatched.filter((strike) => candidateByStrike.get(strike.strikeId)?.result === 'MATCHED');
  const gtMissing = groundTruth.strikes.filter((strike) => strike.result === 'MISSING');
  const falseMatches = gtMissing.filter((strike) => candidateByStrike.get(strike.strikeId)?.result === 'MATCHED');
  const correctMissing = gtMissing.filter((strike) => candidateByStrike.get(strike.strikeId)?.result === 'MISSING');
  const verdictAgreement = groundTruth.strikes.filter((strike) => candidateByStrike.get(strike.strikeId)?.result === strike.result);
  const timingErrors = candidateTrueMatched.flatMap((gtStrike) => {
    const candidateStrike = candidateByStrike.get(gtStrike.strikeId);
    if (!candidateStrike || candidateStrike.result !== 'MATCHED' || gtStrike.result !== 'MATCHED') return [];
    return [candidateStrike.timingOffsetMs - gtStrike.timingOffsetMs];
  });
  const timingAbsoluteErrorsMs = timingErrors.map(Math.abs);
  samples.timingAbsoluteErrorsMs = timingAbsoluteErrorsMs;
  const groupMetrics = chordCompleteness(scenario, groundTruth, candidate);
  const extras = extraDiagnostics(groundTruth, candidate);
  return {
    expectedStrikeRecall: ratioMetric(candidateTrueMatched.length, gtMatched.length),
    falseMatchRateOnGroundTruthMissing: ratioMetric(falseMatches.length, gtMissing.length),
    correctMissingRate: ratioMetric(correctMissing.length, gtMissing.length),
    verdictAgreementRate: ratioMetric(verdictAgreement.length, groundTruth.strikes.length),
    timingAbsoluteMedianMs: distributionMetric(timingAbsoluteErrorsMs, 'median'),
    timingAbsoluteP95Ms: distributionMetric(timingAbsoluteErrorsMs, 'p95'),
    chordExactCompletenessRate: ratioMetric(groupMetrics.exactComplete, groupMetrics.totalCompleteChordGroups),
    falseCompleteChordAcceptanceRate: ratioMetric(groupMetrics.falseComplete, groupMetrics.groundTruthIncompleteChordGroups),
    extraPrecision: ratioMetric(extras.matchedPhysicalExtras, extras.matchedPhysicalExtras + extras.falseCandidateExtras),
    extraRecall: ratioMetric(extras.matchedPhysicalExtras, extras.matchedPhysicalExtras + extras.missedPhysicalExtras),
    finalizedFeedbackAgeP50Ms: distributionMetric(samples.finalizedFeedbackAgesMs, 'median'),
    finalizedFeedbackAgeP95Ms: distributionMetric(samples.finalizedFeedbackAgesMs, 'p95'),
    inferenceLatencyP50Ms: distributionMetric(samples.inferenceLatencyMs, 'median'),
    inferenceLatencyP95Ms: distributionMetric(samples.inferenceLatencyMs, 'p95'),
    publicationDelayP50Ms: distributionMetric(samples.publicationDelayMs, 'median'),
    publicationDelayP95Ms: distributionMetric(samples.publicationDelayMs, 'p95'),
  };
}

function familyMetrics(
  scenario: BenchmarkScenario,
  groundTruth: CompletedContinuousEvaluation | undefined,
  candidate: CompletedContinuousEvaluation
): BakeoffScore['familyMetrics'] {
  const allTags = new Set(scenario.familyTags);
  for (const tags of Object.values(scenario.taxonomy?.groups ?? {})) {
    tags.forEach((tag) => allTags.add(tag));
  }
  if (!groundTruth || groundTruth.status !== 'COMPLETE' || candidate.status !== 'COMPLETE') {
    return Object.fromEntries([...allTags].map((tag) => [tag, {
      expectedStrikeRecall: notEvaluated('physical ground truth is not recorded or finalization is incomplete'),
      falseMatchRateOnGroundTruthMissing: notEvaluated('physical ground truth is not recorded or finalization is incomplete'),
    }]));
  }
  const candidateByStrike = new Map(candidate.strikes.map((strike) => [strike.strikeId, strike]));
  return Object.fromEntries([...allTags].map((tag) => {
    const groupIds = new Set(Object.entries(scenario.taxonomy?.groups ?? {})
      .filter(([, tags]) => tags.includes(tag))
      .map(([groupId]) => groupId));
    const gtStrikes = groundTruth.strikes.filter((strike) => groupIds.size === 0 || groupIds.has(strike.expectedGroupId));
    const gtMatched = gtStrikes.filter((strike) => strike.result === 'MATCHED');
    const trueMatched = gtMatched.filter((strike) => candidateByStrike.get(strike.strikeId)?.result === 'MATCHED');
    const gtMissing = gtStrikes.filter((strike) => strike.result === 'MISSING');
    const falseMatches = gtMissing.filter((strike) => candidateByStrike.get(strike.strikeId)?.result === 'MATCHED');
    return [tag, {
      expectedStrikeRecall: ratioMetric(trueMatched.length, gtMatched.length),
      falseMatchRateOnGroundTruthMissing: ratioMetric(falseMatches.length, gtMissing.length),
    }];
  }));
}

function chordCompleteness(
  scenario: BenchmarkScenario,
  groundTruth: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>,
  candidate: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>
): { exactComplete: number; totalCompleteChordGroups: number; falseComplete: number; groundTruthIncompleteChordGroups: number } {
  const groups = new Set(scenario.expectedStrikes.map((strike) => strike.groupId));
  let exactComplete = 0;
  let totalCompleteChordGroups = 0;
  let falseComplete = 0;
  let groundTruthIncompleteChordGroups = 0;
  for (const groupId of groups) {
    const expectedPitches = new Set(scenario.expectedStrikes
      .filter((strike) => strike.groupId === groupId)
      .map((strike) => strike.pitch));
    if (expectedPitches.size < 2) continue;
    const gtGroup = groundTruth.strikes.filter((strike) => strike.expectedGroupId === groupId);
    const candidateGroup = candidate.strikes.filter((strike) => strike.expectedGroupId === groupId);
    const gtComplete = gtGroup.every((strike) => strike.result === 'MATCHED');
    const candidateComplete = candidateGroup.every((strike) => strike.result === 'MATCHED');
    if (gtComplete) {
      totalCompleteChordGroups += 1;
      if (candidateComplete) exactComplete += 1;
    } else {
      groundTruthIncompleteChordGroups += 1;
      if (candidateComplete) falseComplete += 1;
    }
  }
  return { exactComplete, totalCompleteChordGroups, falseComplete, groundTruthIncompleteChordGroups };
}

function extraDiagnostics(
  groundTruth: CompletedContinuousEvaluation,
  candidate: CompletedContinuousEvaluation
): ExtraDiagnostics {
  if (groundTruth.status !== 'COMPLETE' || candidate.status !== 'COMPLETE') {
    return { matchedPhysicalExtras: 0, missedPhysicalExtras: 0, falseCandidateExtras: 0 };
  }
  const matches = oneToOneExtraMatches(groundTruth.extras, candidate.extras);
  return {
    matchedPhysicalExtras: matches,
    missedPhysicalExtras: groundTruth.extras.length - matches,
    falseCandidateExtras: candidate.extras.length - matches,
  };
}

function oneToOneExtraMatches(
  groundTruthExtras: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>['extras'],
  candidateExtras: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>['extras']
): number {
  const assignments = assignObservedAttacksToExpectedStrikes({
    expectedStrikes: groundTruthExtras.map((truth, index) => ({
      strikeId: `physical-extra-${index}`,
      groupId: `physical-extra-${index}`,
      pitch: truth.pitch,
      expectedPerformanceTimeMs: truth.performanceTimeMs,
      renderNoteIds: [],
    })),
    observedAttacks: candidateExtras.map((candidate, index) => ({
      observationId: `candidate-extra-${index}`,
      pitch: candidate.pitch,
      performanceTimeMs: candidate.performanceTimeMs,
      confidence: 1,
      source: 'ACOUSTIC' as const,
    })),
    assignmentWindowMs: DEFAULT_ASSIGNMENT_WINDOW_MS,
  });
  return assignments.size;
}

function aggregateCandidateMetrics(scores: readonly BakeoffScore[]): AggregateMetricVector {
  const expectedStrikeRecall = pooledRatio(scores, (score) => score.metrics.expectedStrikeRecall);
  const falseMatchRateOnGroundTruthMissing = pooledRatio(scores, (score) => score.metrics.falseMatchRateOnGroundTruthMissing);
  const correctMissingRate = pooledRatio(scores, (score) => score.metrics.correctMissingRate);
  const verdictAgreementRate = pooledRatio(scores, (score) => score.metrics.verdictAgreementRate);
  const chordExactCompletenessRate = pooledRatio(scores, (score) => score.metrics.chordExactCompletenessRate);
  const falseCompleteChordAcceptanceRate = pooledRatio(scores, (score) => score.metrics.falseCompleteChordAcceptanceRate);
  const extraDiagnostics = scores.reduce<ExtraDiagnostics>((totals, score) => ({
    matchedPhysicalExtras: totals.matchedPhysicalExtras + score.extraDiagnostics.matchedPhysicalExtras,
    missedPhysicalExtras: totals.missedPhysicalExtras + score.extraDiagnostics.missedPhysicalExtras,
    falseCandidateExtras: totals.falseCandidateExtras + score.extraDiagnostics.falseCandidateExtras,
  }), { matchedPhysicalExtras: 0, missedPhysicalExtras: 0, falseCandidateExtras: 0 });
  const feedbackAgeCoverage = scores.reduce((totals, score) => ({
    finalizedStrikeCount: totals.finalizedStrikeCount + score.metricSamples.feedbackAgeFinalizedStrikeCount,
    measuredStrikeCount: totals.measuredStrikeCount + score.metricSamples.feedbackAgeMeasuredStrikeCount,
    missingAvailabilityCount: totals.missingAvailabilityCount + score.metricSamples.feedbackAgeMissingAvailabilityCount,
  }), { finalizedStrikeCount: 0, measuredStrikeCount: 0, missingAvailabilityCount: 0 });
  return {
    expectedStrikeRecall,
    falseMatchRateOnGroundTruthMissing,
    correctMissingRate,
    verdictAgreementRate,
    chordExactCompletenessRate,
    falseCompleteChordAcceptanceRate,
    extraPrecision: ratioMetric(extraDiagnostics.matchedPhysicalExtras, extraDiagnostics.matchedPhysicalExtras + extraDiagnostics.falseCandidateExtras),
    extraRecall: ratioMetric(extraDiagnostics.matchedPhysicalExtras, extraDiagnostics.matchedPhysicalExtras + extraDiagnostics.missedPhysicalExtras),
    timingAbsoluteMedianMs: distributionMetric(scores.flatMap((score) => score.metricSamples.timingAbsoluteErrorsMs), 'median'),
    timingAbsoluteP95Ms: distributionMetric(scores.flatMap((score) => score.metricSamples.timingAbsoluteErrorsMs), 'p95'),
    finalizedFeedbackAgeP50Ms: distributionMetric(scores.flatMap((score) => score.metricSamples.finalizedFeedbackAgesMs), 'median'),
    finalizedFeedbackAgeP95Ms: distributionMetric(scores.flatMap((score) => score.metricSamples.finalizedFeedbackAgesMs), 'p95'),
    inferenceLatencyP50Ms: distributionMetric(scores.flatMap((score) => score.metricSamples.inferenceLatencyMs), 'median'),
    inferenceLatencyP95Ms: distributionMetric(scores.flatMap((score) => score.metricSamples.inferenceLatencyMs), 'p95'),
    publicationDelayP50Ms: distributionMetric(scores.flatMap((score) => score.metricSamples.publicationDelayMs), 'median'),
    publicationDelayP95Ms: distributionMetric(scores.flatMap((score) => score.metricSamples.publicationDelayMs), 'p95'),
    extraDiagnostics,
    feedbackAgeCoverage,
  };
}

function aggregateFamilyMetrics(scores: readonly BakeoffScore[]): Record<string, {
  expectedStrikeRecall: MetricNumber;
  falseMatchRateOnGroundTruthMissing: MetricNumber;
}> {
  const familyTags = new Set(scores.flatMap((score) => Object.keys(score.familyMetrics)));
  return Object.fromEntries([...familyTags].map((tag) => {
    const familyScores = scores.flatMap((score) => score.familyMetrics[tag] ? [score.familyMetrics[tag]] : []);
    return [tag, {
      expectedStrikeRecall: pooledRatio(familyScores, (score) => score.expectedStrikeRecall),
      falseMatchRateOnGroundTruthMissing: pooledRatio(familyScores, (score) => score.falseMatchRateOnGroundTruthMissing),
    }];
  }));
}

function pooledRatio<T>(items: readonly T[], select: (item: T) => MetricNumber): MetricNumber {
  let numerator = 0;
  let denominator = 0;
  for (const item of items) {
    const metric = select(item);
    if (metric.status === 'MEASURED') {
      numerator += metric.numerator ?? 0;
      denominator += metric.denominator ?? metric.sampleCount;
    }
  }
  return ratioMetric(numerator, denominator);
}

function latencyDiagnostics(publications: readonly CandidatePublication[]): { inference: number[]; publicationDelay: number[] } {
  return {
    inference: publications.flatMap((publication) =>
      publication.diagnostics?.inferenceLatencyMs === undefined ? [] : [publication.diagnostics.inferenceLatencyMs]
    ),
    publicationDelay: publications.flatMap((publication) =>
      publication.diagnostics?.publicationDelayMs === undefined ? [] : [publication.diagnostics.publicationDelayMs]
    ),
  };
}

function ratioMetric(numerator: number, denominator: number): MetricNumber {
  if (denominator === 0) {
    return notEvaluated('zero metric sample count');
  }
  return {
    status: 'MEASURED',
    sampleCount: denominator,
    numerator,
    denominator,
    value: numerator / denominator,
  };
}

function distributionMetric(values: readonly number[], kind: 'median' | 'p95'): MetricNumber {
  if (values.length === 0) {
    return notEvaluated('zero metric sample count');
  }
  const sorted = values.slice().sort((left, right) => left - right);
  return {
    status: 'MEASURED',
    sampleCount: sorted.length,
    value: percentile(sorted, kind === 'median' ? 0.5 : 0.95),
  };
}

function percentile(sortedValues: readonly number[], p: number): number {
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(p * sortedValues.length) - 1));
  return sortedValues[index];
}

function notEvaluated(reason: string): MetricNumber {
  return { status: 'NOT_EVALUATED', sampleCount: 0, reason };
}

function missingDataMetric(reason: string): MetricNumber {
  return { status: 'MISSING_DATA', sampleCount: 0, reason };
}

function notEvaluatedMetrics(reason: string): BakeoffScore['metrics'] {
  return {
    expectedStrikeRecall: notEvaluated(reason),
    falseMatchRateOnGroundTruthMissing: notEvaluated(reason),
    correctMissingRate: notEvaluated(reason),
    verdictAgreementRate: notEvaluated(reason),
    timingAbsoluteMedianMs: notEvaluated(reason),
    timingAbsoluteP95Ms: notEvaluated(reason),
    chordExactCompletenessRate: notEvaluated(reason),
    falseCompleteChordAcceptanceRate: notEvaluated(reason),
    extraPrecision: notEvaluated(reason),
    extraRecall: notEvaluated(reason),
    finalizedFeedbackAgeP50Ms: notEvaluated(reason),
    finalizedFeedbackAgeP95Ms: notEvaluated(reason),
    inferenceLatencyP50Ms: notEvaluated(reason),
    inferenceLatencyP95Ms: notEvaluated(reason),
    publicationDelayP50Ms: notEvaluated(reason),
    publicationDelayP95Ms: notEvaluated(reason),
  };
}

function missingDataMetrics(reason: string): BakeoffScore['metrics'] {
  return {
    expectedStrikeRecall: missingDataMetric(reason),
    falseMatchRateOnGroundTruthMissing: missingDataMetric(reason),
    correctMissingRate: missingDataMetric(reason),
    verdictAgreementRate: missingDataMetric(reason),
    timingAbsoluteMedianMs: missingDataMetric(reason),
    timingAbsoluteP95Ms: missingDataMetric(reason),
    chordExactCompletenessRate: missingDataMetric(reason),
    falseCompleteChordAcceptanceRate: missingDataMetric(reason),
    extraPrecision: missingDataMetric(reason),
    extraRecall: missingDataMetric(reason),
    finalizedFeedbackAgeP50Ms: missingDataMetric(reason),
    finalizedFeedbackAgeP95Ms: missingDataMetric(reason),
    inferenceLatencyP50Ms: missingDataMetric(reason),
    inferenceLatencyP95Ms: missingDataMetric(reason),
    publicationDelayP50Ms: missingDataMetric(reason),
    publicationDelayP95Ms: missingDataMetric(reason),
  };
}

function emptyMetricSamples(): MetricSamples {
  return {
    timingAbsoluteErrorsMs: [],
    finalizedFeedbackAgesMs: [],
    inferenceLatencyMs: [],
    publicationDelayMs: [],
    feedbackAgeFinalizedStrikeCount: 0,
    feedbackAgeMeasuredStrikeCount: 0,
    feedbackAgeMissingAvailabilityCount: 0,
  };
}

function completionTimeMs(scenario: BenchmarkScenario): number {
  return scenario.completion?.performanceTimeMs
    ?? Math.max(...scenario.expectedStrikes.map((strike) => strike.expectedPerformanceTimeMs)) + DEFAULT_ASSIGNMENT_WINDOW_MS;
}

function candidateObservationsEqual(left: CandidateObservation, right: CandidateObservation): boolean {
  return left.observationId === right.observationId
    && left.pitch === right.pitch
    && left.performanceTimeMs === right.performanceTimeMs
    && left.confidence === right.confidence;
}

function stableHash(value: unknown): string {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}
