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
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CANDIDATE_CONFIGS,
  createCandidateAdapter,
  assertTruthIsolation,
} from './candidate-adapters.mjs';

const repoRoot = process.cwd();

const BLIND_PERFORMERS = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'];

/**
 * Asserts that the manifest is completely truth-free.
 */
export function assertTruthFreeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('TRUTH_FREE_MANIFEST_REQUIRED: Manifest must be a non-null object');
  }
  const scenarios = manifest.scenarios ?? [];
  for (const scen of scenarios) {
    if (scen.expectedStrikes || scen.expectedEvents || scen.referenceMidi || scen.notes || scen.counterfactualReceipt) {
      throw new Error(`TRUTH_LEAKAGE_DETECTED: Scenario ${scen.scenarioId} contains ground truth data`);
    }
    if (scen.notesTruth || scen.midiEvents || scen.groundTruthStrikes) {
      throw new Error(`TRUTH_LEAKAGE_DETECTED: Scenario ${scen.scenarioId} contains forbidden ground truth keys`);
    }
  }
}

/**
 * Strips ground truth from a scenario to produce a truth-free inference scenario.
 */
export function sanitizeToTruthFreeScenario(scenario) {
  return {
    scenarioId: scenario.scenarioId,
    performerId: scenario.performerId,
    fixedBpm: scenario.fixedBpm ?? scenario.performance?.fixedBpm ?? 60,
    performanceOriginSourceMs: scenario.audio?.performanceOriginSourceMs ?? 0,
    completion: {
      performanceTimeMs: scenario.completion?.performanceTimeMs ?? scenario.audio?.clipEndMs ?? 15000,
    },
    audio: {
      sourceAudioPath: scenario.audio?.sourceAudioPath ?? scenario.source?.sourceAudioPath,
      sourceAudioSha256: scenario.audio?.sourceAudioSha256 ?? scenario.source?.sourceAudioSha256,
      clipStartMs: scenario.audio?.clipStartMs ?? 0,
      clipEndMs: scenario.audio?.clipEndMs ?? scenario.completion?.performanceTimeMs ?? 15000,
      nativeSampleRateHz: scenario.audio?.nativeSampleRateHz ?? 44100,
    },
    candidateEligibility: scenario.candidateEligibility ?? {},
  };
}

/**
 * Runs Stage A acoustic inference.
 */
export async function runAcousticInference({
  manifestPath,
  manifestObject,
  runDir,
  executionMode = 'SYNTHETIC', // 'SYNTHETIC' | 'REAL_BLIND' | 'DOCKER'
  candidateIds = Object.keys(CANDIDATE_CONFIGS),
  allowBlindExecution = false,
  simulatedLatencyMs = 25,
}) {
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
      const evidenceFilePath = path.resolve(evidenceDir, evidenceFileName);

      // Check candidate eligibility
      if (scenario.candidateEligibility && scenario.candidateEligibility[candidateId] === false) {
        coverage.candidates[candidateId].notEligibleScenarios.push(scenarioId);
        coverage.summary.notEligibleRuns += 1;
        continue;
      }

      // Phase 9G-B.3-PREP safety guard: Real blind inference on p15-p22 is forbidden
      const isBlindPerformer = BLIND_PERFORMERS.includes(scenario.performerId)
        || scenarioId.startsWith('p15_') || scenarioId.startsWith('p16_')
        || scenarioId.startsWith('p17_') || scenarioId.startsWith('p18_')
        || scenarioId.startsWith('p19_') || scenarioId.startsWith('p20_')
        || scenarioId.startsWith('p21_') || scenarioId.startsWith('p22_');

      if (isBlindPerformer && !allowBlindExecution) {
        throw new Error(
          `REAL_BLIND_EXECUTION_FORBIDDEN_IN_PREP_PHASE: Attempted inference on blind scenario ${scenarioId}. ` +
          `Phase 9G-B.3-PREP forbids candidate execution on p15-p22 until explicit blind benchmark instruction.`
        );
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
          candidateId,
          scenarioId,
          status: 'SUCCESS',
          evidenceSha256,
          timestamp: new Date().toISOString(),
          candidateRun,
        };

        // Write evidence write-once
        await writeFile(evidenceFilePath, JSON.stringify(evidenceRecord, null, 2), 'utf8');

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
          status: 'FAILED',
          error: err.message,
          timestamp: new Date().toISOString(),
        };
        await writeFile(evidenceFilePath, JSON.stringify(failureRecord, null, 2), 'utf8');
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
    phase: '9G-B.3-PREP',
    runDir: path.relative(repoRoot, runDir).replace(/\\/g, '/'),
    executionMode,
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
  const executionMode = modeIdx !== -1 ? args[modeIdx + 1] : 'SYNTHETIC';

  runAcousticInference({ manifestPath, runDir, executionMode })
    .then((res) => {
      console.log(`Stage A Acoustic Inference finished: ${res.coverage.summary.successfulRuns} runs successful.`);
    })
    .catch((err) => {
      console.error('Stage A Acoustic Inference failed:', err);
      process.exit(1);
    });
}
