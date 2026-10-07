import { describe, expect, it } from 'vitest';

import {
  BYTEDANCE_CHUNKED_BASELINE_CONFIG,
  assertAssetIdentity,
  blockedByteDanceRunArtifact,
  bytedanceConfigurationSha256,
  bytedanceCandidateDefinition,
  bytedanceExecutionProfileSha256,
  byteDanceRawOutputsFromBrowserChunkArtifact,
  candidateRunForByteDanceChunks,
  decodeByteDanceChunkRawOutputs,
  decodeResearchWavToMonoFloat32,
  executeByteDanceScenarioWithExecutor,
  extractAndResampleLinear16k,
  observationsForByteDanceChunk,
  planByteDanceScoreAwareChunks,
  publicationForByteDanceChunk,
  scheduleByteDanceSingleWorkerPublications,
  sourceEventTimeToPerformanceTime,
  validateDecodedWavAgainstScenario,
  validateByteDanceRawOutputs,
  validateByteDanceSourceContext,
  validateChunkPlan,
  BYTEDANCE_PHASE9E_A3_EXECUTION_PROFILE,
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

function pcm16Wav(input: {
  sampleRateHz: number;
  channelCount: number;
  frames: readonly (readonly number[])[];
}): Uint8Array {
  const dataBytes = input.frames.length * input.channelCount * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, input.channelCount, true);
  view.setUint32(24, input.sampleRateHz, true);
  view.setUint32(28, input.sampleRateHz * input.channelCount * 2, true);
  view.setUint16(32, input.channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const frame of input.frames) {
    for (let channel = 0; channel < input.channelCount; channel += 1) {
      view.setInt16(offset, frame[channel] ?? 0, true);
      offset += 2;
    }
  }
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
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
    expect(bytedanceConfigurationSha256()).toBe('359d4618212ba5daf072da890456d1ff703922c654f8bc3d6b30d308c4806ef0');
    expect(BYTEDANCE_PHASE9E_A3_EXECUTION_PROFILE).toMatchObject({
      ortWebVersion: '1.20.1',
      executionProvider: 'wasm',
      graphOptimizationLevel: 'disabled',
      candidateInferenceConcurrency: 1,
    });
    expect(bytedanceExecutionProfileSha256()).toMatch(/^[a-f0-9]{64}$/);
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
      candidateProcessingLatencyMs: 40,
      publicationAvailableAtMs: first.inputEndPerformanceMs + 40,
      inferenceStartAtMs: first.inputEndPerformanceMs,
      queueDelayMs: 0,
    });

    expect(publication.analyzedThroughPerformanceMs).toBe(first.commitEndPerformanceMs);
    expect(publication.availabilityTimeMs).toBe(first.inputEndPerformanceMs + 40);
    expect(publication.diagnostics).toMatchObject({
      strategyShape: 'CHUNKED',
      inputStartMs: first.inputStartPerformanceMs,
      inputEndMs: first.inputEndPerformanceMs,
      inferenceLatencyMs: 35,
      requiredFutureContextMs: first.inputEndPerformanceMs - first.commitEndPerformanceMs,
      modelInferenceLatencyMs: 35,
      candidateProcessingLatencyMs: 40,
      queueDelayMs: 0,
      totalPublicationDelayMs: (first.inputEndPerformanceMs + 40) - first.commitEndPerformanceMs,
    });
  });

  it('omits authoritative availability when only inference latency is known', () => {
    const [first] = planByteDanceScoreAwareChunks(scenario());
    const publication = publicationForByteDanceChunk({
      scenario: scenario(),
      plan: first,
      observations: [],
      inferenceLatencyMs: 35,
    });

    expect(publication.availabilityTimeMs).toBeUndefined();
    expect(publication.diagnostics?.modelInferenceLatencyMs).toBe(35);
    expect(publication.diagnostics?.totalPublicationDelayMs).toBeUndefined();
  });

  it('accumulates queue delay under the frozen single-worker execution profile', () => {
    const plans = planByteDanceScoreAwareChunks(scenario({
      completion: { kind: 'NATURAL', performanceTimeMs: 1_800 },
      audio: { ...scenario().audio, clipEndMs: 4_000 },
    }));
    const schedule = scheduleByteDanceSingleWorkerPublications({
      plans,
      processingLatencyMsByChunkId: new Map(plans.map((plan) => [plan.chunkId, 1_200])),
    });

    const first = schedule.get(plans[0].chunkId);
    const second = schedule.get(plans[1].chunkId);
    expect(first?.inputReadyAtMs).toBe(plans[0].inputEndPerformanceMs);
    expect(first?.queueDelayMs).toBe(0);
    expect(second?.queueDelayMs).toBeGreaterThan(0);
    expect(second?.inferenceStartAtMs).toBe(first?.inferenceFinishAtMs);
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
        reg_onset_shape: [1, frameCount, pitchCount],
        frame_output: frame,
        frame_shape: [1, frameCount, pitchCount],
      },
    });

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({
      pitch: 'C#4',
      performanceTimeMs: first.inputStartPerformanceMs + eventFrame * 10,
    });
  });

  it('rejects malformed or non-finite real ByteDance raw output tensors before decoding', () => {
    expect(() => validateByteDanceRawOutputs({
      reg_onset_output: new Float32Array(183 * 88),
      reg_onset_shape: [183, 88],
      frame_output: new Float32Array(183 * 88),
      frame_shape: [183, 88],
    })).toThrow(/\[1,183,88\]/);

    const onset = new Float32Array(1 * 183 * 88);
    onset[0] = Number.NaN;
    expect(() => validateByteDanceRawOutputs({
      reg_onset_output: onset,
      reg_onset_shape: [1, 183, 88],
      frame_output: new Float32Array(1 * 183 * 88),
      frame_shape: [1, 183, 88],
    })).toThrow(/non-finite/);
  });

  it('converts browser raw-output artifacts through the authoritative TypeScript decoder path', () => {
    const [first] = planByteDanceScoreAwareChunks(scenario());
    const frameCount = 183;
    const pitchCount = 88;
    const onset = new Array(1 * frameCount * pitchCount).fill(0);
    const frame = new Array(1 * frameCount * pitchCount).fill(0);
    const pitchIndex = 64 - 21;
    const eventFrame = 100;
    onset[eventFrame * pitchCount + pitchIndex] = 0.8;
    frame[eventFrame * pitchCount + pitchIndex] = 0.8;

    const raw = byteDanceRawOutputsFromBrowserChunkArtifact({
      chunkId: first.chunkId,
      rawOutputs: {
        reg_onset_output: { dims: [1, frameCount, pitchCount], data: onset },
        frame_output: { dims: [1, frameCount, pitchCount], data: frame },
      },
    });
    const decoded = decodeByteDanceChunkRawOutputs({ scenario: scenario(), plan: first, raw });
    const publication = publicationForByteDanceChunk({
      scenario: scenario(),
      plan: first,
      observations: observationsForByteDanceChunk(scenario(), first, decoded),
    });

    expect(decoded[0]).toMatchObject({ pitch: 'E4' });
    expect(publication.observations[0]).toMatchObject({
      pitch: 'E4',
      performanceTimeMs: first.inputStartPerformanceMs + eventFrame * 10,
    });
    expect(publication.availabilityTimeMs).toBeUndefined();
  });

  it('uses a deterministic 16k linear resampling path and executable mock model path', async () => {
    const input = scenario({ audio: { ...scenario().audio, clipEndMs: 4_500, sourceDurationMs: 5_000 } });
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
            reg_onset_shape: [1, 183, 88],
            frame_output: new Float32Array(183 * 88),
            frame_shape: [1, 183, 88],
          },
        };
      },
    });
    expect(run.publications.length).toBeGreaterThan(0);
    expect(run.publications[0].availabilityTimeMs).toBeUndefined();
  });

  it('requires executable scenario PCM metadata to match BenchmarkScenario audio identity', async () => {
    const input = scenario({ audio: { ...scenario().audio, clipEndMs: 4_500, sourceDurationMs: 4_500 } });
    await expect(executeByteDanceScenarioWithExecutor({
      scenario: input,
      sourcePcm: new Float32Array(48_000 * 5),
      sourceSampleRateHz: 44_100,
      candidateId: 'candidate',
      command: 'bad sample rate',
      runtime: 'vitest',
      executor: async () => {
        throw new Error('executor should not run');
      },
    })).rejects.toThrow(/sample rate/);
  });

  it('loads PCM16 WAV research audio with frozen average-channel downmix semantics', () => {
    const wav = pcm16Wav({
      sampleRateHz: 48_000,
      channelCount: 2,
      frames: [
        [16_384, 16_384],
        [32_767, -32_768],
      ],
    });

    const decoded = decodeResearchWavToMonoFloat32(wav);

    expect(decoded.sampleRateHz).toBe(48_000);
    expect(decoded.channelCount).toBe(2);
    expect(decoded.pcm).toHaveLength(2);
    expect(decoded.pcm[0]).toBeCloseTo(0.5, 5);
    expect(decoded.pcm[1]).toBeCloseTo(-1 / 65_536, 8);
  });

  it('fails closed when decoded WAV identity disagrees with BenchmarkScenario audio metadata', () => {
    const decoded = decodeResearchWavToMonoFloat32(pcm16Wav({
      sampleRateHz: 44_100,
      channelCount: 1,
      frames: new Array(44).fill(null).map(() => [0]),
    }));

    expect(() => validateDecodedWavAgainstScenario({
      scenario: scenario({ audio: { ...scenario().audio, nativeSampleRateHz: 48_000 } }),
      sampleRateHz: decoded.sampleRateHz,
      durationMs: decoded.durationMs,
    })).toThrow(/sample rate/);

    expect(() => validateDecodedWavAgainstScenario({
      scenario: scenario({
        audio: {
          ...scenario().audio,
          nativeSampleRateHz: 44_100,
          sourceDurationMs: decoded.durationMs + 10,
        },
      }),
      sampleRateHz: decoded.sampleRateHz,
      durationMs: decoded.durationMs,
    })).toThrow(/duration/);
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

});
