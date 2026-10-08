import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildBakeoffReport, scoreCandidate, type BenchmarkScenario } from './continuous-analyzer-bakeoff';
import {
  ONLINE_AMT_STREAMING_BASELINE_CONFIG,
  assertOnlineAmtAssetIdentity,
  eventTimeFromSegmentLocalDecisionMs,
  eventTimeFromDecisionTimeMs,
  observationsForOnlineAmtHop,
  onlineAmtCandidateDefinition,
  onlineAmtConfigurationSha256,
  onlineAmtExecutionProfileSha256,
  onlineAmtSegmentTailRequirement,
  parseOnlineAmtPythonHopArtifact,
  runOnlineAmtStreamingCandidate,
  runOnlineAmtStreamingCandidateFromHopArtifact,
  validateOnlineAmtSegments,
  type OnlineAmtHopOutput,
  type OnlineAmtSegment,
  type OnlineAmtStreamingEngine,
} from './online-amt-stateful-streaming';

function scenario(): BenchmarkScenario {
  return {
    scenarioId: 'online-amt-streaming-smoke',
    schemaVersion: 1,
    split: 'DEVELOPMENT',
    familyTags: ['pipeline_smoke_only'],
    source: {
      sourceAudioPath: 'synthetic://online-amt.wav',
      sourceAudioSha256: 'synthetic-audio',
      provenance: 'PIPELINE_INTEGRATION_SMOKE_ONLY',
    },
    audio: {
      nativeSampleRateHz: 16_000,
      channelPolicy: 'mono_float32_synthetic',
      clipStartMs: 0,
      clipEndMs: 1_000,
      performanceOriginSourceMs: 0,
      sourceDurationMs: 1_000,
      pcmIdentity: 'synthetic-pcm',
    },
    expectedStrikes: [
      { strikeId: 'c4', groupId: 'g1', pitch: 'C4', expectedPerformanceTimeMs: 130, renderNoteIds: ['c4'] },
    ],
    physicalGroundTruth: {
      status: 'RECORDED',
      sourceKind: 'SYNTHETIC_HARNESS',
      source: 'synthetic',
      attacks: [{ physicalEventId: 'c4-physical', pitch: 'C4', performanceTimeMs: 130 }],
    },
    completion: { kind: 'NATURAL', performanceTimeMs: 260 },
    corpusOverlapStatus: 'UNKNOWN',
  };
}

class MockStatefulOnlineAmtEngine implements OnlineAmtStreamingEngine {
  resets = 0;
  state = 0;

  reset(): void {
    this.resets += 1;
    this.state = 0;
  }

  processHop(pcm512: Float32Array): OnlineAmtHopOutput {
    const energy = pcm512.reduce((sum, value) => sum + value, 0);
    this.state += energy + 1;
    const onset = this.state > 4 ? 0.8 : 0.05;
    return {
      processingLatencyMs: 40,
      pitchStates: [{
        pitch: this.state > 6 ? 'C#4' : 'C4',
        chosenState: onset > 0.2 ? 3 : 2,
        probabilities: [0.01, 0.02, 0.1, onset, 0.05],
      }],
    };
  }
}

function segment(input: {
  segmentId?: string;
  performanceStartMs?: number;
  performanceSamples?: number;
  contextSamples?: number;
  fill?: number;
} = {}): OnlineAmtSegment {
  return {
    segmentId: input.segmentId ?? 'seg-0',
    performanceStartMs: input.performanceStartMs ?? 0,
    performancePcm16k: new Float32Array(input.performanceSamples ?? 512 * 8).fill(input.fill ?? 0.5),
    contextTailPcm16k: new Float32Array(input.contextSamples ?? 0).fill(input.fill ?? 0.5),
  };
}

describe('Online-AMT stateful streaming research adapter', () => {
  it('freezes candidate identity, model semantics, and separate execution profile', () => {
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });

    expect(definition).toMatchObject({
      candidateId: 'online-amt-stateful-modern-compat-dev-v1',
      strategyKind: 'STREAMING',
      identity: {
        modelCheckpointSha256: ONLINE_AMT_STREAMING_BASELINE_CONFIG.checkpointSha256,
        trainingDataOverlapStatus: 'UNKNOWN',
      },
    });
    expect(ONLINE_AMT_STREAMING_BASELINE_CONFIG).toMatchObject({
      repoCommit: 'ad12550909a1d86f699097d11885f427054a5ac2',
      sampleRateHz: 16_000,
      hopSamples: 512,
      hopMs: 32,
      timingCorrectionMs: -158,
      publishedOnsetBoost: 2,
      pseudoIntensityShortcut: 'DISABLED',
      onsetStateIds: [3, 4],
    });
    expect(onlineAmtConfigurationSha256()).toMatch(/^[a-f0-9]{64}$/);
    expect(onlineAmtExecutionProfileSha256()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed on repo or checkpoint identity mismatch', () => {
    expect(() => assertOnlineAmtAssetIdentity({
      expectedRepoCommit: ONLINE_AMT_STREAMING_BASELINE_CONFIG.repoCommit,
      actualRepoCommit: 'wrong',
    })).toThrow(/repo commit/);
    expect(() => assertOnlineAmtAssetIdentity({
      expectedCheckpointSha256: ONLINE_AMT_STREAMING_BASELINE_CONFIG.checkpointSha256,
    })).toThrow(/missing/);
    expect(() => assertOnlineAmtAssetIdentity({
      expectedCheckpointBytes: ONLINE_AMT_STREAMING_BASELINE_CONFIG.checkpointBytes,
    })).toThrow(/byte size missing/);
  });

  it('keeps event time, coverage time, and availability time separate', () => {
    expect(eventTimeFromDecisionTimeMs(160)).toBe(2);
    expect(eventTimeFromDecisionTimeMs(32)).toBe(-126);
    const observations = observationsForOnlineAmtHop({
      scenarioId: 's',
      segmentId: 'seg',
      hopIndex: 0,
      decisionTimeMs: 160,
      previousCoverage: 1,
      pitchStates: [{
        pitch: 'D4',
        chosenState: 4,
        probabilities: [0, 0, 0, 0.25, 0.5],
      }],
    });
    expect(observations).toEqual([
      expect.objectContaining({ pitch: 'D4', performanceTimeMs: 2, confidence: 0.75 }),
    ]);
  });

  it('drops negative startup event times without snapping to score time', () => {
    const observations = observationsForOnlineAmtHop({
      scenarioId: 's',
      segmentId: 'seg',
      hopIndex: 0,
      decisionTimeMs: 32,
      previousCoverage: -Infinity,
      pitchStates: [{
        pitch: 'C4',
        chosenState: 3,
        probabilities: [0, 0, 0, 0.5, 0.1],
      }],
    });
    expect(observations).toEqual([]);
  });

  it('restarts startup suppression for every resumed segment', () => {
    expect(eventTimeFromSegmentLocalDecisionMs(300, 32)).toBe(174);
    const observations = observationsForOnlineAmtHop({
      scenarioId: 's',
      segmentId: 'seg-1',
      hopIndex: 0,
      segmentPerformanceStartMs: 300,
      segmentPerformanceEndMs: 500,
      localDecisionTimeMs: 32,
      previousCoverage: 300,
      pitchStates: [{
        pitch: 'C4',
        chosenState: 3,
        probabilities: [0, 0, 0, 0.7, 0.1],
      }],
    });
    expect(observations).toEqual([]);
  });

  it('computes required real context tail with hop alignment', () => {
    expect(onlineAmtSegmentTailRequirement(16_000)).toEqual({
      correctionDelaySamples: 2528,
      requiredProcessedSamples: 18_944,
      requiredContextTailSamples: 2_944,
    });
    expect(onlineAmtSegmentTailRequirement(513).requiredContextTailSamples).toBe(2_559);
  });

  it('keeps performance PCM and context tail ownership separate', () => {
    const diagnostics = validateOnlineAmtSegments(scenario(), [
      segment({ performanceSamples: 512, contextSamples: 4096 }),
    ]);
    expect(diagnostics[0]).toMatchObject({
      performanceOwnedSamples: 512,
      availableContextTailSamples: 4096,
      segmentPerformanceEndMs: 32,
      coverageComplete: true,
    });
  });

  it('leaves coverage incomplete when real context tail cannot close the delayed frontier', () => {
    const longScenario = {
      ...scenario(),
      completion: { kind: 'NATURAL' as const, performanceTimeMs: 1_200 },
      audio: { ...scenario().audio, clipEndMs: 1_200, sourceDurationMs: 1_200 },
    };
    const diagnostics = validateOnlineAmtSegments(longScenario, [
      segment({ performanceSamples: 16_000, contextSamples: 0 }),
    ]);
    expect(diagnostics[0].requiredContextTailSamples).toBeGreaterThan(0);
    expect(diagnostics[0].coverageComplete).toBe(false);
    expect(diagnostics[0].lastSafeCoverageMs).toBeLessThan(diagnostics[0].segmentPerformanceEndMs);
  });

  it('preserves continuous state, resets at segment boundaries, and creates valid publications', () => {
    const engine = new MockStatefulOnlineAmtEngine();
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const run = runOnlineAmtStreamingCandidate({
      scenario: scenario(),
      segments: [segment({ performanceSamples: 512 * 8, contextSamples: 4096 })],
      engine,
      candidateId: definition.candidateId,
      command: 'vitest online-amt streaming smoke',
      runtime: 'mock-stateful',
    });

    expect(engine.resets).toBe(1);
    expect(run.publications.length).toBeGreaterThan(0);
    expect(run.publications.every((publication, index, all) => (
      index === 0 || publication.analyzedThroughPerformanceMs >= all[index - 1].analyzedThroughPerformanceMs
    ))).toBe(true);
    expect(run.publications.some((publication) => publication.observations.some((event) => event.pitch === 'C#4'))).toBe(true);
    expect(run.publications[1].diagnostics?.queueDelayMs).toBeGreaterThanOrEqual(0);
    expect(() => scoreCandidate(scenario(), definition, run)).not.toThrow();
  });

  it('uses real context tail to emit delayed events inside performance ownership', () => {
    const engine = new MockStatefulOnlineAmtEngine();
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const run = runOnlineAmtStreamingCandidate({
      scenario: scenario(),
      segments: [segment({ performanceSamples: 512, contextSamples: 4096 })],
      engine,
      candidateId: definition.candidateId,
      command: 'tail smoke',
      runtime: 'mock-stateful',
    });

    expect(run.publications.at(-1)?.analyzedThroughPerformanceMs).toBe(32);
    expect(run.publications.flatMap((publication) => publication.observations).every((event) => event.performanceTimeMs <= 32)).toBe(true);
  });

  it('accumulates queue delay when stateful processing is slower than hop cadence', () => {
    const engine = new MockStatefulOnlineAmtEngine();
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const run = runOnlineAmtStreamingCandidate({
      scenario: scenario(),
      segments: [segment({ performanceSamples: 512 * 8, contextSamples: 4096 })],
      engine,
      candidateId: definition.candidateId,
      command: 'queue smoke',
      runtime: 'mock-stateful',
    });
    const delays = run.publications.map((publication) => publication.diagnostics?.queueDelayMs ?? 0);
    expect(Math.max(...delays)).toBeGreaterThan(0);
  });

  it('resets recurrent state exactly once per segment and reset replay is deterministic', () => {
    const first = new MockStatefulOnlineAmtEngine();
    const second = new MockStatefulOnlineAmtEngine();
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const segments = [
      segment({ segmentId: 'seg-0', performanceStartMs: 0, performanceSamples: 512 * 4, contextSamples: 4096 }),
      segment({ segmentId: 'seg-1', performanceStartMs: 300, performanceSamples: 512 * 4, contextSamples: 4096 }),
    ];
    const resetScenario = {
      ...scenario(),
      completion: { kind: 'NATURAL' as const, performanceTimeMs: 600 },
      audio: { ...scenario().audio, clipEndMs: 600, sourceDurationMs: 600 },
    };
    const runA = runOnlineAmtStreamingCandidate({
      scenario: resetScenario,
      segments,
      engine: first,
      candidateId: definition.candidateId,
      command: 'reset A',
      runtime: 'mock-stateful',
    });
    const runB = runOnlineAmtStreamingCandidate({
      scenario: resetScenario,
      segments,
      engine: second,
      candidateId: definition.candidateId,
      command: 'reset B',
      runtime: 'mock-stateful',
    });
    expect(first.resets).toBe(2);
    expect(runB.publications).toEqual(runA.publications);
    expect(runA.publications.every((publication) => publication.availabilityTimeMs === undefined)).toBe(true);
  });

  it('rejects segment ordering, duplicate IDs, non-finite PCM, and manual-stop ownership overflow', () => {
    expect(() => validateOnlineAmtSegments(scenario(), [
      segment({ segmentId: 'dup', performanceStartMs: 0, performanceSamples: 512 }),
      segment({ segmentId: 'dup', performanceStartMs: 40, performanceSamples: 512 }),
    ])).toThrow(/unique/);
    expect(() => validateOnlineAmtSegments(scenario(), [
      segment({ segmentId: 'a', performanceStartMs: 100, performanceSamples: 512 }),
      segment({ segmentId: 'b', performanceStartMs: 110, performanceSamples: 512 }),
    ])).toThrow(/overlap/);
    const bad = segment({ performanceSamples: 512 });
    bad.performancePcm16k[0] = Number.NaN;
    expect(() => validateOnlineAmtSegments(scenario(), [bad])).toThrow(/finite/);
    expect(() => validateOnlineAmtSegments(scenario(), [
      segment({ performanceStartMs: 240, performanceSamples: 512 }),
    ])).toThrow(/completion/);
  });

  it('bridges real Python hop artifacts into canonical publications and rejects malformed output', () => {
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const artifact = parseOnlineAmtPythonHopArtifact({
      schemaVersion: 1,
      artifact: 'online_amt_real_hop_output',
      segments: [{
        segmentId: 'seg-0',
        performanceStartMs: 0,
        performanceOwnedSamples: 512 * 6,
        contextTailSamples: 4096,
        hops: [{
          hopIndex: 5,
          localDecisionSample: 512 * 6,
          processingLatencyMs: 5,
          pitchStates: [{
            pitch: 'F#4',
            chosenState: 4,
            probabilities: [0.1, 0.1, 0.1, 0.25, 0.5],
          }],
        }],
      }],
    });
    const run = runOnlineAmtStreamingCandidateFromHopArtifact({
      scenario: scenario(),
      artifact,
      candidateId: definition.candidateId,
      command: 'python artifact smoke',
      runtime: 'docker-online-amt-modern',
    });
    expect(run.publications[0].observations[0]).toMatchObject({
      pitch: 'F#4',
      performanceTimeMs: 34,
      confidence: 0.75,
    });
    expect(() => parseOnlineAmtPythonHopArtifact({
      ...artifact,
      segments: [{
        ...artifact.segments[0],
        hops: [{ ...artifact.segments[0].hops[0], pitchStates: [{ pitch: 'C4', chosenState: 3, probabilities: [0, Number.NaN, 0, 0, 0] }] }],
      }],
    })).toThrow(/finite/);
  });

  it('bridges the real Docker smoke artifact through the authoritative TypeScript adapter when present', () => {
    const artifactPath = resolve(process.cwd(), '../../backend/data/work/online_amt/phase9e_b1_runtime_smoke.json');
    if (!existsSync(artifactPath)) {
      expect(true).toBe(true);
      return;
    }
    const smoke = JSON.parse(readFileSync(artifactPath, 'utf8')) as { hopArtifact: unknown };
    const artifact = parseOnlineAmtPythonHopArtifact(smoke.hopArtifact);
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const smokeScenario = {
      ...scenario(),
      scenarioId: 'online-amt-real-docker-smoke-not-product',
      completion: { kind: 'NATURAL' as const, performanceTimeMs: 1_024 },
      audio: { ...scenario().audio, clipEndMs: 1_024, sourceDurationMs: 1_024 },
      physicalGroundTruth: {
        status: 'RECORDED' as const,
        sourceKind: 'SYNTHETIC_HARNESS' as const,
        source: 'docker-runtime-smoke',
        attacks: [],
      },
    };
    const run = runOnlineAmtStreamingCandidateFromHopArtifact({
      scenario: smokeScenario,
      artifact,
      candidateId: definition.candidateId,
      command: 'docker online-amt real smoke',
      runtime: 'docker-online-amt-modern',
    });
    expect(run.publications.length).toBeGreaterThan(0);
    expect(run.publications.every((publication) => publication.analyzedThroughPerformanceMs >= 0)).toBe(true);
    expect(() => scoreCandidate(smokeScenario, definition, run)).not.toThrow();
  });

  it('does not count synthetic streaming smoke as DEVELOPMENT metrics or ranking', () => {
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const report = buildBakeoffReport({
      scenarios: [],
      candidateDefinitions: [definition],
      scenarioRuns: [],
      gitHead: 'test-head',
      command: 'vitest online-amt',
      policy: { policyId: 'online-amt-phase9e-b', path: 'synthetic-policy.json', schemaVersion: 1, sha256: 'policy' },
      benchmarkManifest: { manifestId: 'online-amt-dev', path: 'synthetic-manifest.json', schemaVersion: 1, sha256: 'manifest' },
      dirtyTree: false,
    });
    expect(report.comparativeOutcome).toBe('INSUFFICIENT_EVALUATION_SET');
    expect(report.resultSummary[definition.candidateId].comparativeRank).toBeNull();
  });
});
