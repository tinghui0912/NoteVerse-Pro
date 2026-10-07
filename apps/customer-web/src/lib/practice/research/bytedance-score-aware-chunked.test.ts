import { describe, expect, it } from 'vitest';

import {
  BYTEDANCE_CHUNKED_BASELINE_CONFIG,
  assertAssetIdentity,
  blockedByteDanceRunArtifact,
  bytedanceCandidateDefinition,
  candidateRunForByteDanceChunks,
  observationsForByteDanceChunk,
  planByteDanceScoreAwareChunks,
  publicationForByteDanceChunk,
  sourceEventTimeToPerformanceTime,
} from './bytedance-score-aware-chunked';
import { buildBakeoffReport, scoreCandidate, type BenchmarkScenario } from './continuous-analyzer-bakeoff';

function scenario(overrides: Partial<BenchmarkScenario> = {}): BenchmarkScenario {
  return {
    scenarioId: 'phase9e-a-planner-fixture',
    schemaVersion: 1,
    split: 'DEVELOPMENT',
    familyTags: ['correct_single', 'complete_chord'],
    source: {
      sourceAudioPath: 'synthetic://phase9e-a.wav',
      sourceAudioSha256: 'synthetic-phase9e-audio',
      sourceMidiPath: 'synthetic://phase9e-a.mid',
      sourceMidiSha256: 'synthetic-phase9e-midi',
      provenance: 'synthetic_phase9e_planner_fixture',
    },
    audio: {
      nativeSampleRateHz: 48_000,
      channelPolicy: 'mono_float32_synthetic',
      clipStartMs: 500,
      clipEndMs: 4_000,
      performanceOriginSourceMs: 1_000,
      sourceDurationMs: 5_000,
      pcmIdentity: 'synthetic-phase9e-pcm',
    },
    expectedStrikes: [
      { strikeId: 'c', groupId: 'single', pitch: 'C4', expectedPerformanceTimeMs: 200, renderNoteIds: ['c'] },
      { strikeId: 'e', groupId: 'chord', pitch: 'E4', expectedPerformanceTimeMs: 700, renderNoteIds: ['e'] },
      { strikeId: 'g', groupId: 'chord', pitch: 'G4', expectedPerformanceTimeMs: 700, renderNoteIds: ['g'] },
      { strikeId: 'd', groupId: 'later', pitch: 'D4', expectedPerformanceTimeMs: 1_400, renderNoteIds: ['d'] },
    ],
    physicalGroundTruth: {
      status: 'RECORDED',
      sourceKind: 'SYNTHETIC_HARNESS',
      source: 'synthetic_phase9e_truth',
      attacks: [
        { physicalEventId: 'c-physical', pitch: 'C4', performanceTimeMs: 200 },
        { physicalEventId: 'e-physical', pitch: 'E4', performanceTimeMs: 700 },
        { physicalEventId: 'g-physical', pitch: 'G4', performanceTimeMs: 700 },
        { physicalEventId: 'd-physical', pitch: 'D4', performanceTimeMs: 1_400 },
      ],
    },
    completion: { kind: 'NATURAL', performanceTimeMs: 2_000 },
    taxonomy: {
      groups: {
        single: ['correct_single'],
        chord: ['complete_chord'],
        later: ['correct_single'],
      },
    },
    corpusOverlapStatus: 'UNKNOWN',
    ...overrides,
  };
}

describe('ByteDance score-aware chunked research adapter', () => {
  it('freezes the research-only ByteDance candidate identity and unvalidated geometry', () => {
    const definition = bytedanceCandidateDefinition({ gitHead: 'test-head' });

    expect(definition).toMatchObject({
      candidateId: 'bytedance-score-aware-chunked-dev-v1',
      strategyKind: 'CHUNKED',
      identity: {
        modelCheckpointSha256: BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelSha256,
        adapterVersion: 'phase9e-a-score-aware-chunked-v1',
        trainingDataOverlapStatus: 'UNKNOWN',
      },
    });
    expect(BYTEDANCE_CHUNKED_BASELINE_CONFIG).toMatchObject({
      modelInputMs: 1820,
      futureContextMs: 220,
      maxCommitWidthMs: 600,
    });
  });

  it('maps source audio time through the benchmark performance origin', () => {
    expect(sourceEventTimeToPerformanceTime(scenario(), 750)).toBe(-250);
    expect(sourceEventTimeToPerformanceTime(scenario(), 1_000)).toBe(0);
    expect(sourceEventTimeToPerformanceTime(scenario(), 1_700)).toBe(700);
  });

  it('plans deterministic non-overlapping commit ownership without splitting simultaneous groups', () => {
    const plans = planByteDanceScoreAwareChunks(scenario());

    expect(plans.length).toBeGreaterThan(1);
    for (let index = 1; index < plans.length; index += 1) {
      expect(plans[index].commitStartPerformanceMs).toBeGreaterThanOrEqual(plans[index - 1].commitEndPerformanceMs);
    }
    expect(plans.flatMap((plan) => plan.expectedGroupIds).filter((groupId) => groupId === 'chord')).toHaveLength(1);
    expect(plans.some((plan) => plan.inputStartPerformanceMs < plan.commitStartPerformanceMs)).toBe(true);
    expect(plans.some((plan) => plan.inputEndPerformanceMs > plan.commitEndPerformanceMs)).toBe(true);
  });

  it('does not use physical truth or family tags for chunk planning', () => {
    const base = planByteDanceScoreAwareChunks(scenario());
    const changedTruth = planByteDanceScoreAwareChunks(scenario({
      familyTags: ['different'],
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'SYNTHETIC_HARNESS',
        source: 'changed_truth',
        attacks: [{ physicalEventId: 'wrong', pitch: 'A4', performanceTimeMs: 1_999 }],
      },
    }));

    expect(changedTruth).toEqual(base);
  });

  it('publishes only model events owned by the chunk commit interval without snapping timestamps', () => {
    const [first] = planByteDanceScoreAwareChunks(scenario());
    const observations = observationsForByteDanceChunk(scenario(), first, [
      { eventId: 'before', pitch: 'C4', performanceTimeMs: first.commitStartPerformanceMs - 1, confidence: 0.9, onsetScore: 0.9, frameScore: 0.9 },
      { eventId: 'inside', pitch: 'C4', performanceTimeMs: first.commitStartPerformanceMs + 123, confidence: 0.8, onsetScore: 0.8, frameScore: 0.8 },
      { eventId: 'boundary', pitch: 'E4', performanceTimeMs: first.commitEndPerformanceMs, confidence: 0.7, onsetScore: 0.7, frameScore: 0.7 },
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      pitch: 'C4',
      performanceTimeMs: first.commitStartPerformanceMs + 123,
      confidence: 0.8,
    });
    expect(observationsForByteDanceChunk(scenario(), first, [
      { eventId: 'inside', pitch: 'C4', performanceTimeMs: first.commitStartPerformanceMs + 123, confidence: 0.8, onsetScore: 0.8, frameScore: 0.8 },
    ])).toEqual(observations);
  });

  it('sets publication coverage to the commit frontier and availability after future context plus inference', () => {
    const [first] = planByteDanceScoreAwareChunks(scenario());
    const publication = publicationForByteDanceChunk({
      scenario: scenario(),
      plan: first,
      observations: [],
      inferenceLatencyMs: 35,
    });

    expect(publication.analyzedThroughPerformanceMs).toBe(first.commitEndPerformanceMs);
    expect(publication.availabilityTimeMs).toBe(first.commitEndPerformanceMs + 220 + 35);
    expect(publication.diagnostics).toMatchObject({
      strategyShape: 'CHUNKED',
      inputStartMs: first.inputStartPerformanceMs,
      inputEndMs: first.inputEndPerformanceMs,
      inferenceLatencyMs: 35,
    });
  });

  it('feeds generated DEVELOPMENT publications through the accepted bake-off scorer without producing an official rank', () => {
    const input = scenario();
    const definition = bytedanceCandidateDefinition({ gitHead: 'test-head' });
    const publications = planByteDanceScoreAwareChunks(input).map((plan) => {
      const observations = observationsForByteDanceChunk(input, plan, input.physicalGroundTruth?.attacks.map((attack) => ({
        eventId: attack.physicalEventId,
        pitch: attack.pitch,
        performanceTimeMs: attack.performanceTimeMs,
        confidence: 1,
        onsetScore: 1,
        frameScore: 1,
      })) ?? []);
      return publicationForByteDanceChunk({ scenario: input, plan, observations, inferenceLatencyMs: 10 });
    });
    const run = candidateRunForByteDanceChunks({
      candidateId: definition.candidateId,
      scenarioId: input.scenarioId,
      publications,
      command: 'synthetic phase9e-a adapter test',
      runtime: 'synthetic',
    });
    const report = buildBakeoffReport({
      scenarios: [input],
      candidateDefinitions: [definition],
      scenarioRuns: [run],
      gitHead: 'test-head',
      command: 'vitest bytedance-score-aware-chunked',
      policy: { policyId: 'phase9e-a-policy', path: 'synthetic-policy.json', schemaVersion: 1, sha256: 'policy-sha' },
      benchmarkManifest: { manifestId: 'phase9e-a-dev', path: 'synthetic-manifest.json', schemaVersion: 1, sha256: 'manifest-sha' },
      dirtyTree: false,
    });
    const score = scoreCandidate(input, definition, run);

    expect(score.candidateEvaluation.status).toBe('COMPLETE');
    expect(report.comparativeOutcome).toBe('INSUFFICIENT_EVALUATION_SET');
    expect(report.resultSummary[definition.candidateId].comparativeRank).toBeNull();
  });

  it('fails closed on source/model identity mismatches and produces blocked artifacts for missing external data', () => {
    expect(() => assertAssetIdentity({
      kind: 'MODEL',
      path: 'model.onnx',
      expectedSha256: 'a'.repeat(64),
      actualSha256: 'b'.repeat(64),
    })).toThrow(/SHA256 mismatch/);
    expect(() => assertAssetIdentity({
      kind: 'AUDIO',
      path: 'source.wav',
      expectedBytes: 10,
      actualBytes: 11,
    })).toThrow(/byte size mismatch/);

    expect(blockedByteDanceRunArtifact({
      missingFiles: [{
        kind: 'MODEL',
        path: 'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx',
        expectedSha256: BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelSha256,
        expectedBytes: BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelBytes,
      }],
      discoveredScenarioCount: 0,
      command: 'npm run phase9e-a:bytedance',
    })).toMatchObject({
      status: 'BLOCKED_NOT_RUN',
      candidateId: BYTEDANCE_CHUNKED_BASELINE_CONFIG.candidateId,
    });
  });
});
