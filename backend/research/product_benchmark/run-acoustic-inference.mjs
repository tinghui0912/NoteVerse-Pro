#!/usr/bin/env node
/**
 * Stage A: Product Benchmark Acoustic Inference
 *
 * Consumes a TRUTH-FREE inference manifest containing only acoustic metadata.
 * Executes candidate models via reusable adapters without knowledge of score
 * ground truth, ExpectedStrikes, reference MIDI, or counterfactual mutations.
 *
 * Produces write-once candidate scenario runs in a minimal research run store:
 * <runDir>/
 *   run.json
 *   coverage.json
 *   evidence/
 *     <candidateId>__<scenarioId>.json
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ACTIVE_CANDIDATE_IDS,
  CANDIDATE_CONFIGS,
  createCandidateAdapter,
  assertTruthIsolation,
} from './candidate-adapters.mjs';

const repoRoot = process.cwd();

const BLIND_PERFORMERS = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'];

/**
 * Asserts that the manifest is completely truth-free.
 */
const SCENARIO_ALLOWED_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'scenarioId',
  'performerId',
  'pieceId',
  'fixedBpm',
  'audio',
  'source',
  'completion',
  'candidateEligibility',
]);

const SCENARIO_ALLOWED_AUDIO_KEYS = new Set([
  'sourceAudioPath',
  'sourceAudioSha256',
  'nativeSampleRateHz',
  'channelPolicy',
  'clipStartMs',
  'clipEndMs',
  'sourceDurationMs',
  'performanceOriginSourceMs',
]);

const SCENARIO_ALLOWED_SOURCE_KEYS = new Set([
  'sourceAudioPath',
  'sourceAudioSha256',
]);

const FORBIDDEN_TRUTH_KEYS = new Set([
  'expectedStrikes',
  'expectedEvents',
  'physicalGroundTruth',
  'sourceMidiPath',
  'sourceMidiSha256',
  'referenceMidi',
  'taxonomy',
  'familyTags',
  'counterfactualMutation',
  'counterfactualReceipt',
  'groundTruthStrikes',
  'truthReceipts',
  'notes',
  'notesTruth',
  'midiEvents',
]);

export function assertTruthFreeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('TRUTH_FREE_MANIFEST_REQUIRED: Manifest must be a non-null object');
  }
  const scenarios = manifest.scenarios ?? [];
  for (const scen of scenarios) {
    assertTruthIsolation(scen);
    for (const key of Object.keys(scen)) {
      if (FORBIDDEN_TRUTH_KEYS.has(key)) {
        throw new Error(`TRUTH_LEAKAGE_DETECTED:${scen.scenarioId}:${key}`);
      }
      if (!SCENARIO_ALLOWED_TOP_LEVEL_KEYS.has(key)) {
        throw new Error(`TRUTH_FREE_UNKNOWN_FIELD_REJECTED:${scen.scenarioId}:${key}`);
      }
    }
    for (const key of Object.keys(scen.audio ?? {})) {
      if (!SCENARIO_ALLOWED_AUDIO_KEYS.has(key)) {
        throw new Error(`TRUTH_FREE_UNKNOWN_AUDIO_FIELD_REJECTED:${scen.scenarioId}:${key}`);
      }
    }
    for (const key of Object.keys(scen.source ?? {})) {
      if (!SCENARIO_ALLOWED_SOURCE_KEYS.has(key)) {
        throw new Error(`TRUTH_FREE_UNKNOWN_SOURCE_FIELD_REJECTED:${scen.scenarioId}:${key}`);
      }
    }
    sanitizeToTruthFreeScenario(scen, { official: true });
  }
}

/**
 * Strips ground truth from a scenario to produce a truth-free inference scenario.
 */
export function sanitizeToTruthFreeScenario(scenario, { official = true } = {}) {
  const fixedBpm = scenario.fixedBpm ?? scenario.performance?.fixedBpm;
  const sourceAudioPath = scenario.audio?.sourceAudioPath ?? scenario.source?.sourceAudioPath;
  const sourceAudioSha256 = scenario.audio?.sourceAudioSha256 ?? scenario.source?.sourceAudioSha256;
  const nativeSampleRateHz = scenario.audio?.nativeSampleRateHz;
  const completionMs = scenario.completion?.performanceTimeMs;
  const originMs = scenario.audio?.performanceOriginSourceMs ?? scenario.performanceOriginSourceMs;
  const clipStartMs = scenario.audio?.clipStartMs;
  const clipEndMs = scenario.audio?.clipEndMs;
  if (official) {
    const missing = [];
    if (!scenario.scenarioId) missing.push('scenarioId');
    if (!scenario.performerId) missing.push('performerId');
    if (!Number.isFinite(fixedBpm)) missing.push('fixedBpm');
    if (!sourceAudioPath) missing.push('audio.sourceAudioPath');
    if (!sourceAudioSha256) missing.push('audio.sourceAudioSha256');
    if (!Number.isFinite(nativeSampleRateHz)) missing.push('audio.nativeSampleRateHz');
    if (!Number.isFinite(originMs)) missing.push('audio.performanceOriginSourceMs');
    if (!Number.isFinite(clipStartMs)) missing.push('audio.clipStartMs');
    if (!Number.isFinite(clipEndMs)) missing.push('audio.clipEndMs');
    if (!Number.isFinite(completionMs)) missing.push('completion.performanceTimeMs');
    if (missing.length > 0) {
      throw new Error(`TRUTH_FREE_REQUIRED_METADATA_MISSING:${scenario.scenarioId ?? 'unknown'}:${missing.join(',')}`);
    }
  }
  return {
    scenarioId: scenario.scenarioId,
    performerId: scenario.performerId,
    fixedBpm,
    completion: {
      performanceTimeMs: completionMs,
    },
    audio: {
      sourceAudioPath,
      sourceAudioSha256,
      clipStartMs,
      clipEndMs,
      sourceDurationMs: scenario.audio?.sourceDurationMs,
      nativeSampleRateHz,
      performanceOriginSourceMs: originMs,
    },
    candidateEligibility: scenario.candidateEligibility ?? {},
  };
}

export function deriveCandidateEligibilityFromAudioGeometry(scenario) {
  const originMs = scenario.audio?.performanceOriginSourceMs;
  if (!Number.isFinite(originMs)) {
    throw new Error(`CANDIDATE_ELIGIBILITY_ORIGIN_REQUIRED:${scenario.scenarioId}`);
  }
  const eligibility = {};
  for (const candidateId of ACTIVE_CANDIDATE_IDS) {
    const cfg = CANDIDATE_CONFIGS[candidateId];
    if (cfg.strategyKind === 'STREAMING') {
      eligibility[candidateId] = true;
    } else {
      eligibility[candidateId] = originMs >= cfg.contextGeometry.modelInputMs;
    }
  }
  return eligibility;
}

export function projectTruthFreeBlindManifest(truthManifest, options = {}) {
  const receiptByScenarioId = new Map((truthManifest.scenarioReceipts ?? []).map((receipt) => [receipt.scenarioId, receipt]));
  const scenarios = (truthManifest.scenarios ?? []).map((scenario) => {
    const receipt = receiptByScenarioId.get(scenario.scenarioId);
    const performerId = scenario.performerId
      ?? receipt?.performanceId?.match(/_p\d{2}$/)?.[0]?.slice(1)
      ?? scenario.scenarioId.match(/_p\d{2}/)?.[0]?.slice(1);
    const sanitized = sanitizeToTruthFreeScenario({
      ...scenario,
      performerId,
      fixedBpm: receipt?.configuredIntegerBpm ?? scenario.fixedBpm,
      source: {
        sourceAudioPath: scenario.source?.sourceAudioPath,
        sourceAudioSha256: scenario.source?.sourceAudioSha256,
      },
      audio: {
        ...scenario.audio,
        sourceAudioPath: scenario.source?.sourceAudioPath,
        sourceAudioSha256: scenario.source?.sourceAudioSha256,
      },
    }, { official: true });
    return {
      ...sanitized,
      pieceId: receipt?.pieceId,
      candidateEligibility: deriveCandidateEligibilityFromAudioGeometry(sanitized),
    };
  });
  assertTruthFreeManifest({ scenarios });
  const performers = [...new Set(scenarios.map((scenario) => scenario.performerId))].sort();
  const scenarioIds = scenarios.map((scenario) => scenario.scenarioId);
  const candidateEligibilityCounts = Object.fromEntries(ACTIVE_CANDIDATE_IDS.map((candidateId) => [
    candidateId,
    scenarios.filter((scenario) => scenario.candidateEligibility?.[candidateId] === true).length,
  ]));
  const allThreeIntersectionIds = scenarios
    .filter((scenario) => ACTIVE_CANDIDATE_IDS.every((candidateId) => scenario.candidateEligibility?.[candidateId] === true))
    .map((scenario) => scenario.scenarioId);
  const projection = {
    schemaVersion: 1,
    artifact: 'phase9gb3_final_preflight_truth_free_blind_projection',
    sourceTruthManifestSha256: options.sourceTruthManifestSha256 ?? createHash('sha256').update(JSON.stringify(truthManifest)).digest('hex'),
    scenarioCount: scenarios.length,
    performers,
    scenarioIds,
    candidateEligibilityCounts,
    allThreeIntersectionCount: allThreeIntersectionIds.length,
    allThreeIntersectionIds,
    scenarios,
    candidateRunCount: 0,
  };
  const projectionSha256 = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  return { ...projection, projectionSha256 };
}

/**
 * Runs Stage A acoustic inference.
 */
export async function runAcousticInference({
  manifestPath,
  manifestObject,
  runDir,
  executionMode, // 'SYNTHETIC' | 'REAL_BLIND' | 'DOCKER'
  candidateIds = ACTIVE_CANDIDATE_IDS,
  allowBlindExecution = false,
  realBlindUserAuthorization = false,
  stopBeforeFirstBlindInferenceForPreflightTest = false,
  simulatedLatencyMs = 25,
}) {
  if (!executionMode) {
    throw new Error('PRODUCT_BENCHMARK_EXECUTION_MODE_REQUIRED');
  }
  if (executionMode === 'REAL_BLIND' && (!allowBlindExecution || !realBlindUserAuthorization)) {
    throw new Error('REAL_BLIND_REQUIRES_EXPLICIT_USER_AUTHORIZATION_SWITCH');
  }
  if (executionMode !== 'REAL_BLIND' && realBlindUserAuthorization) {
    throw new Error('REAL_BLIND_AUTHORIZATION_SWITCH_ONLY_ALLOWED_WITH_REAL_BLIND_MODE');
  }
  if (executionMode === 'REAL_BLIND' && existsSync(runDir)) {
    const existing = await readdir(runDir);
    if (existing.length > 0) {
      throw new Error(`REAL_BLIND_RUN_DIRECTORY_MUST_BE_NEW_EMPTY:${runDir}`);
    }
  }
  const manifest = manifestObject ?? JSON.parse(await readFile(manifestPath, 'utf8'));
  assertTruthFreeManifest(manifest);

  const evidenceDir = path.resolve(runDir, 'evidence');
  await mkdir(evidenceDir, { recursive: true });

  const scenarios = manifest.scenarios ?? [];
  const coverage = {
    schemaVersion: 1,
    artifact: 'product_benchmark_coverage',
    runDir: path.relative(repoRoot, runDir).replace(/\\/g, '/'),
    executionMode,
    totalScenarios: scenarios.length,
    candidates: {},
    summary: {
      totalExpectedRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      notEligibleRuns: 0,
      notRunCount: 0,
    },
  };

  const evidenceHashes = {};

  for (const candidateId of candidateIds) {
    const adapter = createCandidateAdapter(candidateId);
    coverage.candidates[candidateId] = {
      candidateId,
      successfulScenarios: [],
      failedScenarios: [],
      notEligibleScenarios: [],
    };

    for (const scenario of scenarios) {
      coverage.summary.totalExpectedRuns += 1;
      const scenarioId = scenario.scenarioId;
      const evidenceFileName = `${candidateId}__${scenarioId}.json`;
      let evidenceFilePath = path.resolve(evidenceDir, evidenceFileName);

      // Check candidate eligibility
      if (scenario.candidateEligibility && scenario.candidateEligibility[candidateId] === false) {
        coverage.candidates[candidateId].notEligibleScenarios.push(scenarioId);
        coverage.summary.notEligibleRuns += 1;
        continue;
      }

      // Phase 9G-B.3 final-preflight safety guard: Real blind inference on p15-p22 is forbidden
      const isBlindPerformer = BLIND_PERFORMERS.includes(scenario.performerId)
        || scenarioId.startsWith('p15_') || scenarioId.startsWith('p16_')
        || scenarioId.startsWith('p17_') || scenarioId.startsWith('p18_')
        || scenarioId.startsWith('p19_') || scenarioId.startsWith('p20_')
        || scenarioId.startsWith('p21_') || scenarioId.startsWith('p22_');

      if (isBlindPerformer && !allowBlindExecution) {
        throw new Error(
          `REAL_BLIND_EXECUTION_FORBIDDEN_IN_PREP_PHASE: Attempted inference on blind scenario ${scenarioId}. ` +
          `Phase 9G-B.3-FINAL-PREFLIGHT forbids candidate execution on p15-p22 until explicit blind benchmark instruction.`
        );
      }
      if (executionMode === 'REAL_BLIND' && stopBeforeFirstBlindInferenceForPreflightTest) {
        throw new Error('STOP_BEFORE_FIRST_BLIND_INFERENCE_FOR_PREFLIGHT_TEST');
      }

      // Write-once store invariant: Never overwrite an existing successful evidence file
      if (existsSync(evidenceFilePath)) {
        const existing = JSON.parse(await readFile(evidenceFilePath, 'utf8'));
        if (existing.status === 'SUCCESS') {
          coverage.candidates[candidateId].successfulScenarios.push(scenarioId);
          coverage.summary.successfulRuns += 1;
          evidenceHashes[`${candidateId}__${scenarioId}`] = existing.evidenceSha256;
          continue;
        }
        if (executionMode === 'REAL_BLIND') {
          throw new Error(`REAL_BLIND_CANONICAL_EVIDENCE_SLOT_ALREADY_USED:${candidateId}:${scenarioId}`);
        }
        evidenceFilePath = path.resolve(evidenceDir, `${candidateId}__${scenarioId}__attempt-${Date.now()}.json`);
      }

      // Execute inference via adapter
      try {
        const sanitized = sanitizeToTruthFreeScenario(scenario);
        const candidateRun = await adapter.runInference(sanitized, {
          executionMode: executionMode === 'REAL_BLIND' ? 'DOCKER' : executionMode,
          simulatedLatencyMs,
        });

        const rawContent = JSON.stringify(candidateRun);
        const evidenceSha256 = createHash('sha256').update(rawContent, 'utf8').digest('hex');

        const evidenceRecord = {
          schemaVersion: 1,
          candidateId,
          scenarioId,
          profileId: CANDIDATE_CONFIGS[candidateId].profileId,
          configurationSha256: CANDIDATE_CONFIGS[candidateId].identity.configurationSha256,
          checkpointSha256: CANDIDATE_CONFIGS[candidateId].checkpoint.sha256,
          sourceAudioSha256: sanitized.audio.sourceAudioSha256,
          runtimeIdentity: candidateRun.runProvenance?.runtime,
          executionMode,
          status: 'SUCCESS',
          evidenceSha256,
          candidateRunDigestSha256: evidenceSha256,
          timestamp: new Date().toISOString(),
          candidateRun,
        };

        // Write evidence write-once
        await writeExclusiveJson(evidenceFilePath, evidenceRecord);

        coverage.candidates[candidateId].successfulScenarios.push(scenarioId);
        coverage.summary.successfulRuns += 1;
        evidenceHashes[`${candidateId}__${scenarioId}`] = evidenceSha256;
      } catch (err) {
        coverage.candidates[candidateId].failedScenarios.push({
          scenarioId,
          error: err.message,
        });
        coverage.summary.failedRuns += 1;

        const failureRecord = {
          candidateId,
          scenarioId,
          status: executionMode === 'REAL_BLIND' ? 'ATTEMPT_OUTCOME_UNKNOWN' : 'FAILED',
          error: err.message,
          executionMode,
          timestamp: new Date().toISOString(),
        };
        const failedPath = executionMode === 'REAL_BLIND'
          ? evidenceFilePath
          : path.resolve(evidenceDir, `${candidateId}__${scenarioId}__FAILED__${Date.now()}.json`);
        await writeExclusiveJson(failedPath, failureRecord);
      }
    }
  }

  // Write coverage.json
  const coveragePath = path.resolve(runDir, 'coverage.json');
  await writeFile(coveragePath, JSON.stringify(coverage, null, 2), 'utf8');

  // Write run.json
  const runRecord = {
    schemaVersion: 1,
    artifact: 'product_benchmark_run_metadata',
    phase: '9G-B.3-FINAL-PREFLIGHT',
    runDir: path.relative(repoRoot, runDir).replace(/\\/g, '/'),
    executionMode,
    implementationGitHead: gitHead(),
    productBenchmarkConfigSha256: CANDIDATE_CONFIGS[candidateIds[0]]?.identity?.benchmarkConfigSha256,
    candidateRegistrySha256: CANDIDATE_CONFIGS[candidateIds[0]]?.identity?.registrySha256,
    candidateAdapterSha256: await fileSha256('backend/research/product_benchmark/candidate-adapters.mjs'),
    scorerSha256: await fileSha256('apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'),
    rawInferenceScriptSha256ByCandidate: Object.fromEntries(candidateIds.map((candidateId) => [
      candidateId,
      fileSha256Sync(CANDIDATE_CONFIGS[candidateId].dockerScript),
    ])),
    candidateIds,
    scenarioCount: scenarios.length,
    completedAt: new Date().toISOString(),
    evidenceHashes,
    coverageSummary: coverage.summary,
  };
  const runPath = path.resolve(runDir, 'run.json');
  await writeFile(runPath, JSON.stringify(runRecord, null, 2), 'utf8');

  return {
    runDir,
    coverage,
    runRecord,
  };
}

async function writeExclusiveJson(filePath, value) {
  const handle = await open(filePath, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const args = process.argv.slice(2);
  const manifestIdx = args.indexOf('--manifest');
  const runDirIdx = args.indexOf('--run-dir');
  const modeIdx = args.indexOf('--mode');

  if (manifestIdx === -1 || runDirIdx === -1) {
    console.error('Usage: node run-acoustic-inference.mjs --manifest <path> --run-dir <dir> [--mode SYNTHETIC|REAL_BLIND|DOCKER]');
    process.exit(1);
  }

  const manifestPath = args[manifestIdx + 1];
  const runDir = args[runDirIdx + 1];
  if (modeIdx === -1) {
    console.error('Stage A requires explicit --mode SYNTHETIC|DOCKER|REAL_BLIND.');
    process.exit(1);
  }
  const executionMode = args[modeIdx + 1];
  const realBlindUserAuthorization = args.includes('--i-authorize-real-blind-inference');
  if (realBlindUserAuthorization && executionMode !== 'REAL_BLIND') {
    console.error('--i-authorize-real-blind-inference is only valid with --mode REAL_BLIND.');
    process.exit(1);
  }

  runAcousticInference({ manifestPath, runDir, executionMode, realBlindUserAuthorization, allowBlindExecution: realBlindUserAuthorization })
    .then((res) => {
      console.log(`Stage A Acoustic Inference finished: ${res.coverage.summary.successfulRuns} runs successful.`);
    })
    .catch((err) => {
      console.error('Stage A Acoustic Inference failed:', err);
      process.exit(1);
    });
}

function gitHead() {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (run.status !== 0) {
    return undefined;
  }
  return run.stdout.trim();
}

async function fileSha256(relPath) {
  return sha256Buffer(await readFile(path.resolve(repoRoot, relPath)));
}

function fileSha256Sync(relPath) {
  return createHash('sha256').update(readFileSync(path.resolve(repoRoot, relPath))).digest('hex');
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
