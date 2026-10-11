/**
 * Reusable Candidate Adapters for Phase 9G-B Product Benchmark.
 *
 * Exposes exact frozen execution semantics for:
 * 1. ByteDance Original: CALIBRATED_CONTEXT_5S (5000ms input, 2500ms owned, 1250ms past, 1250ms future, onset 0.20, frame 0.10)
 * 2. Online-AMT: Stateful 512-sample (32ms) hops at 16kHz, timing correction -158ms, native onset boost 2.0
 * 3. Robust Augmented ByteDance: CALIBRATED_CONTEXT_1820 (1820ms input, 600ms commit, 220ms future, onset 0.30, frame 0.05)
 *
 * Implements truth-isolation assertions, causal publication availability timing:
 * inputReadyAtMs -> inferenceStartAtMs -> inferenceFinishAtMs -> availabilityTimeMs,
 * and support for both real Docker container execution and fast synthetic test mode.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const byteDanceModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'));
const onlineAmtModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));

export const CANDIDATE_CONFIGS = {
  'bytedance-original-calibrated-v1': {
    candidateId: 'bytedance-original-calibrated-v1',
    family: 'bytedance-original',
    rank: 1,
    profileId: 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10',
    strategyKind: 'CHUNKED',
    contextGeometry: {
      profileId: 'CALIBRATED_CONTEXT_5S',
      modelInputMs: 5000,
      nominalOwnedRegionMs: 2500,
      interiorPastContextMs: 1250,
      maximumFutureContextMs: 1250,
    },
    thresholds: {
      onsetThreshold: 0.20,
      frameThreshold: 0.10,
    },
    checkpoint: {
      path: 'models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth',
      sha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
      bytes: 171966578,
    },
    dockerImage: 'noteverse-bytedance-calibration:phase9ga21',
    dockerScript: 'backend/scripts/run_bytedance_pytorch_raw_batch.py',
    targetDevice: 'cpu',
    sampleRateHz: 16000,
  },
  'online-amt-calibrated-v1': {
    candidateId: 'online-amt-calibrated-v1',
    family: 'online-amt',
    rank: 2,
    profileId: 'online-amt-stateful-streaming-native-boost-2.0',
    strategyKind: 'STREAMING',
    streaming: {
      sampleRateHz: 16000,
      hopSamples: 512,
      hopMs: 32,
      timingCorrectionMs: -158,
      publishedOnsetBoost: 2.0,
      pseudoIntensityShortcut: 'NATIVE',
    },
    checkpoint: {
      path: 'models/online_amt/stateful/model-180000.pt',
      sha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
      bytes: 178804960,
    },
    dockerImage: 'noteverse-online-amt-modern:phase9e-b1',
    dockerScript: 'backend/research/online_amt/run_online_amt_modern_smoke.py',
    targetDevice: 'cpu',
    sampleRateHz: 16000,
  },
  'bytedance-robust-augmented-calibrated-v1': {
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    family: 'bytedance-robust-augmented',
    rank: 3,
    profileId: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
    strategyKind: 'CHUNKED',
    contextGeometry: {
      profileId: 'CALIBRATED_CONTEXT_1820',
      modelInputMs: 1820,
      nominalOwnedRegionMs: 600,
      maximumFutureContextMs: 220,
    },
    thresholds: {
      onsetThreshold: 0.30,
      frameThreshold: 0.05,
    },
    checkpoint: {
      path: 'models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
      sha256: '08400494cf071fe0e9649b1fa9f1f0a2ca3e77f0d06f69ad93e87834bcabcebe',
      bytes: 171966578,
    },
    dockerImage: 'noteverse-challengers:phase9ga3',
    dockerScript: 'backend/scripts/run_bytedance_robust_pytorch_raw_batch.py',
    targetDevice: 'cuda',
    sampleRateHz: 16000,
  },
};

/**
 * Asserts strict truth isolation: acoustic inference input must not contain
 * ground truth expected strikes, reference MIDI notes, or counterfactual labels.
 */
export function assertTruthIsolation(scenario) {
  if (scenario.expectedStrikes || scenario.expectedEvents || scenario.referenceMidi || scenario.notes || scenario.counterfactualReceipt) {
    throw new Error(`TRUTH_ISOLATION_VIOLATION: Scenario ${scenario.scenarioId} contains ground truth score metadata`);
  }
}

/**
 * Generalized variable-context planner extracted from Phase 9G-A.2.4 calibration.
 * Correctly handles both CALIBRATED_CONTEXT_5S and CALIBRATED_CONTEXT_1820.
 */
export function planByteDanceVariableContext(scenario, context) {
  const completion = scenario.completion?.performanceTimeMs
    ?? scenario.audio?.clipEndMs
    ?? 0;

  if (context.profileId === 'CALIBRATED_CONTEXT_1820') {
    // 1820ms input, 600ms commit, 220ms future context
    const modelInputMs = 1820;
    const commitMs = 600;
    const futureMs = 220;
    const plans = [];
    let start = 0;
    while (start < completion || (completion === 0 && plans.length === 0)) {
      const end = Math.min(completion, start + commitMs);
      plans.push({
        chunkId: `${scenario.scenarioId}:${context.profileId}:window-${plans.length.toString().padStart(3, '0')}`,
        scenarioId: scenario.scenarioId,
        commitStartPerformanceMs: start,
        commitEndPerformanceMs: end,
        inputStartPerformanceMs: end + futureMs - modelInputMs,
        inputEndPerformanceMs: end + futureMs,
        expectedGroupIds: [],
      });
      if (end === completion) break;
      start = end;
    }
    return plans;
  }

  // Generalized planner (e.g. CALIBRATED_CONTEXT_5S: 5000ms input, 2500ms owned, 1250ms future)
  const ownedMs = context.nominalOwnedRegionMs ?? 2500;
  const futureMs = context.maximumFutureContextMs ?? 1250;
  const modelInputMs = context.modelInputMs ?? 5000;
  const plans = [];
  let start = 0;

  while (start < completion || (completion === 0 && plans.length === 0)) {
    const end = Math.min(completion, start + ownedMs);
    plans.push({
      chunkId: `${scenario.scenarioId}:${context.profileId}:window-${plans.length.toString().padStart(3, '0')}`,
      scenarioId: scenario.scenarioId,
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputStartPerformanceMs: end + futureMs - modelInputMs,
      inputEndPerformanceMs: end + futureMs,
      expectedGroupIds: [],
    });
    if (end === completion) break;
    start = end;
  }

  // Validate geometry invariants
  let prevEnd = 0;
  for (const plan of plans) {
    const inputDuration = plan.inputEndPerformanceMs - plan.inputStartPerformanceMs;
    if (Math.abs(inputDuration - modelInputMs) > 1e-9) {
      throw new Error(`ByteDance ${context.profileId} input duration mismatch: expected ${modelInputMs}, got ${inputDuration}`);
    }
    const futureDuration = plan.inputEndPerformanceMs - plan.commitEndPerformanceMs;
    if (futureDuration - futureMs > 1e-9) {
      throw new Error(`ByteDance ${context.profileId} future context exceeds frozen bound: max ${futureMs}, got ${futureDuration}`);
    }
    if (plan.commitStartPerformanceMs !== prevEnd || plan.commitEndPerformanceMs < plan.commitStartPerformanceMs) {
      throw new Error(`ByteDance ${context.profileId} commit ownership is not chronological/non-overlapping`);
    }
    prevEnd = plan.commitEndPerformanceMs;
  }

  return plans;
}

/**
 * ByteDance Original Adapter (5s context: 5000ms input, 2500ms owned, 1250ms past, 1250ms future)
 */
export class ByteDanceOriginalAdapter {
  constructor(config = CANDIDATE_CONFIGS['bytedance-original-calibrated-v1']) {
    this.config = config;
  }

  async runInference(scenario, options = {}) {
    assertTruthIsolation(scenario);
    const executionMode = options.executionMode ?? 'SYNTHETIC';
    const plans = planByteDanceVariableContext(scenario, this.config.contextGeometry);

    if (executionMode === 'DOCKER') {
      return this._runDockerInference(scenario, plans, options);
    }
    return this._runSyntheticInference(scenario, plans, options);
  }

  async _runDockerInference(scenario, plans, options) {
    const workDir = path.resolve(repoRoot, 'backend/data/work/product_benchmark_docker_bytedance');
    await mkdir(workDir, { recursive: true });

    const windows = plans.map((plan) => {
      const originMs = scenario.audio?.performanceOriginSourceMs ?? 0;
      return {
        scenarioId: scenario.scenarioId,
        contextProfileId: this.config.contextGeometry.profileId,
        windowId: plan.chunkId,
        sourceAudioPath: scenario.audio?.sourceAudioPath ?? scenario.source?.sourceAudioPath,
        inputStartSourceMs: originMs + plan.inputStartPerformanceMs,
        inputEndSourceMs: originMs + plan.inputEndPerformanceMs,
        inputSampleCount: Math.round(this.config.contextGeometry.modelInputMs / 1000 * 16000),
      };
    });

    const runHash = createHash('sha256').update(`${scenario.scenarioId}_${Date.now()}`).digest('hex').slice(0, 8);
    const inputPath = path.resolve(workDir, `bytedance_in_${runHash}.json`);
    const outputPath = path.resolve(workDir, `bytedance_out_${runHash}.json`);
    await writeFile(inputPath, JSON.stringify({ windows }, null, 2), 'utf8');

    const dockerArgs = [
      'run', '--rm',
      '--entrypoint', 'python',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      this.config.dockerImage,
      this.config.dockerScript,
      '--input', path.relative(repoRoot, inputPath).replace(/\\/g, '/'),
      '--output', path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
      '--checkpoint', this.config.checkpoint.path,
      '--device', this.config.targetDevice,
      '--runtime-identity', this.config.dockerImage,
    ];

    const run = spawnSync('docker', dockerArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: 25 * 1024 * 1024,
    });

    if (run.status !== 0 || !existsSync(outputPath)) {
      throw new Error(`DOCKER_BYTEDANCE_FAILED:${run.stderr || run.stdout}`);
    }

    const rawData = JSON.parse(await readFile(outputPath, 'utf8'));
    const chunkByWindowId = new Map(rawData.chunks.map((c) => [c.windowId, c]));

    return this._buildCandidateRunFromChunks(scenario, plans, chunkByWindowId, 'docker_bytedance_original');
  }

  _runSyntheticInference(scenario, plans, options) {
    const chunkByWindowId = new Map();
    for (const plan of plans) {
      // Deterministic synthetic observations for fast verification
      const windowLatencyMs = options.simulatedLatencyMs ?? 35;
      const pitch = options.syntheticPitch ?? 'C4';
      chunkByWindowId.set(plan.chunkId, {
        windowId: plan.chunkId,
        inferenceLatencyMs: windowLatencyMs,
        rawOutputs: {
          reg_onset_output: { dims: [1, 500, 88], data: [] },
          frame_output: { dims: [1, 500, 88], data: [] },
        },
        syntheticPitch: pitch,
      });
    }

    return this._buildCandidateRunFromChunks(scenario, plans, chunkByWindowId, 'synthetic_bytedance_original');
  }

  _buildCandidateRunFromChunks(scenario, plans, chunkByWindowId, runtime) {
    const publications = [];
    let previousFinish = 0;

    for (const plan of plans) {
      const chunk = chunkByWindowId.get(plan.chunkId);
      const latency = chunk?.inferenceLatencyMs ?? 35;
      // All required samples exist at inputEndPerformanceMs
      const inputReadyAtMs = plan.inputEndPerformanceMs;
      const inferenceStartAtMs = Math.max(inputReadyAtMs, previousFinish);
      const inferenceFinishAtMs = inferenceStartAtMs + latency;
      previousFinish = inferenceFinishAtMs;

      const observations = [];
      if (chunk?.syntheticPitch) {
        // Synthesize an observation inside the owned commit interval
        const obsTime = Math.max(0, plan.commitStartPerformanceMs + (plan.commitEndPerformanceMs - plan.commitStartPerformanceMs) / 2);
        observations.push({
          observationId: `obs_${plan.chunkId}_0`,
          pitch: chunk.syntheticPitch,
          performanceTimeMs: obsTime,
          confidence: 0.95,
        });
      }

      publications.push({
        publicationId: `pub_${plan.chunkId}`,
        analyzedThroughPerformanceMs: plan.commitEndPerformanceMs,
        availabilityTimeMs: inferenceFinishAtMs,
        requiredFutureContextMs: this.config.contextGeometry.maximumFutureContextMs,
        observations,
        diagnostics: {
          strategyShape: 'CHUNKED',
          inputReadyAtMs,
          inferenceStartAtMs,
          modelInferenceLatencyMs: latency,
          candidateProcessingLatencyMs: latency,
          queueDelayMs: inferenceStartAtMs - inputReadyAtMs,
          availabilityTimeMs: inferenceFinishAtMs,
          publicationDelayMs: inferenceFinishAtMs - plan.commitEndPerformanceMs,
        },
      });
    }

    return {
      candidateId: this.config.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: {
        command: `adapter run ${this.config.candidateId}`,
        runtime,
      },
    };
  }
}

/**
 * Online-AMT Streaming Adapter (Stateful 512-sample hops at 16kHz, -158ms timing correction)
 */
export class OnlineAmtStreamingAdapter {
  constructor(config = CANDIDATE_CONFIGS['online-amt-calibrated-v1']) {
    this.config = config;
  }

  async runInference(scenario, options = {}) {
    assertTruthIsolation(scenario);
    const executionMode = options.executionMode ?? 'SYNTHETIC';

    if (executionMode === 'DOCKER') {
      return this._runDockerInference(scenario, options);
    }
    return this._runSyntheticInference(scenario, options);
  }

  async _runDockerInference(scenario, options) {
    const workDir = path.resolve(repoRoot, 'backend/data/work/product_benchmark_docker_online_amt');
    await mkdir(workDir, { recursive: true });

    const completion = scenario.completion?.performanceTimeMs ?? scenario.audio?.clipEndMs ?? 1000;
    const ownedSamples = Math.floor(completion / 1000 * 16000);
    const tailReq = onlineAmtModule.onlineAmtSegmentTailRequirement(ownedSamples, this.config.streaming.timingCorrectionMs);

    const sourceWavPath = path.resolve(repoRoot, scenario.audio?.sourceAudioPath ?? scenario.source?.sourceAudioPath);
    const wavData = byteDanceModule.decodeResearchWavToMonoFloat32(await readFile(sourceWavPath));

    const originMs = scenario.audio?.performanceOriginSourceMs ?? 0;
    const performancePcm = Array.from(wavData.pcm.slice(0, ownedSamples));
    const tailPcm = Array.from(wavData.pcm.slice(ownedSamples, ownedSamples + tailReq.requiredContextTailSamples));

    const segment = {
      segmentId: `${scenario.scenarioId}:segment-0`,
      performanceStartMs: 0,
      performancePcm16k: performancePcm,
      contextTailPcm16k: tailPcm,
    };

    const runHash = createHash('sha256').update(`${scenario.scenarioId}_${Date.now()}`).digest('hex').slice(0, 8);
    const inputPath = path.resolve(workDir, `online_amt_in_${runHash}.json`);
    const outputPath = path.resolve(workDir, `online_amt_out_${runHash}.json`);
    await writeFile(inputPath, JSON.stringify({ segments: [segment] }, null, 2), 'utf8');

    const dockerArgs = [
      'run', '--rm',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      this.config.dockerImage,
      'python3',
      this.config.dockerScript,
      '--online-amt-repo', '/online_amt',
      '--checkpoint', `/workspace/${this.config.checkpoint.path}`,
      '--segment-input', `/workspace/${path.relative(repoRoot, inputPath).replace(/\\/g, '/')}`,
      '--output', `/workspace/${path.relative(repoRoot, outputPath).replace(/\\/g, '/')}`,
      '--pseudo-intensity', this.config.streaming.pseudoIntensityShortcut,
      '--onset-boost', String(this.config.streaming.publishedOnsetBoost),
    ];

    const run = spawnSync('docker', dockerArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: 25 * 1024 * 1024,
    });

    if (run.status !== 0 || !existsSync(outputPath)) {
      throw new Error(`DOCKER_ONLINE_AMT_FAILED:${run.stderr || run.stdout}`);
    }

    const hopArtifact = JSON.parse(await readFile(outputPath, 'utf8'));

    return onlineAmtModule.runOnlineAmtStreamingCandidateFromHopArtifact({
      scenario,
      artifact: hopArtifact,
      candidateId: this.config.candidateId,
      command: `docker run ${this.config.dockerImage}`,
      runtime: 'real-online-amt-modern-docker',
      timingCorrectionMs: this.config.streaming.timingCorrectionMs,
    });
  }

  _runSyntheticInference(scenario, options) {
    const completion = scenario.completion?.performanceTimeMs ?? scenario.audio?.clipEndMs ?? 1000;
    const hopMs = 32;
    const hopCount = Math.ceil(completion / hopMs);
    const hops = [];

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const generate88 = (activePitch) => Array.from({ length: 88 }, (_, index) => {
      const midi = 21 + index;
      const pitch = `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
      const isActive = activePitch !== null && pitch === activePitch;
      return {
        pitch,
        chosenState: isActive ? 3 : 0,
        probabilities: isActive
          ? [0.01, 0.01, 0.02, 0.90, 0.06]
          : [0.95, 0.01, 0.02, 0.01, 0.01],
      };
    });

    for (let h = 0; h < hopCount; h++) {
      const decisionSample = (h + 1) * 512;
      const activePitch = (options.syntheticPitch && h === Math.floor(hopCount / 2)) ? options.syntheticPitch : null;
      const pitchStates = generate88(activePitch);
      hops.push({
        hopIndex: h,
        localDecisionSample: decisionSample,
        processingLatencyMs: options.simulatedLatencyMs ?? 5,
        pitchStates,
      });
    }

    const artifact = {
      schemaVersion: 1,
      artifact: 'online_amt_real_hop_output',
      segments: [
        {
          segmentId: `${scenario.scenarioId}:segment-0`,
          performanceStartMs: 0,
          performanceOwnedSamples: Math.floor(completion / 1000 * 16000),
          contextTailSamples: 2560,
          hops,
        },
      ],
    };

    return onlineAmtModule.runOnlineAmtStreamingCandidateFromHopArtifact({
      scenario,
      artifact,
      candidateId: this.config.candidateId,
      command: 'synthetic online-amt',
      runtime: 'synthetic-online-amt-stateful',
      timingCorrectionMs: this.config.streaming.timingCorrectionMs,
    });
  }
}

/**
 * Robust Augmented ByteDance Adapter (CALIBRATED_CONTEXT_1820: 1820ms input, 600ms commit, 220ms future)
 */
export class RobustByteDanceAdapter {
  constructor(config = CANDIDATE_CONFIGS['bytedance-robust-augmented-calibrated-v1']) {
    this.config = config;
  }

  async runInference(scenario, options = {}) {
    assertTruthIsolation(scenario);
    const executionMode = options.executionMode ?? 'SYNTHETIC';
    const plans = planByteDanceVariableContext(scenario, this.config.contextGeometry);

    if (executionMode === 'DOCKER') {
      return this._runDockerInference(scenario, plans, options);
    }
    return this._runSyntheticInference(scenario, plans, options);
  }

  async _runDockerInference(scenario, plans, options) {
    const workDir = path.resolve(repoRoot, 'backend/data/work/product_benchmark_docker_robust');
    await mkdir(workDir, { recursive: true });

    const windows = plans.map((plan) => {
      const originMs = scenario.audio?.performanceOriginSourceMs ?? 0;
      return {
        scenarioId: scenario.scenarioId,
        contextProfileId: this.config.contextGeometry.profileId,
        windowId: plan.chunkId,
        sourceAudioPath: scenario.audio?.sourceAudioPath ?? scenario.source?.sourceAudioPath,
        inputStartSourceMs: originMs + plan.inputStartPerformanceMs,
        inputEndSourceMs: originMs + plan.inputEndPerformanceMs,
        inputSampleCount: Math.round(this.config.contextGeometry.modelInputMs / 1000 * 16000),
      };
    });

    const runHash = createHash('sha256').update(`${scenario.scenarioId}_${Date.now()}`).digest('hex').slice(0, 8);
    const inputPath = path.resolve(workDir, `robust_in_${runHash}.json`);
    const outputPath = path.resolve(workDir, `robust_out_${runHash}.json`);
    await writeFile(inputPath, JSON.stringify({ windows }, null, 2), 'utf8');

    const dockerArgs = [
      'run', '--rm',
      '--entrypoint', 'python',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      this.config.dockerImage,
      this.config.dockerScript,
      '--input', path.relative(repoRoot, inputPath).replace(/\\/g, '/'),
      '--output', path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
      '--checkpoint', this.config.checkpoint.path,
      '--device', this.config.targetDevice,
      '--runtime-identity', this.config.dockerImage,
    ];

    const run = spawnSync('docker', dockerArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: 25 * 1024 * 1024,
    });

    if (run.status !== 0 || !existsSync(outputPath)) {
      throw new Error(`DOCKER_ROBUST_BYTEDANCE_FAILED:${run.stderr || run.stdout}`);
    }

    const rawData = JSON.parse(await readFile(outputPath, 'utf8'));
    const chunkByWindowId = new Map(rawData.chunks.map((c) => [c.windowId, c]));

    return this._buildCandidateRunFromChunks(scenario, plans, chunkByWindowId, 'docker_bytedance_robust');
  }

  _runSyntheticInference(scenario, plans, options) {
    const chunkByWindowId = new Map();
    for (const plan of plans) {
      const windowLatencyMs = options.simulatedLatencyMs ?? 20;
      const pitch = options.syntheticPitch ?? 'C4';
      chunkByWindowId.set(plan.chunkId, {
        windowId: plan.chunkId,
        inferenceLatencyMs: windowLatencyMs,
        syntheticPitch: pitch,
      });
    }

    return this._buildCandidateRunFromChunks(scenario, plans, chunkByWindowId, 'synthetic_bytedance_robust');
  }

  _buildCandidateRunFromChunks(scenario, plans, chunkByWindowId, runtime) {
    const publications = [];
    let previousFinish = 0;

    for (const plan of plans) {
      const chunk = chunkByWindowId.get(plan.chunkId);
      const latency = chunk?.inferenceLatencyMs ?? 20;
      const inputReadyAtMs = plan.inputEndPerformanceMs;
      const inferenceStartAtMs = Math.max(inputReadyAtMs, previousFinish);
      const inferenceFinishAtMs = inferenceStartAtMs + latency;
      previousFinish = inferenceFinishAtMs;

      const observations = [];
      if (chunk?.syntheticPitch) {
        const obsTime = Math.max(0, plan.commitStartPerformanceMs + (plan.commitEndPerformanceMs - plan.commitStartPerformanceMs) / 2);
        observations.push({
          observationId: `obs_${plan.chunkId}_0`,
          pitch: chunk.syntheticPitch,
          performanceTimeMs: obsTime,
          confidence: 0.95,
        });
      }

      publications.push({
        publicationId: `pub_${plan.chunkId}`,
        analyzedThroughPerformanceMs: plan.commitEndPerformanceMs,
        availabilityTimeMs: inferenceFinishAtMs,
        requiredFutureContextMs: this.config.contextGeometry.maximumFutureContextMs,
        observations,
        diagnostics: {
          strategyShape: 'CHUNKED',
          inputReadyAtMs,
          inferenceStartAtMs,
          modelInferenceLatencyMs: latency,
          candidateProcessingLatencyMs: latency,
          queueDelayMs: inferenceStartAtMs - inputReadyAtMs,
          availabilityTimeMs: inferenceFinishAtMs,
          publicationDelayMs: inferenceFinishAtMs - plan.commitEndPerformanceMs,
        },
      });
    }

    return {
      candidateId: this.config.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: {
        command: `adapter run ${this.config.candidateId}`,
        runtime,
      },
    };
  }
}

/**
 * Factory creating candidate adapter by frozen candidate ID.
 */
export function createCandidateAdapter(candidateId) {
  switch (candidateId) {
    case 'bytedance-original-calibrated-v1':
      return new ByteDanceOriginalAdapter();
    case 'online-amt-calibrated-v1':
      return new OnlineAmtStreamingAdapter();
    case 'bytedance-robust-augmented-calibrated-v1':
      return new RobustByteDanceAdapter();
    default:
      throw new Error(`UNKNOWN_CANDIDATE_ID:${candidateId}`);
  }
}
