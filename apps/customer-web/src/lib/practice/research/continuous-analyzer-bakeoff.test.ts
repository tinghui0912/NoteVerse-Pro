import { describe, expect, it } from 'vitest';

import {
  buildBakeoffReport,
  classifyExistingPracticeAudioCorpus,
  detectSplitLeakage,
  fakeCandidate,
  scoreCandidate,
  validateBenchmarkScenario,
  type BenchmarkScenario,
  type CandidateDefinition,
  type CandidateScenarioRun,
} from './continuous-analyzer-bakeoff';
import { ContinuousFinalizationLedger } from '../local-core/continuous-finalization-ledger';
import { ContinuousEvaluationSession } from '../local-core/continuous-evaluation-session';
import type { PracticeScoreArtifact } from '../local-core/artifact';
import type { ObservedAttack } from '../audio-analysis/continuous/observed-attack';

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

function silenceScenario(): BenchmarkScenario {
  return scenario({
    scenarioId: 'recorded_silence_all_missing_v1',
    expectedStrikes: [
      { strikeId: 'silent-c', groupId: 'silent-g1', pitch: 'C4', expectedPerformanceTimeMs: 500, renderNoteIds: ['silent-c'] },
    ],
    physicalGroundTruth: {
      status: 'RECORDED',
      source: 'synchronized_empty_midi',
      attacks: [],
    },
    completion: { kind: 'NATURAL', performanceTimeMs: 1_000 },
  });
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

function candidateDefinition(id = 'manual-candidate'): CandidateDefinition {
  return {
    candidateId: id,
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: 'manual-test',
      adapterVersion: 'test',
      configurationSha256: `${id}-config`,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };
}

function candidateRun(
  candidateId: string,
  scenarioId: string,
  observations: readonly { observationId: string; pitch: string; performanceTimeMs: number }[],
  coverage = 2_500
): CandidateScenarioRun {
  return {
    candidateId,
    scenarioId,
    publications: [{
      publicationId: `${candidateId}:${scenarioId}:publication`,
      observations: observations.map((observation) => ({ ...observation, confidence: 1 })),
      analyzedThroughPerformanceMs: coverage,
      availabilityTimeMs: coverage,
    }],
  };
}

function artifactFromScenario(input: BenchmarkScenario): PracticeScoreArtifact {
  const groups = [...new Set(input.expectedStrikes.map((strike) => strike.groupId))].map((groupId) => {
    const strikes = input.expectedStrikes.filter((strike) => strike.groupId === groupId);
    return { groupId, strikes };
  });
  return {
    schemaVersion: 1,
    scoreId: 'parity-score',
    revisionId: 'parity-revision',
    artifactId: 'parity-artifact',
    scoreTempoSegments: [{ startBeat: 0, bpm: 60, source: 'BENCHMARK' }],
    meterSegments: [{ startBeat: 0, numerator: 4, denominator: 4, measureDurationBeats: 4, countInPulses: 4, source: 'BENCHMARK' }],
    firstPlayableBeat: groups[0]?.strikes[0].expectedPerformanceTimeMs ?? 0,
    playableEvents: [],
    practiceAttackSteps: groups.map(({ groupId, strikes }) => ({
      stepId: `step:${groupId}`,
      groupId,
      onsetBeat: strikes[0].expectedPerformanceTimeMs,
      attackTargets: strikes.map((strike) => ({
        pitch: strike.pitch,
        renderNoteIds: [...strike.renderNoteIds],
      })),
      continuation: [],
    })),
    expectedPracticeGroups: groups.map(({ groupId, strikes }) => {
      return {
        groupId,
        onsetBeat: strikes[0].expectedPerformanceTimeMs,
        canonicalEndBeat: strikes[0].expectedPerformanceTimeMs,
        pitches: strikes.map((strike) => strike.pitch),
        renderNoteIds: strikes.flatMap((strike) => strike.renderNoteIds),
        eventIds: strikes.map((strike) => `event:${strike.strikeId}`),
        measureNumbers: ['1'],
        staffIds: ['1'],
        voiceIds: ['1'],
        expectedNotes: [],
        strikeTargets: strikes.map((strike) => ({
          strikeId: strike.strikeId,
          pitch: strike.pitch,
          renderNoteIds: [...strike.renderNoteIds],
          eventIds: [`event:${strike.strikeId}`],
          measureNumbers: ['1'],
          expectedNotes: [],
        })),
      };
    }),
    scoreEndBeat: input.completion?.performanceTimeMs ?? 2_500,
  } as unknown as PracticeScoreArtifact;
}

function observed(id: string, pitch: string, performanceTimeMs: number): ObservedAttack {
  return { observationId: id, pitch, performanceTimeMs, confidence: 1, source: 'ACOUSTIC' };
}

function comparableEvaluation(evaluation: CompletedEvaluationForTest | undefined) {
  if (!evaluation || evaluation.status !== 'COMPLETE') return evaluation;
  return {
    ...evaluation,
    strikes: evaluation.strikes.map((strike) => ({
      result: strike.result,
      timingOffsetMs: strike.result === 'MATCHED' ? strike.timingOffsetMs : null,
      pitch: strike.pitch,
      performanceTimeMs: strike.performanceTimeMs,
    })),
    extras: evaluation.extras.map((extra) => ({
      pitch: extra.pitch,
      performanceTimeMs: extra.performanceTimeMs,
    })),
  };
}

type CompletedEvaluationForTest = ReturnType<typeof scoreCandidate>['candidateEvaluation'];

describe('Continuous analyzer bake-off harness', () => {
  it('validates benchmark schema and strengthens scenario invariants', () => {
    expect(() => validateBenchmarkScenario(scenario())).not.toThrow();
    expect(() => validateBenchmarkScenario(scenario({ expectedStrikes: [] }))).toThrow(/ExpectedStrike/);
    expect(() => validateBenchmarkScenario(scenario({
      expectedStrikes: [
        { strikeId: 'dup', groupId: 'g1', pitch: 'C4', expectedPerformanceTimeMs: 0, renderNoteIds: [] },
        { strikeId: 'dup', groupId: 'g2', pitch: 'D4', expectedPerformanceTimeMs: 0, renderNoteIds: [] },
      ],
    }))).toThrow(/Duplicate ExpectedStrike/);
    expect(() => validateBenchmarkScenario(scenario({
      expectedStrikes: [
        { strikeId: 'a', groupId: 'g1', pitch: 'C4', expectedPerformanceTimeMs: 0, renderNoteIds: [] },
        { strikeId: 'b', groupId: 'g1', pitch: 'E4', expectedPerformanceTimeMs: 10, renderNoteIds: [] },
      ],
    }))).toThrow(/different expected times/);
    expect(() => validateBenchmarkScenario(scenario({
      physicalGroundTruth: {
        status: 'RECORDED',
        source: 'bad',
        attacks: [{ physicalEventId: 'late', pitch: 'C4', performanceTimeMs: 9_999 }],
      },
    }))).toThrow(/beyond scenario completion/);
  });

  it('accepts recorded physical truth with zero attacks and scores all-missing correctly', () => {
    const quiet = silenceScenario();
    expect(() => validateBenchmarkScenario(quiet)).not.toThrow();
    const { definition, run } = fakeCandidate(quiet, 'EMPTY');
    const score = scoreCandidate(quiet, definition, run);

    expect(score.groundTruthEvaluation).toMatchObject({ status: 'COMPLETE' });
    expect(score.candidateEvaluation).toMatchObject({ status: 'COMPLETE' });
    expect(score.metrics.correctMissingRate).toMatchObject({ status: 'MEASURED', value: 1 });
    expect(score.metrics.expectedStrikeRecall.status).toBe('NOT_EVALUATED');
  });

  it('validates NATURAL completion while preserving MANUAL future NOT_REACHED semantics', () => {
    expect(() => validateBenchmarkScenario(scenario({
      completion: { kind: 'NATURAL', performanceTimeMs: 1_000 },
    }))).toThrow(/Natural completion/);

    const manual = scenario({
      scenarioId: 'manual-stop-before-future-note',
      physicalGroundTruth: {
        status: 'RECORDED',
        source: 'synthetic_manual_stop_truth',
        attacks: [{ physicalEventId: 'early-c', pitch: 'C4', performanceTimeMs: 10 }],
      },
      completion: { kind: 'MANUAL', performanceTimeMs: 1_000 },
    });
    const { definition, run } = fakeCandidate(manual, 'PERFECT');
    const score = scoreCandidate(manual, definition, run);

    expect(score.candidateEvaluation.status).toBe('COMPLETE');
    if (score.candidateEvaluation.status === 'COMPLETE') {
      expect(score.candidateEvaluation.strikes.some((strike) => strike.result === 'NOT_REACHED')).toBe(true);
    }
  });

  it('does not manufacture candidate coverage when final coverage is behind completion', () => {
    const { definition, run } = fakeCandidate(scenario(), 'INCOMPLETE');
    const score = scoreCandidate(scenario(), definition, run);

    expect(score.groundTruthEvaluation).toMatchObject({ status: 'COMPLETE' });
    expect(score.candidateEvaluation).toEqual({ status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' });
    expect(score.metrics.expectedStrikeRecall.status).toBe('NOT_EVALUATED');
    expect(score.metrics.finalizedFeedbackAgeP50Ms.status).toBe('MEASURED');
  });

  it('does not manufacture accuracy for planned unrecorded fixtures', () => {
    const { definition, run } = fakeCandidate(plannedScenario(), 'PERFECT');
    const score = scoreCandidate(plannedScenario(), definition, run);

    expect(score.groundTruthStatus).toBe('INSUFFICIENT_DATA');
    expect(score.metrics.expectedStrikeRecall.status).toBe('NOT_EVALUATED');
  });

  it('detects protected split leakage by source audio hash', () => {
    expect(detectSplitLeakage([
      scenario({ scenarioId: 'dev', split: 'DEVELOPMENT' }),
      scenario({ scenarioId: 'eval', split: 'EVALUATION' }),
    ])).toEqual([
      'synthetic-audio-phase9d-001 appears in protected splits: DEVELOPMENT,EVALUATION',
    ]);
  });

  it('binds candidate output to scenarioId and rejects Cartesian cross-scoring', () => {
    const first = scenario({ scenarioId: 'first', source: { ...scenario().source, sourceAudioSha256: 'first-sha' } });
    const second = scenario({ scenarioId: 'second', source: { ...scenario().source, sourceAudioSha256: 'second-sha' } });
    const definition = candidateDefinition('bound-candidate');
    const report = buildBakeoffReport({
      scenarios: [first, second],
      candidateDefinitions: [definition],
      scenarioRuns: [candidateRun(definition.candidateId, first.scenarioId, [])],
      gitHead: 'test-head',
      command: 'vitest phase9d.1',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    });

    expect(report.scores).toHaveLength(2);
    expect(report.skippedScenarioCount).toBe(1);
    expect(report.scores[0].scenarioId).toBe('first');
    expect(report.scores[1]).toMatchObject({
      scenarioId: 'second',
      candidateRunStatus: 'MISSING_DATA',
      candidateEvaluation: { status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' },
    });
    expect(report.candidateCoverage[definition.candidateId].DEVELOPMENT).toMatchObject({
      expectedScenarioCount: 2,
      runPresentCount: 1,
      missingRunCount: 1,
    });
  });

  it('rejects duplicate candidate runs for the same candidate and scenario', () => {
    const definition = candidateDefinition('dup-run');
    const run = candidateRun(definition.candidateId, scenario().scenarioId, []);

    expect(() => buildBakeoffReport({
      scenarios: [scenario()],
      candidateDefinitions: [definition],
      scenarioRuns: [run, run],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    })).toThrow(/Duplicate candidate scenario run/);
  });

  it('rejects malformed candidate definitions and orphan scenario runs', () => {
    const definition = candidateDefinition('valid');
    expect(() => buildBakeoffReport({
      scenarios: [scenario()],
      candidateDefinitions: [{ ...definition, candidateId: '' }],
      scenarioRuns: [],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    })).toThrow(/CandidateDefinition/);
    expect(() => buildBakeoffReport({
      scenarios: [scenario()],
      candidateDefinitions: [definition, { ...definition }],
      scenarioRuns: [],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    })).toThrow(/Duplicate CandidateDefinition/);
    expect(() => buildBakeoffReport({
      scenarios: [scenario()],
      candidateDefinitions: [definition],
      scenarioRuns: [candidateRun(definition.candidateId, 'unknown-scenario', [])],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    })).toThrow(/unknown scenarioId/);
  });

  it('validates canonical publication order instead of sorting it into shape', () => {
    const definition = candidateDefinition('ordered');
    const baseRun = candidateRun(definition.candidateId, scenario().scenarioId, []);

    expect(() => scoreCandidate(scenario(), definition, {
      ...baseRun,
      publications: [
        { publicationId: 'late', observations: [], analyzedThroughPerformanceMs: 2_000 },
        { publicationId: 'early', observations: [], analyzedThroughPerformanceMs: 1_000 },
      ],
    })).toThrow(/monotonically non-decreasing/);
    expect(() => scoreCandidate(scenario(), definition, {
      ...baseRun,
      publications: [
        { publicationId: 'future-coverage', observations: [], analyzedThroughPerformanceMs: 9_999 },
      ],
    })).toThrow(/cannot exceed scenario completion/);
    expect(() => scoreCandidate(scenario(), definition, {
      ...baseRun,
      publications: [
        {
          publicationId: 'future-event',
          observations: [{ observationId: 'o', pitch: 'C4', performanceTimeMs: 2_000 }],
          analyzedThroughPerformanceMs: 1_000,
        },
      ],
    })).toThrow(/event time cannot exceed/);
    expect(() => scoreCandidate(scenario(), definition, {
      ...baseRun,
      publications: [
        { publicationId: 'bad-availability', observations: [], analyzedThroughPerformanceMs: 1_000, availabilityTimeMs: 999 },
      ],
    })).toThrow(/availability time cannot be earlier/);
  });

  it('keeps metric availability separate from quality gate verdicts', () => {
    const { definition, run } = fakeCandidate(scenario(), 'EMPTY');
    const score = scoreCandidate(scenario(), definition, run);

    expect(score.metrics.expectedStrikeRecall).toMatchObject({ status: 'MEASURED', value: 0 });
    expect(score.metrics.timingAbsoluteMedianMs.status).toBe('NOT_EVALUATED');
  });

  it('keeps true zero-sample metrics NOT_EVALUATED', () => {
    const quiet = silenceScenario();
    const { definition, run } = fakeCandidate(quiet, 'EMPTY');
    const score = scoreCandidate(quiet, definition, run);

    expect(score.metrics.expectedStrikeRecall).toMatchObject({ status: 'NOT_EVALUATED', sampleCount: 0 });
    expect(score.metrics.timingAbsoluteP95Ms).toMatchObject({ status: 'NOT_EVALUATED', sampleCount: 0 });
  });

  it('does not rank from development or calibration fixtures', () => {
    const dev = scenario({ split: 'DEVELOPMENT' });
    const calibration = scenario({ scenarioId: 'cal', split: 'CALIBRATION', source: { ...scenario().source, sourceAudioSha256: 'cal-sha' } });
    const perfect = fakeCandidate(dev, 'PERFECT');
    const report = buildBakeoffReport({
      scenarios: [dev, calibration],
      candidateDefinitions: [perfect.definition],
      scenarioRuns: [perfect.run],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    });

    expect(report.comparativeOutcome).toBe('INSUFFICIENT_EVALUATION_SET');
    expect(report.resultSummary[perfect.definition.candidateId].comparativeRank).toBeNull();
    expect(report.aggregateMetrics[perfect.definition.candidateId].EVALUATION.expectedStrikeRecall.status)
      .toBe('NOT_EVALUATED');
    expect(report.aggregateMetrics[perfect.definition.candidateId].ALL_SPLITS_DIAGNOSTIC_ONLY.expectedStrikeRecall.status)
      .toBe('MEASURED');
  });

  it('fails closed for official evaluation when protected splits leak', () => {
    const dev = scenario({ scenarioId: 'dev', split: 'DEVELOPMENT' });
    const evaluation = scenario({ scenarioId: 'eval', split: 'EVALUATION' });
    const perfect = fakeCandidate(evaluation, 'PERFECT');
    const report = buildBakeoffReport({
      scenarios: [dev, evaluation],
      candidateDefinitions: [perfect.definition],
      scenarioRuns: [perfect.run],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    });

    expect(report.comparativeOutcome).toBe('INELIGIBLE_SPLIT_LEAKAGE');
    expect(report.resultSummary[perfect.definition.candidateId].comparativeRank).toBeNull();
  });

  it('distinguishes incomplete evaluation coverage from ready evaluation without a comparator', () => {
    const e1 = scenario({ scenarioId: 'e1', split: 'EVALUATION', source: { ...scenario().source, sourceAudioSha256: 'e1-sha' } });
    const e2 = scenario({ scenarioId: 'e2', split: 'EVALUATION', source: { ...scenario().source, sourceAudioSha256: 'e2-sha' } });
    const candidateA1 = fakeCandidate(e1, 'PERFECT');
    const candidateA2 = fakeCandidate(e2, 'PERFECT');
    const candidateB1 = fakeCandidate(e1, 'PERFECT', 'STREAMING');
    const missingReport = buildBakeoffReport({
      scenarios: [e1, e2],
      candidateDefinitions: [candidateA1.definition, candidateB1.definition],
      scenarioRuns: [candidateA1.run, candidateA2.run, candidateB1.run],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    });
    expect(missingReport.comparativeOutcome).toBe('INCOMPLETE_EVALUATION_COVERAGE');
    expect(missingReport.candidateCoverage[candidateB1.definition.candidateId].EVALUATION)
      .toMatchObject({ expectedScenarioCount: 2, runPresentCount: 1, missingRunCount: 1 });

    const completeReport = buildBakeoffReport({
      scenarios: [e1, e2],
      candidateDefinitions: [candidateA1.definition],
      scenarioRuns: [candidateA1.run, candidateA2.run],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    });
    expect(completeReport.comparativeOutcome).toBe('EVALUATION_READY_NO_COMPARATOR_POLICY');
    expect(completeReport.resultSummary[candidateA1.definition.candidateId].comparativeRank).toBeNull();
  });

  it('counts incomplete candidate evaluation coverage as ineligible', () => {
    const evaluation = scenario({ scenarioId: 'eval-incomplete', split: 'EVALUATION' });
    const incomplete = fakeCandidate(evaluation, 'INCOMPLETE');
    const report = buildBakeoffReport({
      scenarios: [evaluation],
      candidateDefinitions: [incomplete.definition],
      scenarioRuns: [incomplete.run],
      gitHead: 'test-head',
      command: 'vitest',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
    });

    expect(report.comparativeOutcome).toBe('INCOMPLETE_EVALUATION_COVERAGE');
    expect(report.candidateCoverage[incomplete.definition.candidateId].EVALUATION.candidateIncompleteAnalysisCount).toBe(1);
  });

  it('does not fabricate finalized feedback age without availabilityTimeMs', () => {
    const definition = candidateDefinition('no-availability');
    const run = candidateRun(definition.candidateId, scenario().scenarioId, [
      { observationId: 'c', pitch: 'C4', performanceTimeMs: 10 },
      { observationId: 'e', pitch: 'E4', performanceTimeMs: 495 },
      { observationId: 'g', pitch: 'G4', performanceTimeMs: 510 },
      { observationId: 'c2', pitch: 'C4', performanceTimeMs: 890 },
      { observationId: 'c3', pitch: 'C4', performanceTimeMs: 1_140 },
    ]);
    const runWithoutAvailability: CandidateScenarioRun = {
      ...run,
      publications: run.publications.map(({ availabilityTimeMs: _availabilityTimeMs, ...publication }) => publication),
    };
    const score = scoreCandidate(scenario(), definition, runWithoutAvailability);

    expect(score.metrics.finalizedFeedbackAgeP50Ms.status).toBe('NOT_EVALUATED');
    expect(score.metricSamples.feedbackAgeMissingAvailabilityCount).toBeGreaterThan(0);
  });

  it('scores PERFECT candidate with product finalization parity', () => {
    const { definition, run } = fakeCandidate(scenario(), 'PERFECT');
    const score = scoreCandidate(scenario(), definition, run);

    expect(score.groundTruthStatus).toBe('MEASURED');
    expect(comparableEvaluation(score.candidateEvaluation)).toEqual(comparableEvaluation(score.groundTruthEvaluation));
    expect(score.metrics.expectedStrikeRecall).toMatchObject({ status: 'MEASURED', value: 1 });
    expect(score.metrics.verdictAgreementRate).toMatchObject({ status: 'MEASURED', value: 1 });
  });

  it('duplicate/extra candidate worsens extra precision while preserving extra recall', () => {
    const perfect = scoreCandidate(scenario(), ...Object.values(fakeCandidate(scenario(), 'PERFECT')) as [CandidateDefinition, CandidateScenarioRun]);
    const noisy = scoreCandidate(scenario(), ...Object.values(fakeCandidate(scenario(), 'DUPLICATE_EXTRA')) as [CandidateDefinition, CandidateScenarioRun]);

    expect(perfect.metrics.extraPrecision.status).toBe('MEASURED');
    expect(noisy.metrics.extraPrecision.status).toBe('MEASURED');
    if (perfect.metrics.extraPrecision.status === 'MEASURED' && noisy.metrics.extraPrecision.status === 'MEASURED') {
      expect(noisy.metrics.extraPrecision.value).toBeLessThan(perfect.metrics.extraPrecision.value);
    }
    expect(noisy.extraDiagnostics.falseCandidateExtras).toBeGreaterThan(0);
    expect(noisy.metrics.extraRecall).toMatchObject({ status: 'MEASURED', value: 1 });
  });

  it('missed physical extras reduce extra recall', () => {
    const quietCandidate = fakeCandidate(scenario(), 'EMPTY');
    const score = scoreCandidate(scenario(), quietCandidate.definition, quietCandidate.run);

    expect(score.extraDiagnostics.missedPhysicalExtras).toBe(1);
    expect(score.metrics.extraRecall).toMatchObject({ status: 'MEASURED', value: 0 });
  });

  it('delayed-but-accurate candidate keeps accuracy and worsens finalized feedback age', () => {
    const perfect = fakeCandidate(scenario(), 'PERFECT');
    const delayed = fakeCandidate(scenario(), 'DELAYED_ACCURATE');
    const perfectScore = scoreCandidate(scenario(), perfect.definition, perfect.run);
    const delayedScore = scoreCandidate(scenario(), delayed.definition, delayed.run);

    expect(delayedScore.metrics.expectedStrikeRecall).toEqual(perfectScore.metrics.expectedStrikeRecall);
    expect(delayedScore.metrics.timingAbsoluteMedianMs).toEqual(perfectScore.metrics.timingAbsoluteMedianMs);
    if (
      delayedScore.metrics.finalizedFeedbackAgeP50Ms.status === 'MEASURED'
      && perfectScore.metrics.finalizedFeedbackAgeP50Ms.status === 'MEASURED'
    ) {
      expect(delayedScore.metrics.finalizedFeedbackAgeP50Ms.value)
        .toBeGreaterThan(perfectScore.metrics.finalizedFeedbackAgeP50Ms.value);
    }
    expect(delayedScore.metrics.inferenceLatencyP50Ms).toMatchObject({ status: 'MEASURED', value: 900 });
  });

  it('equivalent CHUNKED and STREAMING canonical outputs score identically', () => {
    const chunked = fakeCandidate(scenario(), 'PERFECT', 'CHUNKED');
    const streaming = fakeCandidate(scenario(), 'PERFECT', 'STREAMING');
    const chunkedScore = scoreCandidate(scenario(), chunked.definition, chunked.run);
    const streamingScore = scoreCandidate(scenario(), streaming.definition, streaming.run);

    expect(chunkedScore.metrics).toEqual(streamingScore.metrics);
    expect(chunkedScore.familyMetrics).toEqual(streamingScore.familyMetrics);
  });

  it('keeps event time independent from inference completion time', () => {
    const delayed = fakeCandidate(scenario(), 'DELAYED_ACCURATE');
    const score = scoreCandidate(scenario(), delayed.definition, delayed.run);

    expect(score.metrics.timingAbsoluteMedianMs).toMatchObject({ status: 'MEASURED', value: 0 });
    if (score.metrics.finalizedFeedbackAgeP50Ms.status === 'MEASURED') {
      expect(score.metrics.finalizedFeedbackAgeP50Ms.value).toBeGreaterThan(1_000);
    }
  });

  it('preserves same-pitch retrigger one-to-one semantics', () => {
    const perfect = fakeCandidate(scenario(), 'PERFECT');
    const score = scoreCandidate(scenario(), perfect.definition, perfect.run);

    expect(score.familyMetrics.same_pitch_retrigger.expectedStrikeRecall).toMatchObject({
      status: 'MEASURED',
      sampleCount: 2,
      value: 1,
    });
  });

  it('limits chord completeness metrics to multi-pitch chord groups', () => {
    const complete = fakeCandidate(scenario(), 'PERFECT');
    const onlySingle = scoreCandidate(scenario(), candidateDefinition('single-only'), candidateRun('single-only', scenario().scenarioId, [
      { observationId: 'single', pitch: 'C4', performanceTimeMs: 10 },
    ]));
    const completeScore = scoreCandidate(scenario(), complete.definition, complete.run);

    expect(completeScore.metrics.chordExactCompletenessRate).toMatchObject({
      status: 'MEASURED',
      sampleCount: 1,
      value: 1,
    });
    expect(onlySingle.metrics.chordExactCompletenessRate).toMatchObject({
      status: 'MEASURED',
      sampleCount: 1,
      value: 0,
    });
  });

  it('scores sustained/no-retrigger false event as a false match on ground-truth missing strike', () => {
    const definition = candidateDefinition('false-retrigger');
    const score = scoreCandidate(scenario(), definition, candidateRun(definition.candidateId, scenario().scenarioId, [
      { observationId: 'false-d4', pitch: 'D4', performanceTimeMs: 1_700 },
    ]));

    expect(score.familyMetrics.sustained_no_retrigger.falseMatchRateOnGroundTruthMissing)
      .toMatchObject({ status: 'MEASURED', sampleCount: 1, value: 1 });
  });

  it('suppresses unsupported metrics when ground truth is missing', () => {
    const candidate = fakeCandidate(plannedScenario(), 'DUPLICATE_EXTRA');
    const score = scoreCandidate(plannedScenario(), candidate.definition, candidate.run);

    expect(score.metrics.extraPrecision.status).toBe('NOT_EVALUATED');
  });

  it('produces deterministic report provenance and aggregate sample counts', () => {
    const perfect = fakeCandidate(scenario(), 'PERFECT');
    const empty = fakeCandidate(scenario(), 'EMPTY');
    const reportA = buildBakeoffReport({
      scenarios: [scenario()],
      candidateDefinitions: [perfect.definition, empty.definition],
      scenarioRuns: [perfect.run, empty.run],
      gitHead: 'test-head',
      command: 'vitest phase9d.1',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
      runtimeEnvironment: { node: 'test' },
    });
    const reportB = buildBakeoffReport({
      scenarios: [scenario()],
      candidateDefinitions: [perfect.definition, empty.definition],
      scenarioRuns: [perfect.run, empty.run],
      gitHead: 'test-head',
      command: 'vitest phase9d.1',
      policy: { policyId: 'policy', path: 'policy.json', schemaVersion: 2, sha256: 'policy-hash' },
      benchmarkManifest: { manifestId: 'manifest', path: 'fixture.json', schemaVersion: 1, sha256: 'manifest-hash' },
      dirtyTree: false,
      runtimeEnvironment: { node: 'test' },
    });

    expect(reportA).toEqual(reportB);
    expect(reportA.resultSummary[perfect.definition.candidateId].comparativeRank).toBeNull();
    expect(reportA.aggregateMetrics[perfect.definition.candidateId].ALL_SPLITS_DIAGNOSTIC_ONLY.expectedStrikeRecall)
      .toMatchObject({ status: 'MEASURED', sampleCount: 5 });
    expect(reportA.candidateScenarioRunCount).toBe(2);
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

  it('keeps ContinuousEvaluationSession and direct finalization ledger behavior equivalent', () => {
    const input = scenario();
    const artifact = artifactFromScenario(input);
    const session = new ContinuousEvaluationSession({
      artifact,
      timeline: { beatToTimeMs: (beat: number) => beat },
      scope: { kind: 'FULL' },
    });
    const ledger = new ContinuousFinalizationLedger({
      expectedStrikes: input.expectedStrikes,
      assignmentWindowMs: 250,
    });
    const attacks = [
      observed('c1', 'C4', 10),
      observed('e', 'E4', 495),
      observed('g', 'G4', 510),
      observed('c2', 'C4', 890),
      observed('c3', 'C4', 1_140),
      observed('extra', 'F4', 1_400),
    ];

    session.publishObservations(attacks, 2_500);
    ledger.publishObservations(attacks, 2_500);
    session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 2_500, terminalPerformanceMs: 2_500 });
    ledger.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 2_500, terminalPerformanceMs: 2_500 });

    expect(session.snapshot()).toEqual(ledger.snapshot());
    expect(session.completedEvaluation()).toEqual(ledger.completedEvaluation());
  });
});
