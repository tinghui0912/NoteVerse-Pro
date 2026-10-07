import { describe, expect, it } from 'vitest';

import {
  buildBakeoffReport,
  classifyExistingPracticeAudioCorpus,
  detectSplitLeakage,
  fakeCandidate,
  scoreCandidate,
  validateBenchmarkScenario,
  type BenchmarkScenario,
  type CandidateRun,
} from './continuous-analyzer-bakeoff';

function scenario(overrides: Partial<BenchmarkScenario> = {}): BenchmarkScenario {
  return {
    scenarioId: 'synthetic_chord_retrigger_sustain_v1',
    schemaVersion: 1,
    split: 'DEVELOPMENT',
    familyTags: ['correct_single', 'complete_chord', 'same_pitch_retrigger', 'sustained_no_retrigger'],
    source: {
      sourceAudioPath: 'synthetic://phase9d/chord_retrigger_sustain.wav',
      sourceAudioSha256: 'synthetic-audio-phase9d-001',
      sourceMidiPath: 'synthetic://phase9d/chord_retrigger_sustain.mid',
      sourceMidiSha256: 'synthetic-midi-phase9d-001',
      provenance: 'synthetic_harness_fixture',
    },
    audio: {
      nativeSampleRateHz: 48_000,
      channelPolicy: 'mono_float32_synthetic',
      clipStartMs: 0,
      clipEndMs: 3_000,
      pcmIdentity: 'synthetic-pcm-phase9d-001',
    },
    expectedStrikes: [
      { strikeId: 's1', groupId: 'g1', pitch: 'C4', expectedPerformanceTimeMs: 0, renderNoteIds: ['n1'] },
      { strikeId: 's2', groupId: 'g2', pitch: 'E4', expectedPerformanceTimeMs: 500, renderNoteIds: ['n2'] },
      { strikeId: 's3', groupId: 'g2', pitch: 'G4', expectedPerformanceTimeMs: 500, renderNoteIds: ['n3'] },
      { strikeId: 's4', groupId: 'g3', pitch: 'C4', expectedPerformanceTimeMs: 900, renderNoteIds: ['n4'] },
      { strikeId: 's5', groupId: 'g4', pitch: 'C4', expectedPerformanceTimeMs: 1_120, renderNoteIds: ['n5'] },
      { strikeId: 's6', groupId: 'g5', pitch: 'D4', expectedPerformanceTimeMs: 1_700, renderNoteIds: ['n6'] },
    ],
    physicalGroundTruth: {
      status: 'RECORDED',
      source: 'synthetic_physical_midi',
      attacks: [
        { physicalEventId: 'p1', pitch: 'C4', performanceTimeMs: 10 },
        { physicalEventId: 'p2', pitch: 'E4', performanceTimeMs: 495 },
        { physicalEventId: 'p3', pitch: 'G4', performanceTimeMs: 510 },
        { physicalEventId: 'p4', pitch: 'C4', performanceTimeMs: 890 },
        { physicalEventId: 'p5', pitch: 'C4', performanceTimeMs: 1_140 },
        { physicalEventId: 'p-extra', pitch: 'F4', performanceTimeMs: 1_400 },
      ],
    },
    completion: { kind: 'NATURAL', performanceTimeMs: 2_500 },
    taxonomy: {
      groups: {
        g1: ['correct_single'],
        g2: ['complete_chord'],
        g3: ['same_pitch_retrigger'],
        g4: ['same_pitch_retrigger'],
        g5: ['sustained_no_retrigger'],
      },
    },
    corpusOverlapStatus: 'UNKNOWN',
    ...overrides,
  };
}

function plannedScenario(): BenchmarkScenario {
  return scenario({
    scenarioId: 'planned_unrecorded_pair_v1',
    familyTags: ['missing_chord_tone'],
    physicalGroundTruth: {
      status: 'PLANNED_NOT_RECORDED',
      source: 'paired_ground_truth_manifest_planned',
      attacks: [],
    },
  });
}

function candidateWithObservation(observation: { pitch: string; performanceTimeMs: number }): CandidateRun {
  return {
    candidateId: 'manual-candidate',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: 'manual-test',
      adapterVersion: 'test',
      configurationSha256: 'manual-config',
      trainingDataOverlapStatus: 'UNKNOWN',
    },
    publications: [{
      publicationId: 'manual-publication',
      observations: [{
        observationId: 'manual-observation',
        pitch: observation.pitch,
        performanceTimeMs: observation.performanceTimeMs,
        confidence: 1,
      }],
      analyzedThroughPerformanceMs: 2_500,
      availabilityTimeMs: 2_500,
    }],
  };
}

function comparableEvaluation(evaluation: NonNullable<ReturnType<typeof scoreCandidate>['groundTruthEvaluation']>) {
  if (evaluation.status !== 'COMPLETE') return [];
  return evaluation.strikes.map((strike) => ({
    result: strike.result,
    timingOffsetMs: strike.result === 'MATCHED' ? strike.timingOffsetMs : null,
  }));
}

describe('Continuous analyzer bake-off harness', () => {
  it('validates benchmark schema and required physical fields', () => {
    expect(() => validateBenchmarkScenario(scenario())).not.toThrow();
    expect(() => validateBenchmarkScenario(scenario({ expectedStrikes: [] }))).toThrow(/ExpectedStrike/);
    expect(() => validateBenchmarkScenario(scenario({
      physicalGroundTruth: { status: 'RECORDED', source: 'bad', attacks: [] },
    }))).toThrow(/Recorded physical ground truth/);
  });

  it('does not manufacture accuracy for planned unrecorded fixtures', () => {
    const score = scoreCandidate(plannedScenario(), fakeCandidate(plannedScenario(), 'PERFECT'));

    expect(score.groundTruthStatus).toBe('INSUFFICIENT_DATA');
    expect(score.metrics.expectedStrikeRecall.status).toBe('NOT_EVALUATED');
    expect(score.metrics.expectedStrikeRecall.sampleCount).toBe(0);
  });

  it('detects protected split leakage by source audio hash', () => {
    const leaked = [
      scenario({ scenarioId: 'dev', split: 'DEVELOPMENT' }),
      scenario({ scenarioId: 'eval', split: 'EVALUATION' }),
    ];

    expect(detectSplitLeakage(leaked)).toEqual([
      'synthetic-audio-phase9d-001 appears in protected splits: DEVELOPMENT,EVALUATION',
    ]);
  });

  it('keeps zero-sample metrics NOT_EVALUATED rather than PASS', () => {
    const score = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT'));

    expect(score.metrics.correctMissingRate.status).toBe('PASS');
    expect(score.metrics.correctMissingRate.sampleCount).toBe(1);
  });

  it('scores PERFECT candidate with product finalization parity', () => {
    const score = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT'));

    expect(score.groundTruthStatus).toBe('PASS');
    expect(comparableEvaluation(score.groundTruthEvaluation!)).toEqual(comparableEvaluation(score.candidateEvaluation));
    expect(score.metrics.expectedStrikeRecall).toMatchObject({ status: 'PASS', value: 1 });
    expect(score.metrics.verdictAgreementRate).toMatchObject({ status: 'PASS', value: 1 });
  });

  it('EMPTY candidate exposes expected recall failures', () => {
    const score = scoreCandidate(scenario(), fakeCandidate(scenario(), 'EMPTY'));

    expect(score.metrics.expectedStrikeRecall).toMatchObject({ status: 'PASS', value: 0 });
    expect(score.metrics.correctMissingRate).toMatchObject({ status: 'PASS', value: 1 });
  });

  it('duplicate/extra candidate worsens extra metrics', () => {
    const perfect = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT'));
    const noisy = scoreCandidate(scenario(), fakeCandidate(scenario(), 'DUPLICATE_EXTRA'));

    expect(perfect.metrics.extraPrecision.status).toBe('PASS');
    expect(noisy.metrics.extraPrecision.status).toBe('PASS');
    if (perfect.metrics.extraPrecision.status === 'PASS' && noisy.metrics.extraPrecision.status === 'PASS') {
      expect(noisy.metrics.extraPrecision.value).toBeLessThan(perfect.metrics.extraPrecision.value);
    }
  });

  it('delayed-but-accurate candidate keeps accuracy and worsens finalized feedback age', () => {
    const perfect = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT'));
    const delayed = scoreCandidate(scenario(), fakeCandidate(scenario(), 'DELAYED_ACCURATE'));

    expect(delayed.metrics.expectedStrikeRecall).toEqual(perfect.metrics.expectedStrikeRecall);
    expect(delayed.metrics.timingAbsoluteMedianMs).toEqual(perfect.metrics.timingAbsoluteMedianMs);
    if (
      delayed.metrics.finalizedFeedbackAgeP50Ms.status === 'PASS'
      && perfect.metrics.finalizedFeedbackAgeP50Ms.status === 'PASS'
    ) {
      expect(delayed.metrics.finalizedFeedbackAgeP50Ms.value)
        .toBeGreaterThan(perfect.metrics.finalizedFeedbackAgeP50Ms.value);
    }
  });

  it('equivalent CHUNKED and STREAMING canonical outputs score identically', () => {
    const chunked = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT', 'CHUNKED'));
    const streaming = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT', 'STREAMING'));

    expect(chunked.metrics).toEqual(streaming.metrics);
    expect(chunked.familyMetrics).toEqual(streaming.familyMetrics);
  });

  it('keeps event time independent from inference completion time', () => {
    const delayed = scoreCandidate(scenario(), fakeCandidate(scenario(), 'DELAYED_ACCURATE'));

    expect(delayed.metrics.timingAbsoluteMedianMs).toMatchObject({ status: 'PASS', value: 0 });
    if (delayed.metrics.finalizedFeedbackAgeP50Ms.status === 'PASS') {
      expect(delayed.metrics.finalizedFeedbackAgeP50Ms.value).toBeGreaterThan(1_000);
    }
  });

  it('preserves same-pitch retrigger one-to-one semantics', () => {
    const score = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT'));

    expect(score.familyMetrics.same_pitch_retrigger.expectedStrikeRecall).toMatchObject({
      status: 'PASS',
      sampleCount: 2,
      value: 1,
    });
  });

  it('computes chord exact completeness and false complete acceptance', () => {
    const complete = scoreCandidate(scenario(), fakeCandidate(scenario(), 'PERFECT'));
    const missingChordTone = scoreCandidate(scenario(), candidateWithObservation({ pitch: 'E4', performanceTimeMs: 595 }));

    expect(complete.metrics.groupExactCompletenessRate).toMatchObject({ status: 'PASS', value: 1 });
    expect(missingChordTone.metrics.groupExactCompletenessRate).toMatchObject({ status: 'PASS', value: 0 });
  });

  it('scores sustained/no-retrigger false event as a false match on ground-truth missing strike', () => {
    const falseRetrigger = scoreCandidate(scenario(), candidateWithObservation({ pitch: 'D4', performanceTimeMs: 1_700 }));

    expect(falseRetrigger.familyMetrics.sustained_no_retrigger.falseMatchRateOnGroundTruthMissing)
      .toMatchObject({ status: 'FAIL', sampleCount: 1, value: 1 });
  });

  it('suppresses unsupported extra metrics when ground truth is missing', () => {
    const score = scoreCandidate(plannedScenario(), fakeCandidate(plannedScenario(), 'DUPLICATE_EXTRA'));

    expect(score.metrics.extraPrecision.status).toBe('NOT_EVALUATED');
  });

  it('produces deterministic candidate/report provenance', () => {
    const reportA = buildBakeoffReport({
      scenarios: [scenario()],
      candidates: [fakeCandidate(scenario(), 'PERFECT'), fakeCandidate(scenario(), 'EMPTY')],
      gitHead: 'test-head',
      command: 'vitest phase9d',
      policyPath: 'backend/research/policies/continuous_analyzer_bakeoff_policy_v1_2026-10-07.json',
      policyHash: 'policy-hash',
      dirtyTree: false,
    });
    const reportB = buildBakeoffReport({
      scenarios: [scenario()],
      candidates: [fakeCandidate(scenario(), 'PERFECT'), fakeCandidate(scenario(), 'EMPTY')],
      gitHead: 'test-head',
      command: 'vitest phase9d',
      policyPath: 'backend/research/policies/continuous_analyzer_bakeoff_policy_v1_2026-10-07.json',
      policyHash: 'policy-hash',
      dirtyTree: false,
    });

    expect(reportA).toEqual(reportB);
    expect(reportA.resultSummary['fake-perfect-chunked'].comparativeRank).toBe(1);
  });

  it('classifies existing fixture/research corpora without treating historical data as Practice v2 truth', () => {
    const classification = classifyExistingPracticeAudioCorpus({
      manifest: { scenarios: [{ id: 'old' }] },
      profileManifest: { scenarios: [{ id: 'old-profile' }] },
      pairedGroundTruthManifest: { scenarios: [{ status: 'planned' }] },
      bytedanceTargetCount: 421,
      hasOnlineAmtReports: true,
      hasRttReports: true,
    });

    expect(classification.practiceAudioManifest.status).toBe('HISTORICAL_REGRESSION_ONLY');
    expect(classification.pairedGroundTruthManifest.status).toBe('METADATA_ONLY_PLANNED');
    expect(classification.bytedanceTargetVerifierTargets.status).toBe('HISTORICAL_EVIDENCE_ONLY');
  });
});
