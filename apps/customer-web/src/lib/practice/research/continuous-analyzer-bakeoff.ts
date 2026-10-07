import type { PracticeScoreArtifact } from '../local-core/artifact';
import { ContinuousEvaluationSession, DEFAULT_ASSIGNMENT_WINDOW_MS } from '../local-core/continuous-evaluation-session';
import type { CompletedContinuousEvaluation } from '../completed-performance';

type BenchmarkSplit = 'DEVELOPMENT' | 'CALIBRATION' | 'EVALUATION';
export type CandidateStrategyKind = 'CHUNKED' | 'STREAMING';
export type MetricStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED' | 'INSUFFICIENT_DATA' | 'MISSING_DATA';
type CorpusOverlapStatus = 'KNOWN_OVERLAP' | 'KNOWN_DISJOINT' | 'UNKNOWN';

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
  };
};

export type CandidateRun = {
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
  publications: readonly CandidatePublication[];
};

type MetricNumber =
  | {
      status: 'PASS' | 'FAIL';
      sampleCount: number;
      value: number;
    }
  | {
      status: 'NOT_EVALUATED' | 'INSUFFICIENT_DATA' | 'MISSING_DATA';
      sampleCount: number;
      reason: string;
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
    groupExactCompletenessRate: MetricNumber;
    falseCompleteChordAcceptanceRate: MetricNumber;
    extraPrecision: MetricNumber;
    finalizedFeedbackAgeP50Ms: MetricNumber;
    finalizedFeedbackAgeP95Ms: MetricNumber;
  };
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
  if (!Number.isFinite(scenario.audio.nativeSampleRateHz) || scenario.audio.nativeSampleRateHz <= 0) {
    throw new Error('Benchmark scenario requires positive native sample rate.');
  }
  if (!Array.isArray(scenario.expectedStrikes) || scenario.expectedStrikes.length === 0) {
    throw new Error('Benchmark scenario requires ExpectedStrike timeline.');
  }
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
  }
  if (scenario.physicalGroundTruth?.status === 'RECORDED' && scenario.physicalGroundTruth.attacks.length === 0) {
    throw new Error('Recorded physical ground truth requires at least one physical attack.');
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

export function scoreCandidate(scenario: BenchmarkScenario, candidate: CandidateRun): BakeoffScore {
  validateBenchmarkScenario(scenario);
  validateCandidateRun(candidate);
  const candidateEvaluation = runFinalization(scenario, candidate.publications, candidate.candidateId);
  const finalizationAges = finalizedFeedbackAges(scenario, candidate.publications, candidate.candidateId);

  if (!scenario.physicalGroundTruth || scenario.physicalGroundTruth.status !== 'RECORDED') {
    return {
      scenarioId: scenario.scenarioId,
      candidateId: candidate.candidateId,
      strategyKind: candidate.strategyKind,
      groundTruthStatus: scenario.physicalGroundTruth?.status === 'PLANNED_NOT_RECORDED'
        ? 'INSUFFICIENT_DATA'
        : 'MISSING_DATA',
      candidateEvaluation,
      metrics: notEvaluatedMetrics('physical ground truth is not recorded'),
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
    'ground-truth'
  );
  return {
    scenarioId: scenario.scenarioId,
    candidateId: candidate.candidateId,
    strategyKind: candidate.strategyKind,
    groundTruthStatus: 'PASS',
    candidateEvaluation,
    groundTruthEvaluation,
    metrics: computeMetrics(scenario, groundTruthEvaluation, candidateEvaluation, finalizationAges),
    familyMetrics: familyMetrics(scenario, groundTruthEvaluation, candidateEvaluation),
  };
}

export function fakeCandidate(scenario: BenchmarkScenario, kind: 'PERFECT' | 'EMPTY' | 'DUPLICATE_EXTRA' | 'DELAYED_ACCURATE', strategyKind: CandidateStrategyKind = 'CHUNKED'): CandidateRun {
  const baseIdentity = {
    modelRuntime: `fake-${kind.toLowerCase()}`,
    adapterVersion: 'phase9d-fake-v1',
    configurationSha256: stableHash({ kind, strategyKind }),
    trainingDataOverlapStatus: 'UNKNOWN' as const,
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
  return {
    candidateId: `fake-${kind.toLowerCase()}-${strategyKind.toLowerCase()}`,
    strategyKind,
    identity: baseIdentity,
    publications: [{
      publicationId: `fake-${kind.toLowerCase()}-publication`,
      observations: kind === 'EMPTY' ? [] : withDuplicates,
      analyzedThroughPerformanceMs: completionTimeMs(scenario),
      availabilityTimeMs: kind === 'DELAYED_ACCURATE' ? completionTimeMs(scenario) + 1_000 : completionTimeMs(scenario),
      diagnostics: { strategyShape: strategyKind },
    }],
  };
}

export function buildBakeoffReport(input: {
  scenarios: readonly BenchmarkScenario[];
  candidates: readonly CandidateRun[];
  gitHead: string;
  command: string;
  policyPath: string;
  policyHash: string;
  dirtyTree: boolean;
}): {
  schemaVersion: 1;
  generatedAt: string;
  gitHead: string;
  command: string;
  dirtyTree: boolean;
  policy: { path: string; sha256: string };
  scenarioCount: number;
  candidateCount: number;
  splitLeakage: readonly string[];
  resultSummary: Record<string, { comparativeRank: number | null; absoluteGateStatus: MetricStatus }>;
  scores: readonly BakeoffScore[];
} {
  const splitLeakage = detectSplitLeakage(input.scenarios);
  const scores = input.scenarios.flatMap((scenario) => input.candidates.map((candidate) => scoreCandidate(scenario, candidate)));
  const byCandidate = new Map<string, BakeoffScore[]>();
  for (const score of scores) {
    byCandidate.set(score.candidateId, [...(byCandidate.get(score.candidateId) ?? []), score]);
  }
  const recallByCandidate = [...byCandidate.entries()].map(([candidateId, candidateScores]) => {
    const recallValues = candidateScores
      .map((score) => score.metrics.expectedStrikeRecall)
      .filter((metric): metric is Extract<MetricNumber, { status: 'PASS' | 'FAIL' }> => metric.status === 'PASS' || metric.status === 'FAIL');
    return {
      candidateId,
      recall: recallValues.length === 0
        ? null
        : recallValues.reduce((sum, metric) => sum + metric.value, 0) / recallValues.length,
      hasMissingEvidence: candidateScores.some((score) => score.groundTruthStatus !== 'PASS'),
    };
  }).sort((left, right) => (right.recall ?? -1) - (left.recall ?? -1) || left.candidateId.localeCompare(right.candidateId));
  const resultSummary: Record<string, { comparativeRank: number | null; absoluteGateStatus: MetricStatus }> = {};
  recallByCandidate.forEach((candidate, index) => {
    resultSummary[candidate.candidateId] = {
      comparativeRank: candidate.recall === null ? null : index + 1,
      absoluteGateStatus: candidate.hasMissingEvidence ? 'INSUFFICIENT_DATA' : 'NOT_EVALUATED',
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    gitHead: input.gitHead,
    command: input.command,
    dirtyTree: input.dirtyTree,
    policy: { path: input.policyPath, sha256: input.policyHash },
    scenarioCount: input.scenarios.length,
    candidateCount: input.candidates.length,
    splitLeakage,
    resultSummary,
    scores,
  };
}

function validateCandidateRun(candidate: CandidateRun): void {
  if (!candidate.candidateId || !['CHUNKED', 'STREAMING'].includes(candidate.strategyKind)) {
    throw new Error('Candidate run requires candidateId and strategyKind.');
  }
  const seenPublications = new Set<string>();
  for (const publication of candidate.publications) {
    if (seenPublications.has(publication.publicationId)) {
      throw new Error(`Duplicate candidate publicationId: ${publication.publicationId}`);
    }
    seenPublications.add(publication.publicationId);
    if (!Number.isFinite(publication.analyzedThroughPerformanceMs) || publication.analyzedThroughPerformanceMs < 0) {
      throw new Error('Candidate publication requires finite non-negative coverage.');
    }
  }
}

function runFinalization(
  scenario: BenchmarkScenario,
  publications: readonly CandidatePublication[],
  sourceId: string
): CompletedContinuousEvaluation {
  const session = new ContinuousEvaluationSession({
    artifact: artifactFromScenario(scenario),
    timeline: identityTimeline(),
    scope: { kind: 'FULL' },
  });
  const sorted = publications.slice().sort((left, right) =>
    left.analyzedThroughPerformanceMs - right.analyzedThroughPerformanceMs
      || left.publicationId.localeCompare(right.publicationId)
  );
  for (const publication of sorted) {
    session.publishObservations(
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
  session.complete({
    reason: scenario.completion?.kind === 'MANUAL' ? 'STOPPED_BY_USER' : 'SCOPE_COMPLETED',
    performanceTimeMs: completionTimeMs(scenario),
    terminalPerformanceMs: completionTimeMs(scenario),
  });
  if (sorted.at(-1)?.analyzedThroughPerformanceMs !== completionTimeMs(scenario)) {
    session.advanceAnalysisThrough(completionTimeMs(scenario));
  }
  return session.completedEvaluation();
}

function finalizedFeedbackAges(
  scenario: BenchmarkScenario,
  publications: readonly CandidatePublication[],
  sourceId: string
): number[] {
  const session = new ContinuousEvaluationSession({
    artifact: artifactFromScenario(scenario),
    timeline: identityTimeline(),
    scope: { kind: 'FULL' },
  });
  const finalized = new Set<string>();
  const ages: number[] = [];
  const sorted = publications.slice().sort((left, right) =>
    (left.availabilityTimeMs ?? left.analyzedThroughPerformanceMs)
      - (right.availabilityTimeMs ?? right.analyzedThroughPerformanceMs)
      || left.publicationId.localeCompare(right.publicationId)
  );
  for (const publication of sorted) {
    session.publishObservations(
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
    for (const strike of session.snapshot().strikes) {
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
  finalizationAges: readonly number[]
): BakeoffScore['metrics'] {
  if (groundTruth.status !== 'COMPLETE' || candidate.status !== 'COMPLETE') {
    return notEvaluatedMetrics('finalization did not complete');
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
  const groupMetrics = groupCompleteness(scenario, groundTruth, candidate);
  const extraPrecision = extraMetric(groundTruth, candidate);
  return {
    expectedStrikeRecall: ratioMetric(candidateTrueMatched.length, gtMatched.length),
    falseMatchRateOnGroundTruthMissing: ratioMetric(falseMatches.length, gtMissing.length, true),
    correctMissingRate: ratioMetric(correctMissing.length, gtMissing.length),
    verdictAgreementRate: ratioMetric(verdictAgreement.length, groundTruth.strikes.length),
    timingAbsoluteMedianMs: distributionMetric(timingErrors.map(Math.abs), 'median'),
    timingAbsoluteP95Ms: distributionMetric(timingErrors.map(Math.abs), 'p95'),
    groupExactCompletenessRate: ratioMetric(groupMetrics.exactComplete, groupMetrics.totalCompleteGroups),
    falseCompleteChordAcceptanceRate: ratioMetric(groupMetrics.falseComplete, groupMetrics.groundTruthIncompleteGroups, true),
    extraPrecision,
    finalizedFeedbackAgeP50Ms: distributionMetric(finalizationAges, 'median'),
    finalizedFeedbackAgeP95Ms: distributionMetric(finalizationAges, 'p95'),
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
      expectedStrikeRecall: notEvaluated('physical ground truth is not recorded'),
      falseMatchRateOnGroundTruthMissing: notEvaluated('physical ground truth is not recorded'),
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
      falseMatchRateOnGroundTruthMissing: ratioMetric(falseMatches.length, gtMissing.length, true),
    }];
  }));
}

function groupCompleteness(
  scenario: BenchmarkScenario,
  groundTruth: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>,
  candidate: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>
): { exactComplete: number; totalCompleteGroups: number; falseComplete: number; groundTruthIncompleteGroups: number } {
  const groups = new Set(scenario.expectedStrikes.map((strike) => strike.groupId));
  let exactComplete = 0;
  let totalCompleteGroups = 0;
  let falseComplete = 0;
  let groundTruthIncompleteGroups = 0;
  for (const groupId of groups) {
    const gtGroup = groundTruth.strikes.filter((strike) => strike.expectedGroupId === groupId);
    const candidateGroup = candidate.strikes.filter((strike) => strike.expectedGroupId === groupId);
    const gtComplete = gtGroup.every((strike) => strike.result === 'MATCHED');
    const candidateComplete = candidateGroup.every((strike) => strike.result === 'MATCHED');
    if (gtComplete) {
      totalCompleteGroups += 1;
      if (candidateComplete) exactComplete += 1;
    } else {
      groundTruthIncompleteGroups += 1;
      if (candidateComplete) falseComplete += 1;
    }
  }
  return { exactComplete, totalCompleteGroups, falseComplete, groundTruthIncompleteGroups };
}

function extraMetric(
  groundTruth: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>,
  candidate: Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>
): MetricNumber {
  if (groundTruth.extras.length === 0 && candidate.extras.length === 0) {
    return ratioMetric(0, 0);
  }
  const matchedCandidateExtras = oneToOneExtraMatches(groundTruth.extras, candidate.extras);
  return ratioMetric(matchedCandidateExtras, candidate.extras.length);
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

function ratioMetric(numerator: number, denominator: number, lowerIsBetter = false): MetricNumber {
  if (denominator === 0) {
    return notEvaluated('zero metric sample count');
  }
  const value = numerator / denominator;
  const pass = lowerIsBetter ? numerator === 0 : true;
  return { status: pass ? 'PASS' : 'FAIL', sampleCount: denominator, value };
}

function distributionMetric(values: readonly number[], kind: 'median' | 'p95'): MetricNumber {
  if (values.length === 0) {
    return notEvaluated('zero metric sample count');
  }
  const sorted = values.slice().sort((left, right) => left - right);
  return {
    status: 'PASS',
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
    groupExactCompletenessRate: notEvaluated(reason),
    falseCompleteChordAcceptanceRate: notEvaluated(reason),
    extraPrecision: notEvaluated(reason),
    finalizedFeedbackAgeP50Ms: notEvaluated(reason),
    finalizedFeedbackAgeP95Ms: notEvaluated(reason),
  };
}

function completionTimeMs(scenario: BenchmarkScenario): number {
  return scenario.completion?.performanceTimeMs
    ?? Math.max(...scenario.expectedStrikes.map((strike) => strike.expectedPerformanceTimeMs)) + DEFAULT_ASSIGNMENT_WINDOW_MS;
}

function artifactFromScenario(scenario: BenchmarkScenario): PracticeScoreArtifact {
  const groups = [...new Set(scenario.expectedStrikes.map((strike) => strike.groupId))]
    .map((groupId) => {
      const strikes = scenario.expectedStrikes.filter((strike) => strike.groupId === groupId);
      const onsetBeat = Math.min(...strikes.map((strike) => strike.expectedPerformanceTimeMs));
      const renderNoteIds = strikes.flatMap((strike) => strike.renderNoteIds);
      return {
        groupId,
        onsetBeat,
        canonicalEndBeat: onsetBeat,
        pitches: strikes.map((strike) => strike.pitch),
        renderNoteIds,
        eventIds: strikes.map((strike) => `event:${strike.strikeId}`),
        measureNumbers: ['1'],
        staffIds: ['1'],
        voiceIds: ['1'],
        expectedNotes: strikes.map((strike) => ({
          eventId: `event:${strike.strikeId}`,
          expectedNoteId: `note:${strike.strikeId}`,
          measureNumbers: ['1'],
          pitch: strike.pitch,
          renderNoteId: strike.renderNoteIds[0] ?? strike.strikeId,
        })),
        strikeTargets: strikes.map((strike) => ({
          strikeId: strike.strikeId,
          pitch: strike.pitch,
          renderNoteIds: [...strike.renderNoteIds],
          eventIds: [`event:${strike.strikeId}`],
          measureNumbers: ['1'],
          expectedNotes: [{
            eventId: `event:${strike.strikeId}`,
            expectedNoteId: `note:${strike.strikeId}`,
            measureNumbers: ['1'],
            pitch: strike.pitch,
            renderNoteId: strike.renderNoteIds[0] ?? strike.strikeId,
          }],
        })),
      };
    })
    .sort((left, right) => left.onsetBeat - right.onsetBeat || left.groupId.localeCompare(right.groupId));
  return {
    schemaVersion: 1,
    scoreId: `benchmark:${scenario.scenarioId}`,
    revisionId: 'phase9d',
    artifactId: `artifact:${scenario.scenarioId}`,
    scoreTempoSegments: [{ startBeat: 0, bpm: 60, source: 'BENCHMARK' }],
    meterSegments: [{ startBeat: 0, numerator: 4, denominator: 4, measureDurationBeats: 4, countInPulses: 4, source: 'BENCHMARK' }],
    practiceAttackSteps: groups.map((group) => ({
      stepId: `step:${group.groupId}`,
      groupId: group.groupId,
      onsetBeat: group.onsetBeat,
      attackTargets: group.strikeTargets.map((target) => ({
        pitch: target.pitch,
        renderNoteIds: target.renderNoteIds,
      })),
      continuation: [],
    })),
    expectedPracticeGroups: groups,
    scoreEndBeat: completionTimeMs(scenario),
  } as unknown as PracticeScoreArtifact;
}

function identityTimeline(): { beatToTimeMs(beat: number): number } {
  return { beatToTimeMs: (beat: number) => beat };
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
