import { ContinuousFinalizationLedger } from '../local-core/continuous-finalization-ledger';
import { DEFAULT_ASSIGNMENT_WINDOW_MS } from '../local-core/continuous-evaluation-session';
import type { CompletedContinuousEvaluation } from '../completed-performance';

type BenchmarkSplit = 'DEVELOPMENT' | 'CALIBRATION' | 'EVALUATION';
export type CandidateStrategyKind = 'CHUNKED' | 'STREAMING';
export type MetricStatus = 'MEASURED' | 'NOT_EVALUATED' | 'INSUFFICIENT_DATA' | 'MISSING_DATA';
type CorpusOverlapStatus = 'KNOWN_OVERLAP' | 'KNOWN_DISJOINT' | 'UNKNOWN';
type ComparativeOutcome = 'RANKED' | 'INSUFFICIENT_EVALUATION_SET' | 'INELIGIBLE_SPLIT_LEAKAGE';

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
    pcmIdentity: string;
  };
  expectedStrikes: readonly BenchmarkExpectedStrike[];
  physicalGroundTruth?: {
    status: 'RECORDED' | 'PLANNED_NOT_RECORDED' | 'MISSING';
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

type CandidateObservation = {
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence?: number;
};

type CandidatePublication = {
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

export type BakeoffScore = {
  scenarioId: string;
  candidateId: string;
  strategyKind: CandidateStrategyKind;
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
  familyMetrics: Record<string, {
    expectedStrikeRecall: MetricNumber;
    falseMatchRateOnGroundTruthMissing: MetricNumber;
  }>;
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
  if (scenario.physicalGroundTruth?.status === 'RECORDED' && !scenario.source.sourceMidiSha256) {
    throw new Error('Recorded physical ground truth requires synchronized source MIDI identity.');
  }
  if (!Number.isFinite(scenario.audio.nativeSampleRateHz) || scenario.audio.nativeSampleRateHz <= 0) {
    throw new Error('Benchmark scenario requires positive native sample rate.');
  }
  if (
    !Number.isFinite(scenario.audio.clipStartMs)
    || !Number.isFinite(scenario.audio.clipEndMs)
    || scenario.audio.clipStartMs < 0
    || scenario.audio.clipEndMs < scenario.audio.clipStartMs
  ) {
    throw new Error('Benchmark scenario requires finite ordered audio clip bounds.');
  }
  const completion = completionTimeMs(scenario);
  if (!Number.isFinite(completion) || completion < 0) {
    throw new Error('Benchmark scenario requires finite non-negative completion time.');
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
  validateCandidateScenarioRun(scenario, definition, run);
  const candidateEvaluation = runFinalization(scenario, run.publications, definition.candidateId, false);
  const finalizationAges = finalizedFeedbackAges(scenario, run.publications, definition.candidateId);

  if (!scenario.physicalGroundTruth || scenario.physicalGroundTruth.status !== 'RECORDED') {
    return {
      scenarioId: scenario.scenarioId,
      candidateId: definition.candidateId,
      strategyKind: definition.strategyKind,
      groundTruthStatus: scenario.physicalGroundTruth?.status === 'PLANNED_NOT_RECORDED'
        ? 'INSUFFICIENT_DATA'
        : 'MISSING_DATA',
      candidateEvaluation,
      metrics: notEvaluatedMetrics('physical ground truth is not recorded'),
      extraDiagnostics: { matchedPhysicalExtras: 0, missedPhysicalExtras: 0, falseCandidateExtras: 0 },
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
    candidateId: definition.candidateId,
    strategyKind: definition.strategyKind,
    groundTruthStatus: groundTruthEvaluation.status === 'COMPLETE' ? 'MEASURED' : 'INSUFFICIENT_DATA',
    candidateEvaluation,
    groundTruthEvaluation,
    metrics: computeMetrics(scenario, groundTruthEvaluation, candidateEvaluation, finalizationAges, run.publications),
    extraDiagnostics: extraDiagnostics(groundTruthEvaluation, candidateEvaluation),
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
  schemaVersion: 2;
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
  aggregateMetrics: Record<string, { expectedStrikeRecall: MetricNumber; verdictAgreementRate: MetricNumber }>;
  scores: readonly BakeoffScore[];
} {
  const splitLeakage = detectSplitLeakage(input.scenarios);
  validateScenarioRuns(input.candidateDefinitions, input.scenarioRuns);
  const scores: BakeoffScore[] = [];
  for (const scenario of input.scenarios) {
    for (const definition of input.candidateDefinitions) {
      const run = input.scenarioRuns.find((candidateRun) =>
        candidateRun.candidateId === definition.candidateId && candidateRun.scenarioId === scenario.scenarioId
      );
      if (run) {
        scores.push(scoreCandidate(scenario, definition, run));
      }
    }
  }
  const evaluationScenarios = input.scenarios.filter((scenario) => scenario.split === 'EVALUATION');
  const comparativeOutcome: ComparativeOutcome = splitLeakage.length > 0 && evaluationScenarios.length > 0
    ? 'INELIGIBLE_SPLIT_LEAKAGE'
    : evaluationScenarios.length === 0
      ? 'INSUFFICIENT_EVALUATION_SET'
      : 'INSUFFICIENT_EVALUATION_SET';
  const resultSummary = Object.fromEntries(input.candidateDefinitions.map((definition) => [definition.candidateId, {
    comparativeRank: null,
    absoluteGateStatus: 'NOT_EVALUATED' as MetricStatus,
  }]));
  const aggregateMetrics = Object.fromEntries(input.candidateDefinitions.map((definition) => [
    definition.candidateId,
    aggregateCandidateMetrics(scores.filter((score) => score.candidateId === definition.candidateId)),
  ]));
  const scenarioCountsBySplit = input.scenarios.reduce<Record<BenchmarkSplit, number>>((counts, scenario) => {
    counts[scenario.split] += 1;
    return counts;
  }, { DEVELOPMENT: 0, CALIBRATION: 0, EVALUATION: 0 });
  return {
    schemaVersion: 2,
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
    skippedScenarioCount: Math.max(0, input.scenarios.length * input.candidateDefinitions.length - scores.length),
    candidateDefinitionCount: input.candidateDefinitions.length,
    candidateScenarioRunCount: input.scenarioRuns.length,
    splitLeakage,
    comparativeOutcome,
    resultSummary,
    aggregateMetrics,
    scores,
  };
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

function validateScenarioRuns(
  definitions: readonly CandidateDefinition[],
  runs: readonly CandidateScenarioRun[]
): void {
  const candidateIds = new Set(definitions.map((definition) => definition.candidateId));
  const keys = new Set<string>();
  for (const run of runs) {
    if (!candidateIds.has(run.candidateId)) {
      throw new Error(`Candidate scenario run references unknown candidateId: ${run.candidateId}`);
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

function finalizedFeedbackAges(
  scenario: BenchmarkScenario,
  publications: readonly CandidatePublication[],
  sourceId: string
): number[] {
  const ledger = new ContinuousFinalizationLedger({
    expectedStrikes: scenario.expectedStrikes,
    assignmentWindowMs: DEFAULT_ASSIGNMENT_WINDOW_MS,
  });
  const finalized = new Set<string>();
  const ages: number[] = [];
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
    const availableAt = publication.availabilityTimeMs ?? publication.analyzedThroughPerformanceMs;
    for (const strike of ledger.snapshot().strikes) {
      if (strike.verdict === 'PENDING' || finalized.has(strike.strikeId)) continue;
      finalized.add(strike.strikeId);
      const eventTime = strike.verdict === 'MATCHED'
        ? strike.expectedPerformanceTimeMs + strike.timingOffsetMs
        : strike.expectedPerformanceTimeMs;
      ages.push(availableAt - eventTime);
    }
  }
  return ages;
}

function computeMetrics(
  scenario: BenchmarkScenario,
  groundTruth: CompletedContinuousEvaluation,
  candidate: CompletedContinuousEvaluation,
  finalizationAges: readonly number[],
  publications: readonly CandidatePublication[]
): BakeoffScore['metrics'] {
  const latency = latencyDiagnostics(publications);
  if (groundTruth.status !== 'COMPLETE' || candidate.status !== 'COMPLETE') {
    return {
      ...notEvaluatedMetrics('finalization did not complete'),
      finalizedFeedbackAgeP50Ms: distributionMetric(finalizationAges, 'median'),
      finalizedFeedbackAgeP95Ms: distributionMetric(finalizationAges, 'p95'),
      inferenceLatencyP50Ms: distributionMetric(latency.inference, 'median'),
      inferenceLatencyP95Ms: distributionMetric(latency.inference, 'p95'),
      publicationDelayP50Ms: distributionMetric(latency.publicationDelay, 'median'),
      publicationDelayP95Ms: distributionMetric(latency.publicationDelay, 'p95'),
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
  const groupMetrics = chordCompleteness(scenario, groundTruth, candidate);
  const extras = extraDiagnostics(groundTruth, candidate);
  return {
    expectedStrikeRecall: ratioMetric(candidateTrueMatched.length, gtMatched.length),
    falseMatchRateOnGroundTruthMissing: ratioMetric(falseMatches.length, gtMissing.length),
    correctMissingRate: ratioMetric(correctMissing.length, gtMissing.length),
    verdictAgreementRate: ratioMetric(verdictAgreement.length, groundTruth.strikes.length),
    timingAbsoluteMedianMs: distributionMetric(timingErrors.map(Math.abs), 'median'),
    timingAbsoluteP95Ms: distributionMetric(timingErrors.map(Math.abs), 'p95'),
    chordExactCompletenessRate: ratioMetric(groupMetrics.exactComplete, groupMetrics.totalCompleteChordGroups),
    falseCompleteChordAcceptanceRate: ratioMetric(groupMetrics.falseComplete, groupMetrics.groundTruthIncompleteChordGroups),
    extraPrecision: ratioMetric(extras.matchedPhysicalExtras, extras.matchedPhysicalExtras + extras.falseCandidateExtras),
    extraRecall: ratioMetric(extras.matchedPhysicalExtras, extras.matchedPhysicalExtras + extras.missedPhysicalExtras),
    finalizedFeedbackAgeP50Ms: distributionMetric(finalizationAges, 'median'),
    finalizedFeedbackAgeP95Ms: distributionMetric(finalizationAges, 'p95'),
    inferenceLatencyP50Ms: distributionMetric(latency.inference, 'median'),
    inferenceLatencyP95Ms: distributionMetric(latency.inference, 'p95'),
    publicationDelayP50Ms: distributionMetric(latency.publicationDelay, 'median'),
    publicationDelayP95Ms: distributionMetric(latency.publicationDelay, 'p95'),
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
  const used = new Set<number>();
  let count = 0;
  for (const candidate of candidateExtras) {
    let bestIndex = -1;
    let bestError = Number.POSITIVE_INFINITY;
    groundTruthExtras.forEach((truth, index) => {
      if (used.has(index) || truth.pitch !== candidate.pitch) return;
      const error = Math.abs(truth.performanceTimeMs - candidate.performanceTimeMs);
      if (error <= DEFAULT_ASSIGNMENT_WINDOW_MS && error < bestError) {
        bestError = error;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      count += 1;
    }
  }
  return count;
}

function aggregateCandidateMetrics(scores: readonly BakeoffScore[]): { expectedStrikeRecall: MetricNumber; verdictAgreementRate: MetricNumber } {
  let recallNumerator = 0;
  let recallDenominator = 0;
  let agreementNumerator = 0;
  let agreementDenominator = 0;
  for (const score of scores) {
    if (score.metrics.expectedStrikeRecall.status === 'MEASURED') {
      recallNumerator += score.metrics.expectedStrikeRecall.numerator ?? 0;
      recallDenominator += score.metrics.expectedStrikeRecall.denominator ?? score.metrics.expectedStrikeRecall.sampleCount;
    }
    if (score.metrics.verdictAgreementRate.status === 'MEASURED') {
      agreementNumerator += score.metrics.verdictAgreementRate.numerator ?? 0;
      agreementDenominator += score.metrics.verdictAgreementRate.denominator ?? score.metrics.verdictAgreementRate.sampleCount;
    }
  }
  return {
    expectedStrikeRecall: ratioMetric(recallNumerator, recallDenominator),
    verdictAgreementRate: ratioMetric(agreementNumerator, agreementDenominator),
  };
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
