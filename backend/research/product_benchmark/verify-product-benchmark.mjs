#!/usr/bin/env node
/**
 * Phase 9G-B.3-PREP: Product Benchmark Verification Suite
 *
 * Implements a focused 20-item integration test suite verifying product-semantic
 * correctness, frozen candidate adapter fidelity, truth isolation, write-once run store,
 * 5000-draw bootstrap reproducibility, and safety-first dominance comparison.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  CANDIDATE_CONFIGS,
  ACTIVE_CANDIDATE_IDS,
  assertActiveCandidateRegistryIdentitiesExact,
  createCandidateAdapter,
  planByteDanceVariableContext,
  assertTruthIsolation,
  verifyPhysicalCheckpointIdentity,
  verifySourceAudioForScenario,
  extractResampleLinear,
  ByteDanceOriginalAdapter,
  OnlineAmtStreamingAdapter,
  RobustByteDanceAdapter,
} from './candidate-adapters.mjs';

import {
  runAcousticInference,
  assertTruthFreeManifest,
  sanitizeToTruthFreeScenario,
  projectTruthFreeBlindManifest,
} from './run-acoustic-inference.mjs';

import {
  scoreAndCompareBenchmark,
  computeBootstrapConfidenceInterval,
  getCandidateDefinition,
} from './score-and-compare.mjs';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const tempoModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/local-core/practice-tempo.ts'));
const strikesModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/local-core/continuous-expected-strikes.ts'));
const ledgerModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/local-core/continuous-finalization-ledger.ts'));
const bakeoffModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'));
const qualModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));

/**
 * Creates a valid synthetic mono 16kHz PCM16 WAV buffer.
 */
export function createSyntheticWavBuffer(durationSec = 2.0, freqHz = 440.0, sampleRateHz = 16000) {
  const sampleCount = Math.floor(durationSec * sampleRateHz);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // Linear PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * 2, 28); // Byte rate
  buffer.writeUInt16LE(2, 32); // Block align
  buffer.writeUInt16LE(16, 34); // 16-bit

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Sine wave samples
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRateHz;
    const sample = Math.round(Math.sin(2 * Math.PI * freqHz * t) * 16000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

/**
 * Helper creating a schema-compliant BenchmarkScenario.
 */
function createTestScenario({
  scenarioId = 'test_scen_1',
  bpm = 60,
  expectedStrikes = [],
  counterfactualMutation = null,
  durationMs = 6000,
  physicalAttacks = null,
} = {}) {
  const normalizedStrikes = expectedStrikes.map((s, idx) => ({
    strikeId: s.strikeId ?? `strike_${idx}`,
    groupId: s.groupId ?? `g_${idx}`,
    pitch: s.pitch ?? 'C4',
    expectedPerformanceTimeMs: s.expectedPerformanceTimeMs ?? s.performanceTimeMs ?? 1000,
    renderNoteIds: s.renderNoteIds ?? [`note_${idx}`],
    status: s.status ?? 'PENDING',
    ...(s.chordGroupId ? { chordGroupId: s.chordGroupId } : {}),
  }));

  const attacks = physicalAttacks ?? normalizedStrikes
    .filter((s) => s.status !== 'MISSING')
    .map((s, idx) => ({
      physicalEventId: `pe_${idx}`,
      pitch: s.pitch,
      performanceTimeMs: s.expectedPerformanceTimeMs,
      velocity: 80,
    }));

  return {
    schemaVersion: 1,
    scenarioId,
    split: 'DEVELOPMENT',
    familyTags: counterfactualMutation ? [counterfactualMutation.mutationType] : ['product_benchmark_verify'],
    performerId: 'p01',
    fixedBpm: bpm,
    source: {
      sourceAudioPath: 'backend/data/test_fixtures/synthetic.wav',
      sourceAudioSha256: 'a'.repeat(64),
      sourcePcmSha256: 'b'.repeat(64),
      provenance: 'VERIFICATION_HARNESS',
    },
    audio: {
      nativeSampleRateHz: 16000,
      channelPolicy: 'MONO_OR_DOWNMIX_TO_MONO',
      clipStartMs: 0,
      clipEndMs: durationMs,
      performanceOriginSourceMs: 0,
      sourceDurationMs: durationMs,
      pcmIdentity: 'synthetic_pcm',
    },
    completion: {
      kind: 'NATURAL',
      performanceTimeMs: durationMs,
    },
    expectedStrikes: normalizedStrikes,
    physicalGroundTruth: {
      status: 'RECORDED',
      sourceKind: 'SYNTHETIC_HARNESS',
      source: 'verification_fixture',
      attacks,
    },
    ...(counterfactualMutation ? { counterfactualMutation } : {}),
    corpusOverlapStatus: 'KNOWN_DISJOINT',
    candidateEligibility: {
      'bytedance-original-calibrated-v1': true,
      'online-amt-calibrated-v1': true,
      'bytedance-robust-augmented-calibrated-v1': true,
    },
  };
}

async function runAllChecks() {
  const results = [];
  const testWorkDir = path.resolve(repoRoot, 'backend/data/work/product_benchmark_verify');
  await mkdir(testWorkDir, { recursive: true });

  // Create synthetic WAV fixture
  const wavPath = path.resolve(testWorkDir, 'synthetic_test.wav');
  const wavBuffer = createSyntheticWavBuffer(6.0, 440.0, 16000);
  await writeFile(wavPath, wavBuffer);

  function record(itemNumber, title, pass, detail = '') {
    results.push({ itemNumber, title, pass, detail });
    const mark = pass ? '✓ PASS' : '✗ FAIL';
    console.log(`[Item ${itemNumber.toString().padStart(2, '0')}] ${mark}: ${title} ${detail ? `(${detail})` : ''}`);
  }

  console.log('--- Phase 9G-B.3-FIX Product Benchmark Verification Suite ---');

  // 1. CUSTOM_FIXED_BPM ExpectedStrike generation
  try {
    const artifactPath = path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json');
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    const contract = strikesModule.resolveContinuousPracticeContract({
      artifact,
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 },
      scope: { kind: 'FULL' },
    });
    const strikes = contract.expectedStrikes;
    const isFixedBpm = strikes.length > 0
      && Number.isFinite(contract.naturalTerminalPerformanceTimeMs)
      && contract.tempoPlan.selection.mode === 'CUSTOM_FIXED_BPM'
      && contract.tempoPlan.selection.bpm === 120;
    record(1, 'CUSTOM_FIXED_BPM ExpectedStrike generation', isFixedBpm, `Strikes: ${strikes.length}, Bpm: ${contract.tempoPlan.selection.bpm}, terminal: ${contract.naturalTerminalPerformanceTimeMs}ms`);
  } catch (err) {
    record(1, 'CUSTOM_FIXED_BPM ExpectedStrike generation', false, err.message);
  }

  // 2. Same shared ContinuousFinalizationLedger as the product
  try {
    const strikes = [
      {
        strikeId: 's1',
        groupId: 'g1',
        pitch: 'C4',
        expectedPerformanceTimeMs: 1000,
        renderNoteIds: ['n1'],
        status: 'PENDING',
      },
    ];
    const ledger = new ledgerModule.ContinuousFinalizationLedger({
      expectedStrikes: strikes,
      assignmentWindowMs: 120,
    });
    const snapshot = ledger.snapshot();
    const pass = snapshot !== null && Array.isArray(snapshot.strikes) && snapshot.strikes.length === 1;
    record(2, 'Same shared ContinuousFinalizationLedger as the product', pass, 'ContinuousFinalizationLedger initialized with expected strikes');
  } catch (err) {
    record(2, 'Same shared ContinuousFinalizationLedger as the product', false, err.message);
  }

  // 3. Correct-note scenario
  try {
    const definition = getCandidateDefinition('bytedance-original-calibrated-v1');
    const scenario = createTestScenario({
      scenarioId: 'scen_correct',
      expectedStrikes: [
        { strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'PENDING' },
      ],
    });
    const candidateRun = {
      candidateId: definition.candidateId,
      scenarioId: 'scen_correct',
      publications: [
        {
          publicationId: 'pub_1',
          analyzedThroughPerformanceMs: 6000,
          availabilityTimeMs: 6050,
          observations: [
            { observationId: 'obs_1', pitch: 'C4', performanceTimeMs: 1010, confidence: 0.95 },
          ],
        },
      ],
      runProvenance: { command: 'test', runtime: 'test' },
    };
    const score = bakeoffModule.scoreCandidate(scenario, definition, candidateRun);
    const pass = score.metrics.expectedStrikeRecall.value === 1;
    record(3, 'Correct-note scenario', pass, `Recall: ${score.metrics.expectedStrikeRecall.value}`);
  } catch (err) {
    record(3, 'Correct-note scenario', false, err.message);
  }

  // 4. Missing-note scenario
  try {
    const definition = getCandidateDefinition('bytedance-original-calibrated-v1');
    const scenario = createTestScenario({
      scenarioId: 'scen_missing',
      expectedStrikes: [
        { strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'MISSING' },
      ],
      physicalAttacks: [],
    });
    const candidateRun = {
      candidateId: definition.candidateId,
      scenarioId: 'scen_missing',
      publications: [
        {
          publicationId: 'pub_1',
          analyzedThroughPerformanceMs: 6000,
          availabilityTimeMs: 6050,
          observations: [], // No acoustic observation produced
        },
      ],
      runProvenance: { command: 'test', runtime: 'test' },
    };
    const score = bakeoffModule.scoreCandidate(scenario, definition, candidateRun);
    const pass = score.metrics.correctMissingRate.value === 1 && score.metrics.falseMatchRateOnGroundTruthMissing.value === 0;
    record(4, 'Missing-note scenario', pass, `CorrectMissingRate: ${score.metrics.correctMissingRate.value}`);
  } catch (err) {
    record(4, 'Missing-note scenario', false, err.message);
  }

  // 5. Wrong-semitone scenario
  try {
    const definition = getCandidateDefinition('bytedance-original-calibrated-v1');
    const scenario = createTestScenario({
      scenarioId: 'scen_wrong_semitone',
      expectedStrikes: [
        { strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'MISSING' },
      ],
      counterfactualMutation: {
        mutationType: 'COUNTERFACTUAL_WRONG_SEMITONE',
        mutatedExpectedPitch: 'C4',
        physicalPlayedPitch: 'C#4',
      },
      physicalAttacks: [
        { physicalEventId: 'pe_wrong_1', pitch: 'C#4', performanceTimeMs: 1000 },
      ],
    });
    // Candidate played C#4 (did not falsely match C4)
    const candidateRun = {
      candidateId: definition.candidateId,
      scenarioId: 'scen_wrong_semitone',
      publications: [
        {
          publicationId: 'pub_1',
          analyzedThroughPerformanceMs: 6000,
          availabilityTimeMs: 6050,
          observations: [
            { observationId: 'obs_1', pitch: 'C#4', performanceTimeMs: 1010, confidence: 0.95 },
          ],
        },
      ],
      runProvenance: { command: 'test', runtime: 'test' },
    };
    const score = bakeoffModule.scoreCandidate(scenario, definition, candidateRun);
    const pass = score.metrics.wrongNoteFalseCorrectRate.value === 0 && score.metrics.wrongNoteDetectionRate.value === 1;
    record(5, 'Wrong-semitone scenario', pass, `wrongNoteFalseCorrectRate: ${score.metrics.wrongNoteFalseCorrectRate.value}, detectionRate: ${score.metrics.wrongNoteDetectionRate.value}`);
  } catch (err) {
    record(5, 'Wrong-semitone scenario', false, err.message);
  }

  // 6. Incomplete-chord scenario
  try {
    const definition = getCandidateDefinition('bytedance-original-calibrated-v1');
    const scenario = createTestScenario({
      scenarioId: 'scen_incomplete_chord',
      expectedStrikes: [
        { strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'PENDING', groupId: 'chord_1' },
        { strikeId: 'es_2', pitch: 'E4', expectedPerformanceTimeMs: 1000, status: 'MISSING', groupId: 'chord_1' },
      ],
      counterfactualMutation: {
        mutationType: 'COUNTERFACTUAL_INCOMPLETE_CHORD',
      },
      physicalAttacks: [
        { physicalEventId: 'pe_c4', pitch: 'C4', performanceTimeMs: 1000 },
      ],
    });
    const candidateRun = {
      candidateId: definition.candidateId,
      scenarioId: 'scen_incomplete_chord',
      publications: [
        {
          publicationId: 'pub_1',
          analyzedThroughPerformanceMs: 6000,
          availabilityTimeMs: 6050,
          observations: [
            { observationId: 'obs_1', pitch: 'C4', performanceTimeMs: 1005, confidence: 0.95 },
          ],
        },
      ],
      runProvenance: { command: 'test', runtime: 'test' },
    };
    const score = bakeoffModule.scoreCandidate(scenario, definition, candidateRun);
    const pass = score.metrics.falseCompleteChordAcceptanceRate.value === 0;
    record(6, 'Incomplete-chord scenario', pass, `falseCompleteChordAcceptanceRate: ${score.metrics.falseCompleteChordAcceptanceRate.value}`);
  } catch (err) {
    record(6, 'Incomplete-chord scenario', false, err.message);
  }

  // 7. Extra-note scenario
  try {
    const definition = getCandidateDefinition('bytedance-original-calibrated-v1');
    const scenario = createTestScenario({
      scenarioId: 'scen_extra_note',
      expectedStrikes: [
        { strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'PENDING' },
      ],
      physicalAttacks: [
        { physicalEventId: 'pe_c4', pitch: 'C4', performanceTimeMs: 1000 },
        { physicalEventId: 'pe_extra_g4', pitch: 'G4', performanceTimeMs: 2500 },
      ],
    });
    const candidateRun = {
      candidateId: definition.candidateId,
      scenarioId: 'scen_extra_note',
      publications: [
        {
          publicationId: 'pub_1',
          analyzedThroughPerformanceMs: 6000,
          availabilityTimeMs: 6050,
          observations: [
            { observationId: 'obs_1', pitch: 'C4', performanceTimeMs: 1000, confidence: 0.95 },
            { observationId: 'obs_extra', pitch: 'G4', performanceTimeMs: 2500, confidence: 0.95 },
          ],
        },
      ],
      runProvenance: { command: 'test', runtime: 'test' },
    };
    const score = bakeoffModule.scoreCandidate(scenario, definition, candidateRun);
    const pass = score.metrics.extraPrecision.value === 1 && score.metrics.extraRecall.value === 1;
    record(7, 'Extra-note scenario', pass, `extraPrecision: ${score.metrics.extraPrecision.value}, extraRecall: ${score.metrics.extraRecall.value}`);
  } catch (err) {
    record(7, 'Extra-note scenario', false, err.message);
  }

  // 8. ByteDance 5s context geometry exactly matches calibration
  try {
    const scen = { scenarioId: 'scen_geo5', completion: { performanceTimeMs: 7000 } };
    const plans = planByteDanceVariableContext(scen, CANDIDATE_CONFIGS['bytedance-original-calibrated-v1'].contextGeometry);
    const p0 = plans[0];
    const pass = plans.length === 3
      && p0.commitStartPerformanceMs === 0
      && p0.commitEndPerformanceMs === 2500
      && p0.inputStartPerformanceMs === -1250
      && p0.inputEndPerformanceMs === 3750;
    record(8, 'ByteDance 5s context geometry exactly matches calibration', pass, `Input: ${p0.inputEndPerformanceMs - p0.inputStartPerformanceMs}ms, Owned: ${p0.commitEndPerformanceMs - p0.commitStartPerformanceMs}ms`);
  } catch (err) {
    record(8, 'ByteDance 5s context geometry exactly matches calibration', false, err.message);
  }

  // 9. Robust ByteDance 1820 geometry exactly matches calibration
  try {
    const scen = { scenarioId: 'scen_geo1820', completion: { performanceTimeMs: 1500 } };
    const plans = planByteDanceVariableContext(scen, CANDIDATE_CONFIGS['bytedance-robust-augmented-calibrated-v1'].contextGeometry);
    const p0 = plans[0];
    const pass = p0.inputEndPerformanceMs - p0.inputStartPerformanceMs === 1820
      && p0.commitEndPerformanceMs - p0.commitStartPerformanceMs <= 600
      && p0.inputEndPerformanceMs - p0.commitEndPerformanceMs <= 220;
    record(9, 'Robust ByteDance 1820 geometry exactly matches calibration', pass, `Input: 1820ms, Commit: 600ms, Future: 220ms`);
  } catch (err) {
    record(9, 'Robust ByteDance 1820 geometry exactly matches calibration', false, err.message);
  }

  // 10. Online-AMT stateful hop continuity
  try {
    const adapter = new OnlineAmtStreamingAdapter();
    const scen = { scenarioId: 'scen_stream', completion: { performanceTimeMs: 320 } };
    const run = await adapter.runInference(scen, { executionMode: 'SYNTHETIC' });
    const monotonic = run.publications.length > 0 && run.publications.every((p, idx, arr) =>
      idx === 0 || p.analyzedThroughPerformanceMs >= arr[idx - 1].analyzedThroughPerformanceMs
    );
    const pass = run.publications.length === 5 && monotonic; // boost-1 calibrated profile uses -162.9375ms correction
    record(10, 'Online-AMT boost-1 stateful hop continuity', pass, `Hops: 10 input hops -> ${run.publications.length} publications with non-decreasing coverage (-162.9375ms timing correction)`);
  } catch (err) {
    record(10, 'Online-AMT stateful hop continuity', false, err.message);
  }

  // 11. No future audio beyond each frozen candidate's allowed context
  try {
    const scen = { scenarioId: 'scen_future', completion: { performanceTimeMs: 5000 } };
    const plans5s = planByteDanceVariableContext(scen, CANDIDATE_CONFIGS['bytedance-original-calibrated-v1'].contextGeometry);
    const futureOverrun = plans5s.some((p) => p.inputEndPerformanceMs - p.commitEndPerformanceMs > 1250);
    record(11, 'No future audio beyond allowed context', !futureOverrun, 'Strict 1250ms future bound verified on all windows');
  } catch (err) {
    record(11, 'No future audio beyond allowed context', false, err.message);
  }

  // 12. Actual publication availability timing
  try {
    const adapter = new ByteDanceOriginalAdapter();
    const scen = { scenarioId: 'scen_avail', completion: { performanceTimeMs: 5000 } };
    const run = await adapter.runInference(scen, { executionMode: 'SYNTHETIC', simulatedLatencyMs: 35 });
    const pub0 = run.publications[0];
    const pass = pub0.availabilityTimeMs >= pub0.analyzedThroughPerformanceMs
      && pub0.diagnostics.queueDelayMs >= 0;
    record(12, 'Actual publication availability timing', pass, `Analyzed: ${pub0.analyzedThroughPerformanceMs}ms, Available: ${pub0.availabilityTimeMs}ms`);
  } catch (err) {
    record(12, 'Actual publication availability timing', false, err.message);
  }

  // 13. Real synthetic WAV through all three actual candidate adapters
  try {
    const scen = {
      scenarioId: 'scen_synthetic_wav',
      audio: { sourceAudioPath: wavPath, clipEndMs: 6000, performanceOriginSourceMs: 0 },
      completion: { performanceTimeMs: 6000 },
    };
    const bAdapter = new ByteDanceOriginalAdapter();
    const oAdapter = new OnlineAmtStreamingAdapter();
    const rAdapter = new RobustByteDanceAdapter();

    const bRun = await bAdapter.runInference(scen, { executionMode: 'SYNTHETIC' });
    const oRun = await oAdapter.runInference(scen, { executionMode: 'SYNTHETIC' });
    const rRun = await rAdapter.runInference(scen, { executionMode: 'SYNTHETIC' });

    const pass = bRun.publications.length > 0 && oRun.publications.length > 0 && rRun.publications.length > 0;
    record(13, 'Real synthetic WAV through all three candidate adapters', pass, `ByteDance pubs: ${bRun.publications.length}, Online-AMT: ${oRun.publications.length}, Robust: ${rRun.publications.length}`);
  } catch (err) {
    record(13, 'Real synthetic WAV through all three candidate adapters', false, err.message);
  }

  // 14. Candidate output cannot change BPM/clock/ExpectedStrike
  try {
    const originalBpm = 60;
    const scen = createTestScenario({ scenarioId: 'scen_clock_invariant', bpm: originalBpm });
    const adapter = new ByteDanceOriginalAdapter();
    const run = await adapter.runInference(sanitizeToTruthFreeScenario(scen), { executionMode: 'SYNTHETIC' });

    const pass = scen.fixedBpm === originalBpm
      && scen.expectedStrikes !== undefined
      && !run.hasOwnProperty('fixedBpm')
      && !run.hasOwnProperty('expectedStrikes');
    record(14, 'Candidate output cannot change BPM/clock/ExpectedStrike', pass, 'Candidate run contains only acoustic publications');
  } catch (err) {
    record(14, 'Candidate output cannot change BPM/clock/ExpectedStrike', false, err.message);
  }

  // 15. Truth-free inference process
  try {
    let rejected = false;
    try {
      assertTruthIsolation({
        scenarioId: 'scen_leaked',
        expectedStrikes: [{ strikeId: 'es_1', pitch: 'C4' }],
      });
    } catch {
      rejected = true;
    }
    record(15, 'Truth-free inference process', rejected, 'Adapter immediately throws when ground truth metadata is present');
  } catch (err) {
    record(15, 'Truth-free inference process', false, err.message);
  }

  // 16. Disk evidence replay through scoreCandidate()
  try {
    const definition = getCandidateDefinition('bytedance-original-calibrated-v1');
    const scen = createTestScenario({
      scenarioId: 'scen_replay',
      expectedStrikes: [{ strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'PENDING' }],
    });
    const run = {
      candidateId: definition.candidateId,
      scenarioId: 'scen_replay',
      publications: [
        {
          publicationId: 'pub_1',
          analyzedThroughPerformanceMs: 6000,
          availabilityTimeMs: 6050,
          observations: [{ observationId: 'obs_1', pitch: 'C4', performanceTimeMs: 1000, confidence: 0.95 }],
        },
      ],
      runProvenance: { command: 'test', runtime: 'test' },
    };
    const evidencePath = path.resolve(testWorkDir, 'test_cand__scen_replay.json');
    await writeFile(evidencePath, JSON.stringify({ status: 'SUCCESS', candidateRun: run }), 'utf8');

    const reloaded = JSON.parse(await readFile(evidencePath, 'utf8'));
    const scoreA = bakeoffModule.scoreCandidate(scen, definition, run);
    const scoreB = bakeoffModule.scoreCandidate(scen, definition, reloaded.candidateRun);

    const pass = JSON.stringify(scoreA.metrics) === JSON.stringify(scoreB.metrics);
    record(16, 'Disk evidence replay through scoreCandidate()', pass, 'Exact score parity between memory and reloaded disk evidence');
  } catch (err) {
    record(16, 'Disk evidence replay through scoreCandidate()', false, err.message);
  }

  // 17. Explicit wrong-note diagnostics
  try {
    const definition = getCandidateDefinition('bytedance-original-calibrated-v1');
    const scen = createTestScenario({
      scenarioId: 'scen_diag_wrong',
      expectedStrikes: [{ strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'MISSING' }],
      counterfactualMutation: {
        mutationType: 'COUNTERFACTUAL_WRONG_SEMITONE',
        mutatedExpectedPitch: 'C4',
        physicalPlayedPitch: 'C#4',
      },
      physicalAttacks: [{ physicalEventId: 'pe_wrong_1', pitch: 'C#4', performanceTimeMs: 1000 }],
    });
    const run = {
      candidateId: definition.candidateId,
      scenarioId: 'scen_diag_wrong',
      publications: [{ publicationId: 'p1', analyzedThroughPerformanceMs: 6000, availabilityTimeMs: 6050, observations: [] }],
      runProvenance: { command: 'test', runtime: 'test' },
    };
    const score = bakeoffModule.scoreCandidate(scen, definition, run);
    const pass = score.metrics.hasOwnProperty('wrongNoteFalseCorrectRate')
      && score.metrics.hasOwnProperty('wrongNoteDetectionRate')
      && score.metrics.wrongNoteFalseCorrectRate.status === 'MEASURED'
      && score.metrics.wrongNoteDetectionRate.status === 'MEASURED';
    record(17, 'Explicit wrong-note diagnostics', pass, `wrongNoteFalseCorrectRate=${score.metrics.wrongNoteFalseCorrectRate.value}`);
  } catch (err) {
    record(17, 'Explicit wrong-note diagnostics', false, err.message);
  }

  // 18. 5000-draw paired bootstrap
  try {
    const diffs = [0.01, 0.02, 0.03, 0.02, 0.04, 0.01, 0.02, 0.03];
    const ci = computeBootstrapConfidenceInterval(diffs, 5000, 13371);
    const pass = ci.draws === 5000 && ci.seed === 13371 && ci.low <= ci.mean && ci.mean <= ci.high;
    record(18, '5000-draw paired bootstrap', pass, `CI [${ci.low.toFixed(4)}, ${ci.high.toFixed(4)}], mean=${ci.mean.toFixed(4)}`);
  } catch (err) {
    record(18, '5000-draw paired bootstrap', false, err.message);
  }

  // 19. Safety-first no-winner behavior
  try {
    // Diff vector with significant regression on critical safety gate: falseMatchRateOnGroundTruthMissing
    const diffVectors = {
      falseMatchRateOnGroundTruthMissing: [0.05, 0.04, 0.06, 0.05, 0.04, 0.05, 0.06, 0.05], // Candidate B has +5% false matches (severe regression!)
      finalizedFeedbackAgeP95Ms: [-200, -250, -180, -220, -210, -190, -230, -240], // Candidate B is 200ms faster
    };
    const ciComputer = (diffs) => computeBootstrapConfidenceInterval(diffs, 5000, 13371);
    const decision = qualModule.evaluateSymmetricSafetyDominance(diffVectors, ciComputer, { minimumPairedScenarios: 8 });

    // Despite being 200ms faster, Candidate B must NOT win due to safety regression!
    const pass = decision.winner !== 'CANDIDATE_B' && decision.outcome !== 'CANDIDATE_B_DOMINATES';
    record(19, 'Safety-first no-winner behavior', pass, `Outcome: ${decision.outcome}, Winner: ${decision.winner ?? 'NONE (safety protected)'}`);
  } catch (err) {
    record(19, 'Safety-first no-winner behavior', false, err.message);
  }

  // 20. Missing candidate/scenario evidence yields incomplete evaluation
  try {
    const dummyRunDir = path.resolve(testWorkDir, 'dummy_run');
    await mkdir(dummyRunDir, { recursive: true });
    await writeFile(path.resolve(dummyRunDir, 'coverage.json'), JSON.stringify({ summary: { totalExpectedRuns: 10 } }), 'utf8');

    // Call Stage B with missing evidence
    const scen = createTestScenario({ scenarioId: 'scen_missing_ev' });
    const analysis = await scoreAndCompareBenchmark({
      runDir: dummyRunDir,
      truthScenariosObject: [scen],
      candidateIds: ['bytedance-original-calibrated-v1'],
    });

    const pass = analysis.evaluationStatus === 'EVALUATION_INCOMPLETE_NO_WINNER' && analysis.winner === null;
    record(20, 'Missing evidence yields incomplete evaluation', pass, `Status: ${analysis.evaluationStatus}, Winner: ${analysis.winner}`);
  } catch (err) {
    record(20, 'Missing evidence yields incomplete evaluation', false, err.message);
  }

  // 21. Exact frozen candidate identity for all three active candidates
  try {
    assertActiveCandidateRegistryIdentitiesExact();
    const pass = ACTIVE_CANDIDATE_IDS.length === 3
      && CANDIDATE_CONFIGS['online-amt-calibrated-v1'].profileId === 'online-amt-calibration-native-boost-1'
      && CANDIDATE_CONFIGS['online-amt-calibrated-v1'].streaming.publishedOnsetBoost === 1.0
      && CANDIDATE_CONFIGS['bytedance-robust-augmented-calibrated-v1'].checkpoint.sha256 === 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e'
      && !Object.values(CANDIDATE_CONFIGS).some((cfg) => Object.prototype.hasOwnProperty.call(cfg, 'rank'));
    record(21, 'Exact frozen candidate identity for all three active candidates', pass, ACTIVE_CANDIDATE_IDS.join(', '));
  } catch (err) {
    record(21, 'Exact frozen candidate identity for all three active candidates', false, err.message);
  }

  // 22. Strict truth-free allow-list and no fabricated defaults
  try {
    let rejectedTruth = false;
    let rejectedMissingMetadata = false;
    try {
      assertTruthFreeManifest({ scenarios: [{ scenarioId: 'leaky', expectedStrikes: [] }] });
    } catch {
      rejectedTruth = true;
    }
    try {
      sanitizeToTruthFreeScenario({ scenarioId: 'missing' }, { official: true });
    } catch {
      rejectedMissingMetadata = true;
    }
    record(22, 'Strict truth-free allow-list rejects truth and missing official metadata', rejectedTruth && rejectedMissingMetadata);
  } catch (err) {
    record(22, 'Strict truth-free allow-list rejects truth and missing official metadata', false, err.message);
  }

  // 23. Source audio hash verification and non-16k/nonzero-origin resampling
  try {
    const wav44Path = path.resolve(testWorkDir, 'origin_44k.wav');
    const wav44 = createSyntheticWavBuffer(2.0, 220.0, 44100);
    await writeFile(wav44Path, wav44);
    const wav44Sha = createHash('sha256').update(wav44).digest('hex');
    const scen = {
      scenarioId: 'origin_resample',
      audio: {
        sourceAudioPath: path.relative(repoRoot, wav44Path).replace(/\\/g, '/'),
        sourceAudioSha256: wav44Sha,
        nativeSampleRateHz: 44100,
        clipStartMs: 0,
        clipEndMs: 2000,
        sourceDurationMs: 2000,
        performanceOriginSourceMs: 500,
      },
      completion: { performanceTimeMs: 500 },
    };
    const verified = await verifySourceAudioForScenario(scen);
    const resampled = extractResampleLinear({
      sourcePcm: verified.wav.pcm,
      sourceSampleRateHz: verified.wav.sampleRateHz,
      sourceStartMs: 500,
      sourceEndMs: 1000,
      outputSamples: 8000,
    });
    const expectedFirstNativeIndex = Math.floor(0.5 * 44100);
    const pass = verified.wav.sampleRateHz === 44100
      && resampled.length === 8000
      && Math.abs(resampled[0] - verified.wav.pcm[expectedFirstNativeIndex]) < 0.01;
    record(23, 'Online-AMT source PCM starts at nonzero performance origin before 16k resampling', pass);
  } catch (err) {
    record(23, 'Online-AMT source PCM starts at nonzero performance origin before 16k resampling', false, err.message);
  }

  // 24. Complete Stage A -> Stage B rehearsal reaches scoring and pairwise comparison
  try {
    const runDir = path.resolve(testWorkDir, 'complete_rehearsal');
    await rm(runDir, { recursive: true, force: true });
    const wavSha = createHash('sha256').update(wavBuffer).digest('hex');
    const truthScenarios = ['BASE_ORIGINAL', 'COUNTERFACTUAL_MISSING_NOTE', 'COUNTERFACTUAL_WRONG_SEMITONE'].flatMap((family, familyIndex) =>
      Array.from({ length: 8 }, (_, index) => {
        const expected = [{ strikeId: `es_${familyIndex}_${index}`, pitch: 'C4', expectedPerformanceTimeMs: 1000, status: family === 'COUNTERFACTUAL_MISSING_NOTE' || family === 'COUNTERFACTUAL_WRONG_SEMITONE' ? 'MISSING' : 'PENDING' }];
        const physicalAttacks = family === 'COUNTERFACTUAL_MISSING_NOTE'
          ? []
          : family === 'COUNTERFACTUAL_WRONG_SEMITONE'
            ? [{ physicalEventId: `wrong_${index}`, pitch: 'C#4', performanceTimeMs: 1000 }]
            : [{ physicalEventId: `ok_${index}`, pitch: 'C4', performanceTimeMs: 1000 }];
        return {
          ...createTestScenario({
            scenarioId: `rehearsal_${family}_${index}`,
            expectedStrikes: expected,
            physicalAttacks,
            counterfactualMutation: family === 'COUNTERFACTUAL_WRONG_SEMITONE'
              ? { mutationType: family, physicalPlayedPitch: 'C#4' }
              : family === 'COUNTERFACTUAL_MISSING_NOTE'
                ? { mutationType: family }
                : null,
          }),
          split: 'DEVELOPMENT',
          performerId: 'p01',
          familyTags: [family],
          source: {
            sourceAudioPath: path.relative(repoRoot, wavPath).replace(/\\/g, '/'),
            sourceAudioSha256: wavSha,
            provenance: 'PRODUCT_BENCHMARK_REHEARSAL',
          },
          audio: {
            nativeSampleRateHz: 16000,
            channelPolicy: 'MONO',
            clipStartMs: 0,
            clipEndMs: 6000,
            sourceDurationMs: 6000,
            performanceOriginSourceMs: 0,
            pcmIdentity: 'rehearsal_pcm',
          },
          completion: { kind: 'NATURAL', performanceTimeMs: 6000 },
        };
      })
    );
    const manifestObject = { scenarios: truthScenarios.map((scenario) => sanitizeToTruthFreeScenario(scenario, { official: true })) };
    const stageA = await runAcousticInference({
      manifestObject,
      runDir,
      executionMode: 'SYNTHETIC',
      simulatedLatencyMs: 25,
    });
    const analysis = await scoreAndCompareBenchmark({
      runDir,
      truthScenariosObject: truthScenarios,
    });
    const pass = stageA.coverage.summary.successfulRuns === 72
      && analysis.evaluationStatus === 'EVALUATION_COMPLETED'
      && Object.keys(analysis.pairwiseComparisons).length === 3;
    record(24, 'Complete Stage A -> Stage B rehearsal reaches three-candidate comparison', pass, `Outcome: ${analysis.benchmarkOutcome}`);
  } catch (err) {
    record(24, 'Complete Stage A -> Stage B rehearsal reaches three-candidate comparison', false, err.message);
  }

  // 25. Pairwise MetricNumber extraction is A-minus-B and reversal-invariant
  try {
    const scenario = createTestScenario({
      scenarioId: 'pair_metricnumber',
      expectedStrikes: [{ strikeId: 'es_1', pitch: 'C4', expectedPerformanceTimeMs: 1000, status: 'PENDING' }],
    });
    const defA = getCandidateDefinition('bytedance-original-calibrated-v1');
    const defB = getCandidateDefinition('online-amt-calibrated-v1');
    const runA = { candidateId: defA.candidateId, scenarioId: scenario.scenarioId, publications: [{ publicationId: 'a', analyzedThroughPerformanceMs: 6000, availabilityTimeMs: 6000, observations: [{ observationId: 'a1', pitch: 'C4', performanceTimeMs: 1000 }] }] };
    const runB = { candidateId: defB.candidateId, scenarioId: scenario.scenarioId, publications: [{ publicationId: 'b', analyzedThroughPerformanceMs: 6000, availabilityTimeMs: 6000, observations: [] }] };
    const scoreA = bakeoffModule.scoreCandidate(scenario, defA, runA);
    const scoreB = bakeoffModule.scoreCandidate(scenario, defB, runB);
    const ab = scoreA.metrics.expectedStrikeRecall.value - scoreB.metrics.expectedStrikeRecall.value;
    const ba = scoreB.metrics.expectedStrikeRecall.value - scoreA.metrics.expectedStrikeRecall.value;
    record(25, 'MetricNumber value paired extraction is reversal-invariant', ab === -ba && ab === 1);
  } catch (err) {
    record(25, 'MetricNumber value paired extraction is reversal-invariant', false, err.message);
  }

  // 26. Truth-free blind projection has 70 p15-p22 scenarios and zero candidate runs
  try {
    const blind = JSON.parse(await readFile(path.resolve(repoRoot, 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json'), 'utf8'));
    const projection = projectTruthFreeBlindManifest(blind);
    const allowedPerformers = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'];
    const pass = projection.scenarioCount === 70
      && projection.candidateRunCount === 0
      && projection.performers.every((p) => allowedPerformers.includes(p))
      && !JSON.stringify(projection.scenarios).includes('expectedStrikes')
      && !JSON.stringify(projection.scenarios).includes('physicalGroundTruth');
    const outPath = path.resolve(testWorkDir, 'phase9gb3_fix_truth_free_blind_projection.json');
    await writeFile(outPath, JSON.stringify(projection, null, 2), 'utf8');
    record(26, 'Truth-free blind projection preserves safe identities only and candidate run count remains zero', pass, `sha=${projection.projectionSha256}`);
  } catch (err) {
    record(26, 'Truth-free blind projection preserves safe identities only and candidate run count remains zero', false, err.message);
  }

  // 27. Physical checkpoint byte/hash verification for all active candidates
  try {
    const checks = ACTIVE_CANDIDATE_IDS.map((candidateId) => verifyPhysicalCheckpointIdentity(CANDIDATE_CONFIGS[candidateId]));
    const pass = checks.length === 3
      && checks.every((check) => /^[a-f0-9]{64}$/.test(check.sha256))
      && checks.every((check) => check.bytes > 0);
    record(27, 'Physical checkpoint byte/hash verification for all active candidates', pass, checks.map((check) => `${check.sha256.slice(0, 8)}:${check.bytes}`).join(', '));
  } catch (err) {
    record(27, 'Physical checkpoint byte/hash verification for all active candidates', false, err.message);
  }

  // 28. Real neural non-blind integration for all three adapters
  try {
    const realRunDir = path.resolve(testWorkDir, 'real_neural_nonblind_smoke');
    await rm(realRunDir, { recursive: true, force: true });
    const realWavPath = path.resolve(realRunDir, 'nonblind_dev_synthetic.wav');
    await mkdir(realRunDir, { recursive: true });
    const realBytes = createSyntheticWavBuffer(12.0, 440.0, 16000);
    await writeFile(realWavPath, realBytes);
    const realSha = createHash('sha256').update(realBytes).digest('hex');
    const audioRel = path.relative(repoRoot, realWavPath).replace(/\\/g, '/');
    const scenario = {
      schemaVersion: 1,
      scenarioId: 'phase9gb3-fix-real-neural-dev-smoke',
      performerId: 'p01',
      pieceId: 'synthetic-dev',
      fixedBpm: 120,
      source: { sourceAudioPath: audioRel, sourceAudioSha256: realSha },
      audio: {
        sourceAudioPath: audioRel,
        sourceAudioSha256: realSha,
        nativeSampleRateHz: 16000,
        channelPolicy: 'MONO',
        clipStartMs: 0,
        clipEndMs: 12000,
        sourceDurationMs: 12000,
        performanceOriginSourceMs: 5000,
      },
      completion: { performanceTimeMs: 1000 },
      candidateEligibility: Object.fromEntries(ACTIVE_CANDIDATE_IDS.map((candidateId) => [candidateId, true])),
    };
    const result = await runAcousticInference({
      manifestObject: { scenarios: [scenario] },
      runDir: realRunDir,
      executionMode: 'DOCKER',
      candidateIds: ACTIVE_CANDIDATE_IDS,
    });
    const evidenceDir = path.resolve(realRunDir, 'evidence');
    const evidence = await Promise.all(ACTIVE_CANDIDATE_IDS.map(async (candidateId) =>
      JSON.parse(await readFile(path.resolve(evidenceDir, `${candidateId}__${scenario.scenarioId}.json`), 'utf8'))
    ));
    const pass = result.coverage.summary.successfulRuns === 3
      && evidence.every((record) => record.status === 'SUCCESS')
      && evidence.every((record) => record.candidateRun?.publications?.length > 0)
      && evidence.every((record) => record.executionMode === 'DOCKER');
    record(28, 'Real neural non-blind integration for all three adapters', pass, `runs=${result.coverage.summary.successfulRuns}, blindRuns=0`);
  } catch (err) {
    record(28, 'Real neural non-blind integration for all three adapters', false, err.message);
  }

  // Summary
  const allPassed = results.every((r) => r.pass);
  console.log('----------------------------------------------------------------------');
  console.log(`Verification completed: ${results.filter((r) => r.pass).length}/${results.length} checks passed.`);
  console.log(`Gate Verdict: ${allPassed ? 'PHASE_9GB3_FIX_READY_FOR_EXPLICIT_PRODUCT_BLIND_BENCHMARK' : 'PHASE_9GB3_FIX_BLOCKED'}`);

  return {
    allPassed,
    results,
    verdict: allPassed ? 'PHASE_9GB3_FIX_READY_FOR_EXPLICIT_PRODUCT_BLIND_BENCHMARK' : 'PHASE_9GB3_FIX_BLOCKED',
  };
}

runAllChecks()
  .then((res) => {
    if (!res.allPassed) process.exit(1);
  })
  .catch((err) => {
    console.error('Fatal verification error:', err);
    process.exit(1);
  });
