import { describe, expect, it } from 'vitest';

import {
  BYTEDANCE_CHUNKED_BASELINE_CONFIG,
  assertAssetIdentity,
  auditCausalCaseEligibility,
  blockedByteDanceRunArtifact,
  bytedanceConfigurationSha256,
  bytedanceCandidateDefinition,
  candidateRunForByteDanceChunks,
  decodeByteDanceChunkRawOutputs,
  executeByteDanceScenarioWithExecutor,
  extractAndResampleLinear16k,
  observationsForByteDanceChunk,
  planByteDanceScoreAwareChunks,
  publicationForByteDanceChunk,
  sourceEventTimeToPerformanceTime,
  validateByteDanceSourceContext,
  validateChunkPlan,
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
      clipStartMs: 0,
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
    expect(definition.identity.configurationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bytedanceConfigurationSha256()).toBe(definition.identity.configurationSha256);
    expect(() => bytedanceCandidateDefinition({ gitHead: 'test-head', configurationSha256: 'not-a-sha' }))
      .toThrow(/configurationSha256/);
  });

  it('maps source audio time through the benchmark performance origin', () => {
    expect(sourceEventTimeToPerformanceTime(scenario(), 750)).toBe(-250);
    expect(sourceEventTimeToPerformanceTime(scenario(), 1_000)).toBe(0);
    expect(sourceEventTimeToPerformanceTime(scenario(), 1_700)).toBe(700);
  });

  it('plans deterministic non-overlapping commit ownership without splitting simultaneous groups', () => {
    const plans = planByteDanceScoreAwareChunks(scenario());

    expect(() => validateChunkPlan(scenario(), plans)).not.toThrow();
    expect(plans.length).toBeGreaterThan(1);
    for (let index = 1; index < plans.length; index += 1) {
      expect(plans[index].commitStartPerformanceMs).toBeGreaterThanOrEqual(plans[index - 1].commitEndPerformanceMs);
    }
    expect(plans.flatMap((plan) => plan.expectedGroupIds).filter((groupId) => groupId === 'chord')).toHaveLength(1);
    expect(plans.some((plan) => plan.inputStartPerformanceMs < plan.commitStartPerformanceMs)).toBe(true);
    expect(plans.some((plan) => plan.inputEndPerformanceMs > plan.commitEndPerformanceMs)).toBe(true);
    for (const plan of plans) {
      expect(plan.commitEndPerformanceMs - plan.commitStartPerformanceMs).toBeLessThanOrEqual(600);
      expect(plan.inputEndPerformanceMs - plan.inputStartPerformanceMs).toBe(1820);
    }
    expect(plans[0]).toMatchObject({ commitStartPerformanceMs: 0, commitEndPerformanceMs: 600 });
  });

  it('covers sparse score gaps with filler chunks that may contain zero ExpectedStrike groups', () => {
    const sparse = scenario({
      completion: { kind: 'NATURAL', performanceTimeMs: 4_000 },
      audio: { ...scenario().audio, clipEndMs: 6_000, sourceDurationMs: 6_000 },
      expectedStrikes: [
        { strikeId: 'start', groupId: 'start', pitch: 'C4', expectedPerformanceTimeMs: 100, renderNoteIds: ['start'] },
        { strikeId: 'late', groupId: 'late', pitch: 'C5', expectedPerformanceTimeMs: 3_500, renderNoteIds: ['late'] },
      ],
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'SYNTHETIC_HARNESS',
        source: 'sparse_truth',
        attacks: [
          { physicalEventId: 'start', pitch: 'C4', performanceTimeMs: 100 },
          { physicalEventId: 'late', pitch: 'C5', performanceTimeMs: 3_500 },
        ],
      },
    });
    const plans = planByteDanceScoreAwareChunks(sparse);

    expect(plans.some((plan) => plan.expectedGroupIds.length === 0)).toBe(true);
    expect(plans[0].commitStartPerformanceMs).toBe(0);
    expect(plans.at(-1)?.commitEndPerformanceMs).toBe(4_000);
    for (let index = 1; index < plans.length; index += 1) {
      expect(plans[index].commitStartPerformanceMs).toBe(plans[index - 1].commitEndPerformanceMs);
    }
  });

  it('plans no PCM ownership after manual Stop while preserving future strikes for NOT_REACHED', () => {
    const manual = scenario({
      completion: { kind: 'MANUAL', performanceTimeMs: 1_000 },
      expectedStrikes: [
        { strikeId: 'played', groupId: 'played', pitch: 'C4', expectedPerformanceTimeMs: 500, renderNoteIds: ['played'] },
        { strikeId: 'future', groupId: 'future', pitch: 'D4', expectedPerformanceTimeMs: 1_500, renderNoteIds: ['future'] },
      ],
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'SYNTHETIC_HARNESS',
        source: 'manual_truth',
        attacks: [{ physicalEventId: 'played', pitch: 'C4', performanceTimeMs: 500 }],
      },
    });

    const plans = planByteDanceScoreAwareChunks(manual);
    expect(plans.at(-1)?.commitEndPerformanceMs).toBe(1_000);
    expect(plans.flatMap((plan) => plan.expectedGroupIds)).not.toContain('future');
    expect(manual.expectedStrikes.map((strike) => strike.groupId)).toContain('future');
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

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      pitch: 'C4',
      performanceTimeMs: first.commitStartPerformanceMs + 123,
      confidence: 0.8,
    });
    const repeated = observationsForByteDanceChunk(scenario(), first, [
      { eventId: 'inside', pitch: 'C4', performanceTimeMs: first.commitStartPerformanceMs + 123, confidence: 0.8, onsetScore: 0.8, frameScore: 0.8 },
    ]);
    expect(repeated[0]).toEqual(observations[0]);
  });

  it('publishes an adjacent-frontier event exactly once without late-evidence rejection', () => {
    const input = scenario({
      expectedStrikes: [
        { strikeId: 'boundary', groupId: 'boundary', pitch: 'E4', expectedPerformanceTimeMs: 600, renderNoteIds: ['boundary'] },
        { strikeId: 'later', groupId: 'later', pitch: 'G4', expectedPerformanceTimeMs: 1_200, renderNoteIds: ['later'] },
      ],
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'SYNTHETIC_HARNESS',
        source: 'boundary_truth',
        attacks: [
          { physicalEventId: 'boundary', pitch: 'E4', performanceTimeMs: 600 },
          { physicalEventId: 'later', pitch: 'G4', performanceTimeMs: 1_200 },
        ],
      },
    });
    const plans = planByteDanceScoreAwareChunks(input);
    const event = { eventId: 'boundary-event', pitch: 'E4', performanceTimeMs: 600, confidence: 1, onsetScore: 1, frameScore: 1 };
    const publications = plans.map((plan) => publicationForByteDanceChunk({
      scenario: input,
      plan,
      observations: observationsForByteDanceChunk(input, plan, [event]),
      inferenceLatencyMs: 0,
    }));
    const allObservations = publications.flatMap((publication) => publication.observations);
    const definition = bytedanceCandidateDefinition({ gitHead: 'test-head' });
    const run = candidateRunForByteDanceChunks({
      candidateId: definition.candidateId,
      scenarioId: input.scenarioId,
      publications,
      command: 'boundary test',
      runtime: 'synthetic',
    });

    expect(allObservations).toHaveLength(1);
    expect(() => scoreCandidate(input, definition, run)).not.toThrow();
  });

  it('sets publication coverage to the commit frontier and availability from actual input end', () => {
    const [first] = planByteDanceScoreAwareChunks(scenario());
    const publication = publicationForByteDanceChunk({
      scenario: scenario(),
      plan: first,
      observations: [],
      inferenceLatencyMs: 35,
    });

    expect(publication.analyzedThroughPerformanceMs).toBe(first.commitEndPerformanceMs);
    expect(publication.availabilityTimeMs).toBe(first.inputEndPerformanceMs + 35);
    expect(publication.diagnostics).toMatchObject({
      strategyShape: 'CHUNKED',
      inputStartMs: first.inputStartPerformanceMs,
      inputEndMs: first.inputEndPerformanceMs,
      inferenceLatencyMs: 35,
      requiredFutureContextMs: first.inputEndPerformanceMs - first.commitEndPerformanceMs,
      modelInferenceLatencyMs: 35,
      totalPublicationDelayMs: (first.inputEndPerformanceMs + 35) - first.commitEndPerformanceMs,
    });
  });

  it('fails closed when ByteDance source context is unavailable', () => {
    const plans = planByteDanceScoreAwareChunks(scenario());
    expect(() => validateByteDanceSourceContext(scenario(), plans)).not.toThrow();
    expect(() => validateByteDanceSourceContext(scenario({
      audio: { ...scenario().audio, clipStartMs: 500 },
    }), plans)).toThrow(/pre-roll/);
    expect(() => validateByteDanceSourceContext(scenario({
      audio: { ...scenario().audio, clipEndMs: 2_000, sourceDurationMs: 4_000 },
    }), plans)).toThrow(/full owned performance interval|post-roll/);
  });

  it('decodes raw ByteDance outputs into generic events and retains wrong pitches', () => {
    const [first] = planByteDanceScoreAwareChunks(scenario());
    const frameCount = 183;
    const pitchCount = 88;
    const onset = new Float32Array(frameCount * pitchCount);
    const frame = new Float32Array(frameCount * pitchCount);
    // MIDI 61 (C#4) is intentionally a wrong pitch for this fixture.
    const pitchIndex = 61 - 21;
    const eventFrame = 110;
    onset[eventFrame * pitchCount + pitchIndex] = 0.9;
    frame[eventFrame * pitchCount + pitchIndex] = 0.95;

    const decoded = decodeByteDanceChunkRawOutputs({
      scenario: scenario(),
      plan: first,
      raw: {
        reg_onset_output: onset,
        reg_onset_shape: [frameCount, pitchCount],
        frame_output: frame,
        frame_shape: [frameCount, pitchCount],
      },
    });

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({
      pitch: 'C#4',
      performanceTimeMs: first.inputStartPerformanceMs + eventFrame * 10,
    });
  });

  it('uses a deterministic 16k linear resampling path and executable mock model path', async () => {
    const input = scenario({ audio: { ...scenario().audio, clipEndMs: 4_500, sourceDurationMs: 4_500 } });
    const sourcePcm = new Float32Array(48_000 * 5).map((_, index) => index / 48_000);
    const resampled = extractAndResampleLinear16k({
      sourcePcm,
      sourceSampleRateHz: 48_000,
      sourceStartMs: 0,
      sourceEndMs: 1_820,
    });
    expect(resampled).toHaveLength(29_120);
    expect(resampled[10]).toBe(extractAndResampleLinear16k({
      sourcePcm,
      sourceSampleRateHz: 48_000,
      sourceStartMs: 0,
      sourceEndMs: 1_820,
    })[10]);

    const definition = bytedanceCandidateDefinition({ gitHead: 'test-head' });
    const run = await executeByteDanceScenarioWithExecutor({
      scenario: input,
      sourcePcm,
      sourceSampleRateHz: 48_000,
      candidateId: definition.candidateId,
      command: 'mock executor',
      runtime: 'vitest mock',
      executor: async ({ inputPcm16k }) => {
        expect(inputPcm16k).toHaveLength(29_120);
        return {
          inferenceLatencyMs: 12,
          raw: {
            reg_onset_output: new Float32Array(183 * 88),
            reg_onset_shape: [183, 88],
            frame_output: new Float32Array(183 * 88),
            frame_shape: [183, 88],
          },
        };
      },
    });
    expect(run.publications.length).toBeGreaterThan(0);
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
    })).toThrow(/identity missing/);
    expect(() => assertAssetIdentity({
      kind: 'MODEL',
      path: 'model.onnx',
      expectedBytes: 1,
    })).toThrow(/byte size missing/);
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

  it('audits causal-case scenario eligibility without using historical shouldMatch or predictions', () => {
    const results = auditCausalCaseEligibility([
      { caseId: 'missing' },
      {
        caseId: 'eligible',
        expectedGroups: [{ groupId: 'g', expectedPerformanceTimeMs: 500, expectedPitches: ['C4'] }],
        completionPerformanceTimeMs: 1_000,
        performanceOriginSourceMs: 2_000,
        sourceAudioSha256: 'audio',
        sourceMidiSha256: 'midi',
        hasSynchronizedPhysicalMidi: true,
        scoreIntervalComplete: true,
        clipStartMs: 0,
        clipEndMs: 3_500,
      },
      {
        caseId: 'incomplete-score',
        expectedGroups: [{ groupId: 'g', expectedPerformanceTimeMs: 500, expectedPitches: ['C4'] }],
        completionPerformanceTimeMs: 1_000,
        performanceOriginSourceMs: 2_000,
        sourceAudioSha256: 'audio',
        sourceMidiSha256: 'midi',
        hasSynchronizedPhysicalMidi: true,
        scoreIntervalComplete: false,
        clipStartMs: 0,
        clipEndMs: 3_500,
      },
    ]);

    expect(results).toEqual([
      expect.objectContaining({ caseId: 'missing', status: 'EXCLUDED_NO_EXPECTED_GROUPS' }),
      expect.objectContaining({ caseId: 'eligible', status: 'ELIGIBLE_CONTINUOUS_SCENARIO' }),
      expect.objectContaining({ caseId: 'incomplete-score', status: 'EXCLUDED_INCOMPLETE_SCORE_INTERVAL' }),
    ]);
  });
});
