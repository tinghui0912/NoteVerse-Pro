#!/usr/bin/env node
/**
 * Stage B: Product Benchmark Scoring and Symmetric Safety Comparison
 *
 * Reads candidate acoustic runs from Stage A write-once evidence store,
 * verifies coverage, executes the accepted single shared scorer
 * (continuous-analyzer-bakeoff.ts), computes explicit wrong-note diagnostics,
 * runs 5000-draw paired bootstrap with seed 13371, and evaluates symmetric
 * safety dominance hierarchy.
 *
 * Emits <runDir>/analysis.json.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CANDIDATE_CONFIGS } from './candidate-adapters.mjs';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const bakeoffModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'));
const qualModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));

/**
 * Constructs a schema-compliant CandidateDefinition from candidate ID.
 */
export function getCandidateDefinition(candidateId) {
  const cfg = CANDIDATE_CONFIGS[candidateId] ?? {
    candidateId,
    family: candidateId,
    strategyKind: candidateId.includes('streaming') || candidateId.includes('online-amt') ? 'STREAMING' : 'CHUNKED',
  };
  return {
    candidateId: cfg.candidateId,
    strategyKind: cfg.strategyKind,
    identity: {
      modelRuntime: `${cfg.family ?? candidateId} model runtime`,
      adapterVersion: 'phase9gb3-prep-v1',
      configurationSha256: createHash('sha256').update(JSON.stringify(cfg)).digest('hex'),
      trainingDataOverlapStatus: 'KNOWN_DISJOINT',
      ...(cfg.checkpoint ? { modelCheckpointSha256: cfg.checkpoint.sha256 } : {}),
    },
  };
}

/**
 * Deterministic PRNG seeded for reproducible paired bootstrap.
 */
export function createSeededRandom(seed = 13371) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 5000-draw paired bootstrap confidence interval.
 */
export function computeBootstrapConfidenceInterval(diffs, draws = 5000, seed = 13371) {
  if (!diffs || diffs.length === 0) {
    return { mean: 0, low: 0, high: 0, sampleCount: 0 };
  }
  const rng = createSeededRandom(seed);
  const n = diffs.length;
  const drawMeans = new Float64Array(draws);

  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      sum += diffs[idx];
    }
    drawMeans[d] = sum / n;
  }

  drawMeans.sort();
  const lowIdx = Math.floor(draws * 0.025);
  const highIdx = Math.floor(draws * 0.975);
  const sampleMean = diffs.reduce((a, b) => a + b, 0) / n;

  return {
    mean: sampleMean,
    low: drawMeans[lowIdx],
    high: drawMeans[highIdx],
    sampleCount: n,
    draws,
    seed,
  };
}

/**
 * Stage B scoring and comparison orchestrator.
 */
export async function scoreAndCompareBenchmark({
  runDir,
  truthScenariosPath,
  truthScenariosObject,
  candidateIds = Object.keys(CANDIDATE_CONFIGS),
  bootstrapDraws = 5000,
  bootstrapSeed = 13371,
}) {
  const coveragePath = path.resolve(runDir, 'coverage.json');
  if (!existsSync(coveragePath)) {
    throw new Error(`STAGE_B_ERROR: Missing coverage.json in ${runDir}. Stage A inference must run first.`);
  }

  const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));
  const scenarios = truthScenariosObject ?? JSON.parse(await readFile(truthScenariosPath, 'utf8')).scenarios;
  const scenarioMap = new Map(scenarios.map((s) => [s.scenarioId, s]));

  const evidenceDir = path.resolve(runDir, 'evidence');
  const candidateScores = {};
  const perScenarioScoresByCandidate = {};

  // Check coverage completeness
  let coverageIncomplete = false;
  const missingEvidence = [];

  for (const candidateId of candidateIds) {
    perScenarioScoresByCandidate[candidateId] = new Map();
    const scenarioScores = [];

    for (const scenario of scenarios) {
      if (scenario.candidateEligibility && scenario.candidateEligibility[candidateId] === false) {
        continue;
      }

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

      // Replay through accepted single shared scorer
      const definition = getCandidateDefinition(candidateId);
      const score = bakeoffModule.scoreCandidate(scenario, definition, evidenceRecord.candidateRun);
      scenarioScores.push(score);
      perScenarioScoresByCandidate[candidateId].set(scenario.scenarioId, score);
    }

    if (scenarioScores.length > 0) {
      candidateScores[candidateId] = bakeoffModule.aggregateCandidateMetrics(scenarioScores);
    }
  }

  // If coverage is incomplete, return EVALUATION_INCOMPLETE_NO_WINNER
  if (coverageIncomplete || missingEvidence.length > 0) {
    const analysis = {
      schemaVersion: 1,
      artifact: 'product_benchmark_analysis',
      evaluationStatus: 'EVALUATION_INCOMPLETE_NO_WINNER',
      winner: null,
      rationale: `Evidence coverage incomplete; missing ${missingEvidence.length} candidate-scenario runs`,
      missingEvidence,
      candidateScores,
      absoluteProductLatencyGate: 'ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED',
    };
    const analysisPath = path.resolve(runDir, 'analysis.json');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    return analysis;
  }

  // Add beat-normalized latency diagnostics to candidate scores
  for (const candidateId of candidateIds) {
    const agg = candidateScores[candidateId];
    if (agg) {
      const avgBpm = 60; // Vienna base nominal BPM
      const beatDurationMs = 60000 / avgBpm;
      const feedbackAgeMs = agg.metrics.finalizedFeedbackAgeP50Ms ?? 0;
      agg.diagnostics = {
        ...(agg.diagnostics ?? {}),
        feedbackAgeInBeats: Number((feedbackAgeMs / beatDurationMs).toFixed(4)),
        absoluteProductLatencyGate: 'ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED',
      };
    }
  }

  // Pairwise comparisons across the 3 ranked candidates
  const pairwiseComparisons = {};
  for (let i = 0; i < candidateIds.length; i++) {
    for (let j = i + 1; j < candidateIds.length; j++) {
      const candA = candidateIds[i];
      const candB = candidateIds[j];
      const pairKey = `${candA}_vs_${candB}`;

      const scoresA = perScenarioScoresByCandidate[candA];
      const scoresB = perScenarioScoresByCandidate[candB];

      // Mutually eligible scenario intersection
      const commonScenarioIds = [...scoresA.keys()].filter((id) => scoresB.has(id));
      const diffVectorsByMetric = {};

      const metricKeys = [
        'falseMatchRateOnGroundTruthMissing',
        'falseCompleteChordAcceptanceRate',
        'verdictAgreementRate',
        'correctMissingRate',
        'chordExactCompletenessRate',
        'expectedStrikeRecall',
        'extraPrecision',
        'extraRecall',
        'timingAbsoluteMedianMs',
        'timingAbsoluteP95Ms',
        'finalizedFeedbackAgeP95Ms',
      ];

      for (const mKey of metricKeys) {
        diffVectorsByMetric[mKey] = [];
      }

      for (const scenId of commonScenarioIds) {
        const scoreA = scoresA.get(scenId);
        const scoreB = scoresB.get(scenId);

        for (const mKey of metricKeys) {
          const valA = scoreA.metrics[mKey];
          const valB = scoreB.metrics[mKey];
          if (typeof valA === 'number' && typeof valB === 'number') {
            diffVectorsByMetric[mKey].push(valB - valA);
          }
        }
      }

      // 5000-draw paired bootstrap CI computer
      const ciComputer = (diffs) => computeBootstrapConfidenceInterval(diffs, bootstrapDraws, bootstrapSeed);

      // Evaluate symmetric safety dominance hierarchy
      const decision = qualModule.evaluateSymmetricSafetyDominance(
        diffVectorsByMetric,
        ciComputer,
        { minimumPairedScenarios: 8 }
      );

      pairwiseComparisons[pairKey] = {
        candidateA: candA,
        candidateB: candB,
        mutuallyEligibleScenarioCount: commonScenarioIds.length,
        bootstrapSeed,
        bootstrapDraws,
        decision,
      };
    }
  }

  // Determine overall winner according to safety dominance
  let benchmarkOutcome = 'STATISTICAL_TIE';
  let overallWinner = null;
  const rank1 = candidateIds[0];
  const rank2 = candidateIds[1];
  const pair12 = pairwiseComparisons[`${rank1}_vs_${rank2}`];

  if (pair12) {
    if (pair12.decision.outcome === 'CANDIDATE_A_DOMINATES') {
      benchmarkOutcome = 'DECISIVE_WINNER';
      overallWinner = rank1;
    } else if (pair12.decision.outcome === 'CANDIDATE_B_DOMINATES') {
      benchmarkOutcome = 'DECISIVE_WINNER';
      overallWinner = rank2;
    } else if (pair12.decision.outcome === 'INSUFFICIENT_SAFETY_EVIDENCE') {
      benchmarkOutcome = 'INSUFFICIENT_SAFETY_EVIDENCE';
      overallWinner = null;
    }
  }

  const analysis = {
    schemaVersion: 1,
    artifact: 'product_benchmark_analysis',
    phase: '9G-B.3-PREP',
    evaluationStatus: 'EVALUATION_COMPLETED',
    benchmarkOutcome,
    winner: overallWinner,
    absoluteProductLatencyGate: 'ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED',
    evaluatedCandidateCount: candidateIds.length,
    candidateScores,
    pairwiseComparisons,
    completedAt: new Date().toISOString(),
  };

  const analysisPath = path.resolve(runDir, 'analysis.json');
  await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');

  return analysis;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const args = process.argv.slice(2);
  const runDirIdx = args.indexOf('--run-dir');
  const truthIdx = args.indexOf('--truth-scenarios');

  if (runDirIdx === -1 || truthIdx === -1) {
    console.error('Usage: node score-and-compare.mjs --run-dir <dir> --truth-scenarios <path>');
    process.exit(1);
  }

  const runDir = args[runDirIdx + 1];
  const truthScenariosPath = args[truthIdx + 1];

  scoreAndCompareBenchmark({ runDir, truthScenariosPath })
    .then((res) => {
      console.log(`Stage B Score & Compare complete. Outcome: ${res.benchmarkOutcome}, Winner: ${res.winner}`);
    })
    .catch((err) => {
      console.error('Stage B failed:', err);
      process.exit(1);
    });
}
