#!/usr/bin/env node
/**
 * Stage B: Product Benchmark Scoring and Symmetric Safety Comparison.
 *
 * Reads write-once Stage A evidence, verifies candidate-run digests, scores via
 * the shared ContinuousFinalizationLedger bake-off scorer, constructs exact
 * scenario-level paired metric vectors, and evaluates all three candidate pairs.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ACTIVE_CANDIDATE_IDS, CANDIDATE_CONFIGS } from './candidate-adapters.mjs';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const bakeoffModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'));
const qualModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));

export function getCandidateDefinition(candidateId) {
  const cfg = CANDIDATE_CONFIGS[candidateId];
  if (!cfg) throw new Error(`UNKNOWN_CANDIDATE_ID:${candidateId}`);
  return {
    candidateId: cfg.candidateId,
    strategyKind: cfg.strategyKind,
    identity: {
      modelRuntime: `${cfg.family} frozen product benchmark adapter`,
      adapterVersion: 'phase9gb3-fix-v1',
      configurationSha256: cfg.identity.configurationSha256,
      trainingDataOverlapStatus: cfg.identity.trainingDataOverlapStatus,
      modelCheckpointSha256: cfg.checkpoint.sha256,
    },
  };
}

export function createSeededRandom(seed = 13371) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeBootstrapConfidenceInterval(diffs, draws = 5000, seed = 13371) {
  if (!diffs || diffs.length === 0) return { mean: 0, low: 0, high: 0, sampleCount: 0, draws, seed };
  const rng = createSeededRandom(seed);
  const n = diffs.length;
  const drawMeans = new Float64Array(draws);
  for (let d = 0; d < draws; d += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += diffs[Math.floor(rng() * n)];
    drawMeans[d] = sum / n;
  }
  drawMeans.sort();
  return {
    mean: diffs.reduce((a, b) => a + b, 0) / n,
    low: drawMeans[Math.floor(draws * 0.025)],
    high: drawMeans[Math.floor(draws * 0.975)],
    sampleCount: n,
    draws,
    seed,
  };
}

const METRIC_KEYS = [
  'falseMatchRateOnGroundTruthMissing',
  'falseCompleteChordAcceptanceRate',
  'wrongNoteFalseCorrectRate',
  'verdictAgreementRate',
  'correctMissingRate',
  'wrongNoteDetectionRate',
  'chordExactCompletenessRate',
  'expectedStrikeRecall',
  'extraPrecision',
  'extraRecall',
  'timingAbsoluteMedianMs',
  'timingAbsoluteP95Ms',
  'finalizedFeedbackAgeP95Ms',
];

export async function scoreAndCompareBenchmark({
  runDir,
  truthScenariosPath,
  truthScenariosObject,
  candidateIds = ACTIVE_CANDIDATE_IDS,
  bootstrapDraws = 5000,
  bootstrapSeed = 13371,
  expectedExecutionMode,
}) {
  const coveragePath = path.resolve(runDir, 'coverage.json');
  if (!existsSync(coveragePath)) {
    throw new Error(`STAGE_B_ERROR: Missing coverage.json in ${runDir}. Stage A inference must run first.`);
  }

  const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));
  const scenarios = Array.isArray(truthScenariosObject)
    ? truthScenariosObject
    : truthScenariosObject?.scenarios ?? JSON.parse(await readFile(truthScenariosPath, 'utf8')).scenarios;

  const evidenceDir = path.resolve(runDir, 'evidence');
  const candidateScores = {};
  const perScenarioScoresByCandidate = {};
  const candidateDefinitions = Object.fromEntries(candidateIds.map((id) => [id, getCandidateDefinition(id)]));

  let coverageIncomplete = false;
  const missingEvidence = [];
  for (const candidateId of candidateIds) {
    perScenarioScoresByCandidate[candidateId] = new Map();
    const scenarioScores = [];
    for (const scenario of scenarios) {
      if (scenario.candidateEligibility && scenario.candidateEligibility[candidateId] === false) continue;
      const evidenceFile = path.resolve(evidenceDir, `${candidateId}__${scenario.scenarioId}.json`);
      if (!existsSync(evidenceFile)) {
        coverageIncomplete = true;
        missingEvidence.push({ candidateId, scenarioId: scenario.scenarioId });
        continue;
      }
      const evidenceRecord = JSON.parse(await readFile(evidenceFile, 'utf8'));
      if (evidenceRecord.status !== 'SUCCESS' || !evidenceRecord.candidateRun) {
        coverageIncomplete = true;
        missingEvidence.push({ candidateId, scenarioId: scenario.scenarioId, status: evidenceRecord.status });
        continue;
      }
      verifyEvidenceRecord(evidenceRecord, scenario, candidateId, expectedExecutionMode);
      const score = bakeoffModule.scoreCandidate(scenario, candidateDefinitions[candidateId], evidenceRecord.candidateRun);
      scenarioScores.push(score);
      perScenarioScoresByCandidate[candidateId].set(scenario.scenarioId, score);
    }
    candidateScores[candidateId] = bakeoffModule.aggregateCandidateMetricsForResearch(scenarioScores);
    candidateScores[candidateId].diagnostics = {
      ...(candidateScores[candidateId].diagnostics ?? {}),
      feedbackAgeInBeats: beatNormalizedFeedbackDiagnostics(scenarios, scenarioScores),
      absoluteProductLatencyGate: 'ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED',
    };
  }

  if (coverageIncomplete || missingEvidence.length > 0) {
    const analysis = {
      schemaVersion: 2,
      artifact: 'product_benchmark_analysis',
      phase: '9G-B.3-FIX',
      evaluationStatus: 'EVALUATION_INCOMPLETE_NO_WINNER',
      winner: null,
      rationale: `Evidence coverage incomplete; missing ${missingEvidence.length} candidate-scenario runs`,
      missingEvidence,
      candidateScores,
      absoluteProductLatencyGate: 'ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED',
      provenance: await benchmarkProvenance(),
    };
    await writeFile(path.resolve(runDir, 'analysis.json'), JSON.stringify(analysis, null, 2), 'utf8');
    return analysis;
  }

  const pairwiseComparisons = {};
  for (let i = 0; i < candidateIds.length; i += 1) {
    for (let j = i + 1; j < candidateIds.length; j += 1) {
      const candidateA = candidateIds[i];
      const candidateB = candidateIds[j];
      const comparison = comparePair({
        candidateA,
        candidateB,
        scoresA: perScenarioScoresByCandidate[candidateA],
        scoresB: perScenarioScoresByCandidate[candidateB],
        candidateAEligibleCount: perScenarioScoresByCandidate[candidateA].size,
        candidateBEligibleCount: perScenarioScoresByCandidate[candidateB].size,
        bootstrapDraws,
        bootstrapSeed,
      });
      pairwiseComparisons[`${candidateA}_vs_${candidateB}`] = comparison;
    }
  }

  const { benchmarkOutcome, winner, rationale } = chooseThreeCandidateWinner(candidateIds, pairwiseComparisons);
  const analysis = {
    schemaVersion: 2,
    artifact: 'product_benchmark_analysis',
    phase: '9G-B.3-FIX',
    evaluationStatus: 'EVALUATION_COMPLETED',
    benchmarkOutcome,
    winner,
    rationale,
    absoluteProductLatencyGate: 'ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED',
    evaluatedCandidateCount: candidateIds.length,
    candidateScores,
    pairwiseComparisons,
    provenance: await benchmarkProvenance(),
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.resolve(runDir, 'analysis.json'), JSON.stringify(analysis, null, 2), 'utf8');
  return analysis;
}

function verifyEvidenceRecord(record, scenario, candidateId, expectedExecutionMode) {
  const cfg = CANDIDATE_CONFIGS[candidateId];
  if (record.candidateId !== candidateId || record.scenarioId !== scenario.scenarioId) {
    throw new Error(`EVIDENCE_BINDING_MISMATCH:${candidateId}:${scenario.scenarioId}`);
  }
  if (record.configurationSha256 !== cfg.identity.configurationSha256) {
    throw new Error(`EVIDENCE_CONFIGURATION_SHA_MISMATCH:${candidateId}:${scenario.scenarioId}`);
  }
  if (record.checkpointSha256 !== cfg.checkpoint.sha256) {
    throw new Error(`EVIDENCE_CHECKPOINT_SHA_MISMATCH:${candidateId}:${scenario.scenarioId}`);
  }
  if (expectedExecutionMode && record.executionMode !== expectedExecutionMode) {
    throw new Error(`EVIDENCE_EXECUTION_MODE_MISMATCH:${candidateId}:${scenario.scenarioId}:expected ${expectedExecutionMode}, got ${record.executionMode}`);
  }
  const scenarioAudioSha = scenario.audio?.sourceAudioSha256 ?? scenario.source?.sourceAudioSha256;
  if (record.sourceAudioSha256 !== scenarioAudioSha) {
    throw new Error(`EVIDENCE_SOURCE_AUDIO_SHA_MISMATCH:${candidateId}:${scenario.scenarioId}`);
  }
  const digest = createHash('sha256').update(JSON.stringify(record.candidateRun), 'utf8').digest('hex');
  if (digest !== record.evidenceSha256 || digest !== record.candidateRunDigestSha256) {
    throw new Error(`EVIDENCE_CANDIDATE_RUN_DIGEST_MISMATCH:${candidateId}:${scenario.scenarioId}`);
  }
}

async function benchmarkProvenance() {
  return {
    gitHead: gitHead(),
    benchmarkConfigSha256: CANDIDATE_CONFIGS[ACTIVE_CANDIDATE_IDS[0]]?.identity?.benchmarkConfigSha256,
    candidateRegistrySha256: CANDIDATE_CONFIGS[ACTIVE_CANDIDATE_IDS[0]]?.identity?.registrySha256,
    candidateAdapterSha256: await fileSha256('backend/research/product_benchmark/candidate-adapters.mjs'),
    scorerSha256: await fileSha256('apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'),
    rawInferenceScriptSha256ByCandidate: Object.fromEntries(ACTIVE_CANDIDATE_IDS.map((candidateId) => [
      candidateId,
      fileSha256Sync(CANDIDATE_CONFIGS[candidateId].dockerScript),
    ])),
  };
}

function comparePair({ candidateA, candidateB, scoresA, scoresB, candidateAEligibleCount, candidateBEligibleCount, bootstrapDraws, bootstrapSeed }) {
  const commonScenarioIds = [...scoresA.keys()].filter((id) => scoresB.has(id)).sort();
  const diffVectorsByMetric = Object.fromEntries(METRIC_KEYS.map((key) => [key, []]));
  const pairedMeasuredCounts = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0]));
  for (const scenarioId of commonScenarioIds) {
    const scoreA = scoresA.get(scenarioId);
    const scoreB = scoresB.get(scenarioId);
    for (const metricKey of METRIC_KEYS) {
      const valueA = metricValue(scoreA.metrics[metricKey]);
      const valueB = metricValue(scoreB.metrics[metricKey]);
      if (valueA !== undefined && valueB !== undefined) {
        diffVectorsByMetric[metricKey].push(valueA - valueB);
        pairedMeasuredCounts[metricKey] += 1;
      }
    }
  }
  const ciComputer = (diffs) => computeBootstrapConfidenceInterval(diffs, bootstrapDraws, bootstrapSeed);
  const decision = qualModule.evaluateSymmetricSafetyDominance(diffVectorsByMetric, ciComputer, { minimumPairedScenarios: 8 });
  return {
    candidateA,
    candidateB,
    candidateAEligibleCount,
    candidateBEligibleCount,
    mutuallyEligibleScenarioCount: commonScenarioIds.length,
    pairedMeasuredCounts,
    bootstrapSeed,
    bootstrapDraws,
    decision,
  };
}

function metricValue(metric) {
  if (!metric || metric.status !== 'MEASURED' || !Number.isFinite(metric.value)) return undefined;
  return metric.value;
}

function chooseThreeCandidateWinner(candidateIds, pairwiseComparisons) {
  const wins = new Map(candidateIds.map((id) => [id, 0]));
  for (const comparison of Object.values(pairwiseComparisons)) {
    if (comparison.decision.outcome === 'INSUFFICIENT_SAFETY_EVIDENCE') {
      return { benchmarkOutcome: 'INSUFFICIENT_SAFETY_EVIDENCE', winner: null, rationale: 'At least one required candidate pair has insufficient critical safety evidence.' };
    }
    if (comparison.decision.outcome === 'STATISTICAL_TIE') {
      return { benchmarkOutcome: 'STATISTICAL_TIE', winner: null, rationale: 'At least one candidate pair remains statistically tied.' };
    }
    if (comparison.decision.outcome === 'CANDIDATE_A_DOMINATES') wins.set(comparison.candidateA, wins.get(comparison.candidateA) + 1);
    if (comparison.decision.outcome === 'CANDIDATE_B_DOMINATES') wins.set(comparison.candidateB, wins.get(comparison.candidateB) + 1);
  }
  const decisive = [...wins.entries()].filter(([, count]) => count === candidateIds.length - 1);
  if (decisive.length === 1) {
    return { benchmarkOutcome: 'DECISIVE_WINNER', winner: decisive[0][0], rationale: 'Candidate dominates every other eligible ranked candidate under the frozen safety hierarchy.' };
  }
  return { benchmarkOutcome: 'NO_WINNER_PAIRWISE_CYCLE_OR_INCOMPLETE_DOMINANCE', winner: null, rationale: 'No candidate dominates every other candidate; cycle or incomplete dominance.' };
}

function beatNormalizedFeedbackDiagnostics(scenarios, scores) {
  const scenarioById = new Map(scenarios.map((s) => [s.scenarioId, s]));
  const beatSamples = [];
  for (const score of scores) {
    const scenario = scenarioById.get(score.scenarioId);
    const bpm = scenario?.fixedBpm;
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    const beatMs = 60000 / bpm;
    for (const ageMs of score.metricSamples?.finalizedFeedbackAgesMs ?? []) {
      if (Number.isFinite(ageMs)) beatSamples.push(ageMs / beatMs);
    }
  }
  return {
    policy: 'PER_EVENT_FEEDBACK_AGE_MS_NORMALIZED_BY_SCENARIO_FIXED_BPM_THEN_POOLED',
    p50Beats: percentile(beatSamples, 0.5),
    p95Beats: percentile(beatSamples, 0.95),
    sampleCount: beatSamples.length,
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

function gitHead() {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : undefined;
}

async function fileSha256(relPath) {
  return createHash('sha256').update(await readFile(path.resolve(repoRoot, relPath))).digest('hex');
}

function fileSha256Sync(relPath) {
  return createHash('sha256').update(readFileSync(path.resolve(repoRoot, relPath))).digest('hex');
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const args = process.argv.slice(2);
  const runDirIdx = args.indexOf('--run-dir');
  const truthIdx = args.indexOf('--truth-scenarios');
  if (runDirIdx === -1 || truthIdx === -1) {
    console.error('Usage: node score-and-compare.mjs --run-dir <dir> --truth-scenarios <path>');
    process.exit(1);
  }
  scoreAndCompareBenchmark({ runDir: args[runDirIdx + 1], truthScenariosPath: args[truthIdx + 1] })
    .then((res) => console.log(`Stage B complete. Outcome: ${res.benchmarkOutcome}, Winner: ${res.winner}`))
    .catch((err) => {
      console.error('Stage B failed:', err);
      process.exit(1);
    });
}
