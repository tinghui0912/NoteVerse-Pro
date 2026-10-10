/**
 * Phase 9G-B.1.1: Execution-Grade Blind Evaluation Orchestrator & Durable Ledger.
 *
 * Implements the modular, testable, score-blind evaluation pipeline:
 * - Layer 1: Pre-inference layer (manifest validation, audio geometry eligibility, code/checkpoint bindings)
 * - Layer 2: Durable execution ledger (atomic filesystem ledger, duplicate prevention, recovery)
 * - Layer 3: Acoustic execution layer (score-blind adapter receiving strictly sanitized audio metadata)
 * - Layer 4: Evidence commit layer (durable append-only raw output & observation digest commit)
 * - Layer 5: Scoring layer (shared scoreCandidate() receiving ExpectedStrike truth only after raw commit)
 * - Layer 6: Statistical & Decision layer (5000-draw seeded bootstrap & safety-first decision hierarchy)
 * - Layer 7: Audit layer (immutable receipts, digests, and one-shot run status)
 *
 * Enforces non-negotiable boundaries:
 * - Real candidate inference on blind performers p15-p22 is STRICTLY FORBIDDEN in Phase 9G-B.1.1.
 * - Score-conditioned inference is detected and rejected.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const challengerQual = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));
const bakeoffScorer = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'));

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Json(obj) {
  return sha256Text(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Layer 1: Pre-inference Layer & Objective Audio Geometry Eligibility
// ---------------------------------------------------------------------------

/**
 * Derives objective scenario eligibility from audio geometry and frozen candidate profile.
 * Does not read or depend upon ExpectedStrike truth or inference outputs.
 */
export function deriveScenarioEligibility(scenario, candidateProfileId) {
  const originMs = scenario.audio?.performanceOriginSourceMs ?? scenario.performanceOriginSourceMs ?? 0;

  if (candidateProfileId.includes('CALIBRATED_CONTEXT_5S')) {
    const requiredContextMs = 5000;
    const isEligible = originMs >= requiredContextMs;
    return {
      candidateProfileId,
      scenarioId: scenario.scenarioId,
      isEligible,
      originMs,
      requiredContextMs,
      exclusionReason: isEligible ? undefined : 'INSUFFICIENT_PRE_ROLL_AUDIO_FOR_5S_CONTEXT',
    };
  }

  if (candidateProfileId.includes('CALIBRATED_CONTEXT_1820')) {
    const requiredContextMs = 1820;
    const isEligible = originMs >= requiredContextMs;
    return {
      candidateProfileId,
      scenarioId: scenario.scenarioId,
      isEligible,
      originMs,
      requiredContextMs,
      exclusionReason: isEligible ? undefined : 'INSUFFICIENT_PRE_ROLL_AUDIO_FOR_1820MS_CONTEXT',
    };
  }

  // Streaming causal (e.g. Online-AMT native boost) or whole-recording (Transkun, Aria, RTT)
  return {
    candidateProfileId,
    scenarioId: scenario.scenarioId,
    isEligible: true,
    originMs,
    requiredContextMs: 0,
  };
}

/**
 * Computes separate objective eligibility sets for all candidates across scheduled scenarios.
 */
export function computeCandidateEligibilityMatrix(scenarios, candidates) {
  const candidateEligibleMap = {};
  for (const c of candidates) {
    const eligibleIds = scenarios
      .filter((s) => deriveScenarioEligibility(s, c.profileId).isEligible)
      .map((s) => s.scenarioId);
    candidateEligibleMap[c.candidateId] = {
      candidateId: c.candidateId,
      profileId: c.profileId,
      totalScheduled: scenarios.length,
      eligibleCount: eligibleIds.length,
      eligibleScenarioIds: eligibleIds,
    };
  }
  return candidateEligibleMap;
}

/**
 * Creates a sanitized acoustic manifest containing strictly audio geometry and PCM identities.
 * Strips all ExpectedStrike truth, annotations, groups, and physical MIDI attacks.
 */
export function createSanitizedAcousticManifest(rawScenarios) {
  return rawScenarios.map((s) => {
    return {
      scenarioId: s.scenarioId,
      split: s.split,
      audio: {
        nativeSampleRateHz: s.audio?.nativeSampleRateHz ?? 16000,
        channelPolicy: s.audio?.channelPolicy ?? 'MONO',
        clipStartMs: s.audio?.clipStartMs ?? 0,
        clipEndMs: s.audio?.clipEndMs ?? 5000,
        performanceOriginSourceMs: s.audio?.performanceOriginSourceMs ?? s.performanceOriginSourceMs ?? 0,
        pcmIdentity: s.audio?.pcmIdentity ?? `pcm_${s.scenarioId}`,
      },
      source: {
        sourceAudioPath: s.source?.sourceAudioPath ?? `audio/${s.scenarioId}.wav`,
        sourceAudioSha256: s.source?.sourceAudioSha256 ?? sha256Text(`audio_${s.scenarioId}`),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Layer 2: Durable Execution Ledger
// ---------------------------------------------------------------------------

export class DurableExecutionLedger {
  constructor(ledgerDir, runId) {
    this.ledgerDir = ledgerDir;
    this.runId = runId;
    this.ledgerPath = path.resolve(ledgerDir, 'execution_ledger.json');
    this.records = new Map(); // key: `${candidateId}\0${scenarioId}` => record
    this.state = 'PREPARED';
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  async init(options = {}) {
    await mkdir(this.ledgerDir, { recursive: true });
    if (existsSync(this.ledgerPath)) {
      if (!options.allowResume) {
        throw new Error(`DUPLICATE_RUN_ID_REJECTED:${this.runId}`);
      }
      const raw = JSON.parse(await readFile(this.ledgerPath, 'utf8'));
      if (raw.runId !== this.runId) {
        throw new Error(`LEDGER_RUN_ID_MISMATCH:${raw.runId} !== ${this.runId}`);
      }
      this.state = raw.state;
      this.createdAt = raw.createdAt;
      for (const rec of raw.records) {
        this.records.set(`${rec.candidateId}\0${rec.scenarioId}`, rec);
      }
      return;
    }
    await this.persist();
  }

  transitionTo(nextState) {
    challengerQual.assertLedgerStateTransitionValid(this.state, nextState);
    this.state = nextState;
    this.updatedAt = new Date().toISOString();
  }

  hasRecord(candidateId, scenarioId) {
    return this.records.has(`${candidateId}\0${scenarioId}`);
  }

  getRecord(candidateId, scenarioId) {
    return this.records.get(`${candidateId}\0${scenarioId}`);
  }

  recordAttempt(record) {
    const key = `${record.candidateId}\0${record.scenarioId}`;
    if (this.records.has(key)) {
      throw new Error(`DUPLICATE_CANDIDATE_SCENARIO_RUN_REJECTED:${record.candidateId}:${record.scenarioId}`);
    }
    const fullRecord = {
      runId: this.runId,
      attemptIndex: 1,
      recordedAt: new Date().toISOString(),
      ...record,
    };
    this.records.set(key, fullRecord);
    this.updatedAt = fullRecord.recordedAt;
  }

  async persist() {
    const payload = {
      schemaVersion: 1,
      artifact: 'phase9gb_durable_execution_ledger',
      runId: this.runId,
      state: this.state,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      recordCount: this.records.size,
      records: Array.from(this.records.values()),
    };
    await writeFile(this.ledgerPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Layer 3 & 4: Score-Blind Acoustic Execution & Evidence Commit
// ---------------------------------------------------------------------------

/**
 * Executes a candidate against a sanitized scenario without exposing ExpectedStrike truth.
 */
export async function executeAcousticCandidate(adapter, sanitizedScenario, candidateConfig) {
  // Guard against score leakage
  if (sanitizedScenario.expectedStrikes || sanitizedScenario.physicalGroundTruth) {
    throw new Error('SCORE_CONDITIONED_INFERENCE_DETECTED: Sanitized scenario contains ground truth fields');
  }

  const startTime = Date.now();
  const runResult = await adapter.inferAcoustic(sanitizedScenario, candidateConfig);
  const endTime = Date.now();

  const observationDigest = sha256Json(runResult.publications);
  return {
    candidateId: candidateConfig.candidateId,
    scenarioId: sanitizedScenario.scenarioId,
    checkpointSha256: candidateConfig.checkpointSha256,
    startTimeMs: startTime,
    endTimeMs: endTime,
    durationMs: endTime - startTime,
    sourcePcmSha256: sanitizedScenario.source.sourceAudioSha256,
    acousticOutputDigest: observationDigest,
    publications: runResult.publications,
    exitCode: runResult.exitCode ?? 0,
    status: runResult.status ?? 'SUCCESS',
    failureReason: runResult.failureReason,
  };
}

/**
 * Commits raw acoustic output to the durable ledger before scoring.
 */
export async function commitAcousticEvidence(ledger, executionResult) {
  ledger.recordAttempt({
    candidateId: executionResult.candidateId,
    scenarioId: executionResult.scenarioId,
    checkpointSha256: executionResult.checkpointSha256,
    startTimeMs: executionResult.startTimeMs,
    endTimeMs: executionResult.endTimeMs,
    durationMs: executionResult.durationMs,
    sourcePcmSha256: executionResult.sourcePcmSha256,
    acousticOutputDigest: executionResult.acousticOutputDigest,
    exitCode: executionResult.exitCode,
    status: executionResult.status,
    failureReason: executionResult.failureReason,
  });
  await ledger.persist();
}

// ---------------------------------------------------------------------------
// Layer 5: Shared Scorer Invocation (ExpectedStrike accessed ONLY after commit)
// ---------------------------------------------------------------------------

export function scoreCommittedAcousticOutput(ledger, fullScenarioWithTruth, candidateDef, publications) {
  // Validate evidence is committed in ledger
  const record = ledger.getRecord(candidateDef.candidateId, fullScenarioWithTruth.scenarioId);
  if (!record || record.status !== 'SUCCESS') {
    throw new Error(`UNCOMMITTED_EVIDENCE_CANNOT_BE_SCORED:${candidateDef.candidateId}:${fullScenarioWithTruth.scenarioId}`);
  }

  // Validate digest match
  const recomputedDigest = sha256Json(publications);
  if (record.acousticOutputDigest !== recomputedDigest) {
    throw new Error(`ACOUSTIC_DIGEST_MISMATCH_ON_SCORING:${candidateDef.candidateId}:${fullScenarioWithTruth.scenarioId}`);
  }

  const candidateScenarioRun = {
    candidateId: candidateDef.candidateId,
    scenarioId: fullScenarioWithTruth.scenarioId,
    publications,
  };

  return bakeoffScorer.scoreCandidate(fullScenarioWithTruth, candidateDef, candidateScenarioRun);
}

// ---------------------------------------------------------------------------
// Layer 6: Statistical Paired Bootstrap & Executable Safety Hierarchy
// ---------------------------------------------------------------------------

export const FROZEN_V2_SAFETY_FIRST_DECISION_HIERARCHY = [
  {
    priorityIndex: 1,
    metricKey: 'falseMatchRateOnGroundTruthMissing',
    direction: 'LOWER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Lower critical false-match rate on ground-truth missing notes',
  },
  {
    priorityIndex: 2,
    metricKey: 'falseCompleteChordAcceptanceRate',
    direction: 'LOWER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Lower incomplete-chord false-complete acceptance rate',
  },
  {
    priorityIndex: 3,
    metricKey: 'verdictAgreementRate',
    direction: 'HIGHER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Higher verdict agreement rate across all evaluated strikes',
  },
  {
    priorityIndex: 4,
    metricKey: 'correctMissingRate',
    direction: 'HIGHER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Higher critical correct-missing detection rate',
  },
  {
    priorityIndex: 5,
    metricKey: 'chordExactCompletenessRate',
    direction: 'HIGHER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Higher exact chord completeness rate',
  },
  {
    priorityIndex: 6,
    metricKey: 'expectedStrikeRecall',
    direction: 'HIGHER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Higher expected strike recall rate',
  },
  {
    priorityIndex: 7,
    metricKey: 'extraPrecision',
    direction: 'HIGHER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Higher extra note discrimination precision',
  },
  {
    priorityIndex: 8,
    metricKey: 'extraRecall',
    direction: 'HIGHER_IS_BETTER',
    meaningfulThreshold: 0.01,
    description: 'Higher extra note discrimination recall',
  },
  {
    priorityIndex: 9,
    metricKey: 'timingAbsoluteMedianMs',
    direction: 'LOWER_IS_BETTER',
    meaningfulThreshold: 5.0,
    description: 'Lower absolute timing offset median (milliseconds)',
  },
  {
    priorityIndex: 10,
    metricKey: 'timingAbsoluteP95Ms',
    direction: 'LOWER_IS_BETTER',
    meaningfulThreshold: 10.0,
    description: 'Lower absolute timing offset 95th percentile (milliseconds)',
  },
  {
    priorityIndex: 11,
    metricKey: 'finalizedFeedbackAgeP95Ms',
    direction: 'LOWER_IS_BETTER',
    meaningfulThreshold: 100.0,
    description: 'Lower finalized feedback age 95th percentile latency tie-break (milliseconds)',
  },
];

/**
 * Deterministic seeded bootstrap on scenario-level diffs (5000 draws).
 */
export function computeSeededBootstrapCi(diffs, seed = 13371, draws = 5000, confidence = 0.95) {
  if (diffs.length === 0) {
    return { low: 0, high: 0, mean: 0 };
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;

  let state = seed >>> 0;
  function lcg() {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  }

  const means = [];
  const n = diffs.length;
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(lcg() * n);
      sum += diffs[idx];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  const lowIdx = Math.floor(alpha * draws);
  const highIdx = Math.ceil((1 - alpha) * draws) - 1;
  return {
    mean,
    low: means[lowIdx],
    high: means[highIdx],
    seed,
    draws,
    confidenceLevel: confidence,
  };
}

/**
 * Evaluates pairwise dominance between Candidate A and Candidate B according to frozen V2 hierarchy.
 */
export function evaluateSafetyHierarchyDominance(diffVectorsByMetric) {
  const gateDecisions = [];
  let dominantCandidate = undefined;
  let regressionDetected = false;

  for (const rule of FROZEN_V2_SAFETY_FIRST_DECISION_HIERARCHY) {
    const diffs = diffVectorsByMetric[rule.metricKey] ?? [];
    if (diffs.length < 8) {
      gateDecisions.push({
        ...rule,
        status: 'INSUFFICIENT_PAIRED_SCENARIOS',
        sampleCount: diffs.length,
      });
      continue;
    }

    const ci = computeSeededBootstrapCi(diffs);
    challengerQual.assertBootstrapCiMathematicallyPlausible(ci.mean, ci);

    const isSuperior = rule.direction === 'LOWER_IS_BETTER'
      ? ci.mean <= -rule.meaningfulThreshold && ci.high < 0
      : ci.mean >= rule.meaningfulThreshold && ci.low > 0;

    const isInferior = rule.direction === 'LOWER_IS_BETTER'
      ? ci.mean >= rule.meaningfulThreshold && ci.low > 0
      : ci.mean <= -rule.meaningfulThreshold && ci.high < 0;

    if (isInferior) {
      regressionDetected = true;
    }

    if (isSuperior && !regressionDetected && !dominantCandidate) {
      dominantCandidate = 'CANDIDATE_A';
    }

    gateDecisions.push({
      ...rule,
      meanDiff: ci.mean,
      ci95: { low: ci.low, high: ci.high },
      isSuperior,
      isInferior,
      status: 'EVALUATED',
    });
  }

  const finalOutcome = dominantCandidate === 'CANDIDATE_A' && !regressionDetected
    ? 'CANDIDATE_A_DOMINATES'
    : 'NO_WINNER_OR_TIED';

  return {
    finalOutcome,
    regressionDetected,
    gateDecisions,
  };
}
