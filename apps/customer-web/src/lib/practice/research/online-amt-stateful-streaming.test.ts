import { describe, expect, it } from 'vitest';

import { buildBakeoffReport, scoreCandidate, type BenchmarkScenario } from './continuous-analyzer-bakeoff';
import {
  ONLINE_AMT_STREAMING_BASELINE_CONFIG,
  assertOnlineAmtAssetIdentity,
  eventTimeFromDecisionTimeMs,
  observationsForOnlineAmtHop,
  onlineAmtCandidateDefinition,
  onlineAmtConfigurationSha256,
  onlineAmtExecutionProfileSha256,
  runOnlineAmtStreamingCandidate,
  type OnlineAmtHopOutput,
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

  it('preserves continuous state, resets at segment boundaries, and creates valid publications', () => {
    const engine = new MockStatefulOnlineAmtEngine();
    const pcm = new Float32Array(512 * 8).fill(0.5);
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const run = runOnlineAmtStreamingCandidate({
      scenario: scenario(),
      segments: [{ segmentId: 'seg-0', performanceStartMs: 0, pcm16k: pcm }],
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

  it('accumulates queue delay when stateful processing is slower than hop cadence', () => {
    const engine = new MockStatefulOnlineAmtEngine();
    const definition = onlineAmtCandidateDefinition({ gitHead: 'test-head' });
    const run = runOnlineAmtStreamingCandidate({
      scenario: scenario(),
      segments: [{ segmentId: 'seg-0', performanceStartMs: 0, pcm16k: new Float32Array(512 * 8).fill(0.5) }],
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
      { segmentId: 'seg-0', performanceStartMs: 0, pcm16k: new Float32Array(512 * 4).fill(0.5) },
      { segmentId: 'seg-1', performanceStartMs: 300, pcm16k: new Float32Array(512 * 4).fill(0.5) },
    ];
    const runA = runOnlineAmtStreamingCandidate({
      scenario: scenario(),
      segments,
      engine: first,
      candidateId: definition.candidateId,
      command: 'reset A',
      runtime: 'mock-stateful',
    });
    const runB = runOnlineAmtStreamingCandidate({
      scenario: scenario(),
      segments,
      engine: second,
      candidateId: definition.candidateId,
      command: 'reset B',
      runtime: 'mock-stateful',
    });
    expect(first.resets).toBe(2);
    expect(runB.publications).toEqual(runA.publications);
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
