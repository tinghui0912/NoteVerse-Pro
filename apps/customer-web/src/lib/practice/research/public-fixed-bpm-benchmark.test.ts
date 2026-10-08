import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CompletedContinuousEvaluation } from '../completed-performance';
import { scoreCandidate, type BenchmarkScenario, type CandidateDefinition, type CandidateScenarioRun } from './continuous-analyzer-bakeoff';
import {
  assertCounterfactualPreservesAudioAndMidi,
  assertFrozenCandidateConfigsUnchanged,
  assertMatchedCandidateAudioIdentity,
  assertPrimaryFixedGridProvenance,
  assertPublicDatasetMayEnterWinnerEvidence,
  buildPublicDiagnosticBakeoffReport,
  canonicalPublicScenarioManifestSha256,
  decideSecondaryHumanFixedBpmProxy,
  decideOverallPublicEvidence,
  productIntegerBpm,
  publicProxyBootstrapCi,
  scoreFixedGridGroundTruthWithLedger,
  validatePublicScenarioManifest,
  validateSecondaryViennaFit,
  PUBLIC_PROXY_BOOTSTRAP_CONFIG,
  type PublicDatasetProvenance,
  type PublicScenarioManifest,
} from './public-fixed-bpm-benchmark';

function expectCompleteEvaluation(
  evaluation: CompletedContinuousEvaluation | undefined,
): Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }> {
  expect(evaluation?.status).toBe('COMPLETE');
  return evaluation as Extract<CompletedContinuousEvaluation, { status: 'COMPLETE' }>;
}

function scenario(id = 'public-fixed-bpm-scenario'): BenchmarkScenario {
  return {
    scenarioId: id,
    schemaVersion: 1,
    split: 'DEVELOPMENT',
    familyTags: ['BASE_ORIGINAL'],
    source: {
      sourceAudioPath: 'backend/data/work/public_proxy/sample.wav',
      sourceAudioSha256: 'a'.repeat(64),
      sourceMidiPath: 'backend/data/work/public_proxy/sample.mid',
      sourceMidiSha256: 'b'.repeat(64),
      provenance: 'PRIMARY_FIXED_GRID_PROXY',
    },
    audio: {
      nativeSampleRateHz: 48_000,
      channelPolicy: '1_channel_PCM16',
      clipStartMs: 0,
      clipEndMs: 4_000,
      performanceOriginSourceMs: 1_000,
      sourceDurationMs: 4_000,
      pcmIdentity: 'a'.repeat(64),
    },
    expectedStrikes: [
      { strikeId: 's1', groupId: 'g1', pitch: 'C4', expectedPerformanceTimeMs: 0, renderNoteIds: ['n1'] },
      { strikeId: 's2', groupId: 'g2', pitch: 'E4', expectedPerformanceTimeMs: 500, renderNoteIds: ['n2'] },
    ],
    physicalGroundTruth: {
      status: 'RECORDED',
      sourceKind: 'PAIRED_PHYSICAL_MIDI',
      source: 'backend/data/work/public_proxy/sample.mid',
      attacks: [
        { physicalEventId: 'p1', pitch: 'C4', performanceTimeMs: 0, velocity: 90 },
        { physicalEventId: 'p2', pitch: 'E4', performanceTimeMs: 500, velocity: 88 },
      ],
    },
    completion: { kind: 'NATURAL', performanceTimeMs: 1_000 },
    corpusOverlapStatus: 'UNKNOWN',
  };
}

function candidate(id: string, strategyKind: 'CHUNKED' | 'STREAMING'): CandidateDefinition {
  return {
    candidateId: id,
    strategyKind,
    identity: {
      modelRuntime: id,
      adapterVersion: 'test',
      configurationSha256: 'c'.repeat(64),
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };
}

function run(candidateId: string, scenarioId: string): CandidateScenarioRun {
  return {
    candidateId,
    scenarioId,
    publications: [{
      publicationId: `${candidateId}:${scenarioId}:pub`,
      analyzedThroughPerformanceMs: 1_000,
      observations: [
        { observationId: `${candidateId}:o1`, pitch: 'C4', performanceTimeMs: 0, confidence: 1 },
        { observationId: `${candidateId}:o2`, pitch: 'E4', performanceTimeMs: 500, confidence: 1 },
      ],
    }],
  };
}

const primaryDataset: PublicDatasetProvenance = {
  datasetId: 'maps-subset-audited',
  datasetVersion: 'selected-subset',
  sourceUrl: 'https://example.test/maps',
  license: 'dataset-specific',
  role: 'PRIMARY_FIXED_GRID_PROXY',
  trainingOverlapStatus: 'UNKNOWN',
  fixedGridProvenance: {
    audioAndMidiSameTake: true,
    independentScoreTruth: true,
    constantTempoGrid: true,
    configuredBpmSource: 'EXPLICIT_SCORE_OR_MIDI_TEMPO',
  },
};

describe('public fixed-BPM benchmark policy', () => {
  it('removes the obsolete research capture route and device-mocked UI', () => {
    const root = path.resolve(__dirname, '../../../..');
    expect(existsSync(path.join(root, 'src/app/[locale]/(workspace)/research/continuous-capture'))).toBe(false);
    expect(existsSync(path.join(root, 'src/lib/practice/research/continuous-capture-harness.ts'))).toBe(false);
  });

  it('excludes MAESTRO and ASAP from public winner evidence', () => {
    expect(() => assertPublicDatasetMayEnterWinnerEvidence({
      ...primaryDataset,
      datasetId: 'maestro',
      role: 'EXCLUDED_KNOWN_TRAINING_OVERLAP',
      trainingOverlapStatus: 'KNOWN_OVERLAP',
    })).toThrow(/MAESTRO|ASAP|training-overlap/i);
    expect(() => assertPublicDatasetMayEnterWinnerEvidence({
      ...primaryDataset,
      datasetId: 'asap-nasap',
      role: 'EXCLUDED_KNOWN_TRAINING_OVERLAP',
      trainingOverlapStatus: 'KNOWN_OVERLAP',
    })).toThrow(/MAESTRO|ASAP|training-overlap/i);
  });

  it('requires explicit fixed-grid provenance for PRIMARY classification', () => {
    expect(() => assertPrimaryFixedGridProvenance(primaryDataset)).not.toThrow();
    expect(() => assertPrimaryFixedGridProvenance({ ...primaryDataset, fixedGridProvenance: undefined })).toThrow(/fixed-grid/);
  });

  it('keeps Vienna fixed-BPM fitting candidate-independent and uses product integer BPM', () => {
    expect(productIntegerBpm(119.6)).toBe(120);
    expect(productIntegerBpm(40.4)).toBe(40);
    expect(productIntegerBpm(239.6)).toBe(240);
    expect(() => productIntegerBpm(9)).toThrow(/40-240/);
    expect(() => productIntegerBpm(301)).toThrow(/40-240/);
    expect(() => validateSecondaryViennaFit({
      method: 'MEDIAN_LOCAL_MS_PER_QUARTER',
      rawFittedBpm: 121.4,
      configuredIntegerBpm: 121,
      alignmentAnchorCount: 12,
      absoluteResidualP95Ms: 100,
      groundTruthExpectedStrikeMatchRate: 0.96,
    })).not.toThrow();
    expect(() => validateSecondaryViennaFit({
      method: 'MEDIAN_LOCAL_MS_PER_QUARTER',
      rawFittedBpm: 121.4,
      configuredIntegerBpm: 121,
      alignmentAnchorCount: 12,
      absoluteResidualP95Ms: 126,
      groundTruthExpectedStrikeMatchRate: 0.96,
    })).toThrow(/eligibility/);
    expect(() => validateSecondaryViennaFit({
      method: 'MEDIAN_LOCAL_MS_PER_QUARTER',
      rawFittedBpm: 121.6,
      configuredIntegerBpm: 121,
      alignmentAnchorCount: 12,
      absoluteResidualP95Ms: 100,
      groundTruthExpectedStrikeMatchRate: 0.96,
    })).toThrow(/configuredIntegerBpm/);
  });

  it('freezes public manifests before candidate inference and keeps official product rank null', () => {
    const manifest: PublicScenarioManifest = {
      schemaVersion: 1,
      manifestId: 'public-primary-v1',
      layer: 'PRIMARY_FIXED_GRID_PROXY',
      dataset: primaryDataset,
      scenarioFamilies: ['BASE_ORIGINAL', 'COUNTERFACTUAL_MISSING_NOTE'],
      scenarioIds: ['s1'],
      scenarioManifestFrozenBeforeInference: true,
      officialProductEvaluation: false,
    };
    expect(() => validatePublicScenarioManifest(manifest)).not.toThrow();
    expect(canonicalPublicScenarioManifestSha256(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validatePublicScenarioManifest({ ...manifest, candidateOutputIncluded: true })).toThrow(/candidate output/);
    const report = buildPublicDiagnosticBakeoffReport({
      scenarios: [scenario()],
      candidates: [candidate('byte', 'CHUNKED'), candidate('online', 'STREAMING')],
      runs: [run('byte', 'public-fixed-bpm-scenario'), run('online', 'public-fixed-bpm-scenario')],
    });
    expect(report.comparativeRank).toBeNull();
    expect(report.absoluteGateStatus).toBe('NOT_EVALUATED');
    expect(report.officialProductEvaluation).toBe(false);
  });

  it('rejects a frozen public benchmark manifest with zero scenarios', () => {
    const manifest: PublicScenarioManifest = {
      schemaVersion: 1,
      manifestId: 'empty-secondary',
      layer: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
      dataset: {
        ...primaryDataset,
        datasetId: 'vienna-4x22',
        role: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
      },
      scenarioFamilies: ['BASE_ORIGINAL'],
      scenarioIds: [],
      scenarioManifestFrozenBeforeInference: true,
      officialProductEvaluation: false,
    };
    expect(() => validatePublicScenarioManifest(manifest)).toThrow(/zero scenarios/);
  });

  it('keeps public proxy runners on the shared TypeScript contract and pure Node traversal', () => {
    const root = path.resolve(__dirname, '../../../../../..');
    const viennaRunner = readFileSync(
      path.join(root, 'backend/research/browser_runtime/run_vienna_fixed_bpm_proxy_benchmark.mjs'),
      'utf8'
    );
    expect(viennaRunner).toContain('createJiti');
    expect(viennaRunner).toContain('publicContract.validatePublicScenarioManifest');
    expect(viennaRunner).toContain('publicContract.canonicalPublicScenarioManifestSha256');

    const legacyRunner = readFileSync(
      path.join(root, 'backend/research/browser_runtime/run_public_fixed_bpm_proxy_benchmark.mjs'),
      'utf8'
    );
    expect(legacyRunner).not.toContain('Get-ChildItem');
    expect(legacyRunner).toContain('function walkFiles');
  });

  it('keeps B3 counterfactual artifact hashes and acoustic reuse receipts executable', () => {
    const root = path.resolve(__dirname, '../../../../../..');
    const viennaRunner = readFileSync(
      path.join(root, 'backend/research/browser_runtime/run_vienna_fixed_bpm_proxy_benchmark.mjs'),
      'utf8'
    );
    expect(viennaRunner).toContain('mutationContentSha256');
    expect(viennaRunner).toContain('finalDerivedPracticeScoreArtifactSha256');
    expect(viennaRunner).toContain('byteDanceGeometryIdentity(baseScenario)');
    expect(viennaRunner).toContain('onlineAmtGeometryIdentity(baseScenario)');
    expect(viennaRunner).toContain('ACOUSTIC_EVIDENCE_REUSE_REJECTED_GEOMETRY_MISMATCH');
    expect(viennaRunner).not.toContain('sameByteDanceChunkGeometry: true');
    expect(viennaRunner).toContain('rawScoreDefinedScopeAttemptCount');
    expect(viennaRunner).toContain('scopeCountDefinitions');
  });

  it('freezes the 9G-A performer-disjoint calibration protocol before blind execution', () => {
    const root = path.resolve(__dirname, '../../../../../..');
    const protocol = JSON.parse(readFileSync(
      path.join(root, 'backend/research/policies/public_model_calibration_protocol_v1_2026-10-09.json'),
      'utf8'
    ));
    expect(protocol.policyId).toBe('PUBLIC_MODEL_CALIBRATION_PROTOCOL_V1');
    expect(protocol.performerDisjointPartitions.calibrationProxyPerformers)
      .toEqual(['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14']);
    expect(protocol.performerDisjointPartitions.blindEvaluationProxyPerformers)
      .toEqual(['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22']);
    expect(protocol.performerDisjointPartitions.blindEvaluationPolicy.candidateInferenceAllowedInPhase9GA)
      .toBe(false);
    expect(protocol.calibrationFamilies).toEqual([
      'BASE_ORIGINAL',
      'COUNTERFACTUAL_MISSING_NOTE',
      'COUNTERFACTUAL_EXTRA_NOTE',
      'COUNTERFACTUAL_WRONG_SEMITONE',
      'COUNTERFACTUAL_INCOMPLETE_CHORD',
    ]);
    expect(protocol.calibrationDecisionPolicy.priorityOrder[0])
      .toMatch(/falseMatchRateOnGroundTruthMissing/);
    expect(protocol.qualificationGate.phase9GAProductionWinnerAllowed).toBe(false);
  });

  it('keeps score-derived truth separate from physical MIDI and uses the ledger for ground truth', () => {
    const scored = scoreFixedGridGroundTruthWithLedger(scenario());
    expect(scored.groundTruthStatus).toBe('MEASURED');
    expect(scored.candidateEvaluation.status).toBe('COMPLETE');
    expect(scored.metrics.verdictAgreementRate.status).toBe('MEASURED');
  });

  it('keeps expected score pitch independent from wrong performance MIDI pitch', () => {
    const base = scenario('wrong-pitch');
    const wrongPitchScenario: BenchmarkScenario = {
      ...base,
      expectedStrikes: [
        { strikeId: 's-c4', groupId: 'g-c4', pitch: 'C4', expectedPerformanceTimeMs: 0, renderNoteIds: ['score-c4'] },
      ],
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'PAIRED_PHYSICAL_MIDI',
        source: base.physicalGroundTruth!.source,
        attacks: [
          { physicalEventId: 'midi-c-sharp', pitch: 'C#4', performanceTimeMs: 0, velocity: 90 },
        ],
      },
      completion: { kind: 'NATURAL', performanceTimeMs: 500 },
    };
    const scored = scoreCandidate(wrongPitchScenario, candidate('probe', 'CHUNKED'), {
      candidateId: 'probe',
      scenarioId: wrongPitchScenario.scenarioId,
      publications: [{
        publicationId: 'probe',
        analyzedThroughPerformanceMs: 500,
        observations: [{ observationId: 'midi-c-sharp', pitch: 'C#4', performanceTimeMs: 0 }],
      }],
    });
    expect(wrongPitchScenario.expectedStrikes[0].pitch).toBe('C4');
    expect(wrongPitchScenario.physicalGroundTruth!.attacks[0].pitch).toBe('C#4');
    const groundTruth = expectCompleteEvaluation(scored.groundTruthEvaluation);
    expect(groundTruth.strikes[0].result).toBe('MISSING');
    expect(groundTruth.extras).toHaveLength(1);
  });

  it('preserves score deletions, performance insertions, and same-pitch retriggers', () => {
    const deletion: BenchmarkScenario = {
      ...scenario('deletion'),
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'PAIRED_PHYSICAL_MIDI',
        source: 'same-take-midi',
        attacks: [{ physicalEventId: 'only-c4', pitch: 'C4', performanceTimeMs: 0 }],
      },
    };
    const deletionScored = scoreCandidate(deletion, candidate('deletion-probe', 'CHUNKED'), {
      candidateId: 'deletion-probe',
      scenarioId: deletion.scenarioId,
      publications: [{
        publicationId: 'deletion-probe',
        analyzedThroughPerformanceMs: 1_000,
        observations: [{ observationId: 'only-c4', pitch: 'C4', performanceTimeMs: 0 }],
      }],
    });
    const deletionGroundTruth = expectCompleteEvaluation(deletionScored.groundTruthEvaluation);
    expect(deletionGroundTruth.strikes.find((strike) => strike.strikeId === 's2')?.result)
      .toBe('MISSING');

    const insertion: BenchmarkScenario = {
      ...scenario('insertion'),
      expectedStrikes: [
        { strikeId: 's-c4', groupId: 'g-c4', pitch: 'C4', expectedPerformanceTimeMs: 0, renderNoteIds: ['score-c4'] },
      ],
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'PAIRED_PHYSICAL_MIDI',
        source: 'same-take-midi',
        attacks: [
          { physicalEventId: 'c4', pitch: 'C4', performanceTimeMs: 0 },
          { physicalEventId: 'g4-extra', pitch: 'G4', performanceTimeMs: 120 },
          { physicalEventId: 'c4-retrigger', pitch: 'C4', performanceTimeMs: 300 },
        ],
      },
      completion: { kind: 'NATURAL', performanceTimeMs: 600 },
    };
    const insertionScored = scoreCandidate(insertion, candidate('insertion-probe', 'CHUNKED'), {
      candidateId: 'insertion-probe',
      scenarioId: insertion.scenarioId,
      publications: [{
        publicationId: 'insertion-probe',
        analyzedThroughPerformanceMs: 600,
        observations: insertion.physicalGroundTruth!.attacks.map((attack) => ({
          observationId: attack.physicalEventId,
          pitch: attack.pitch,
          performanceTimeMs: attack.performanceTimeMs,
        })),
      }],
    });
    expect(insertion.physicalGroundTruth!.attacks.map((attack) => attack.physicalEventId))
      .toEqual(['c4', 'g4-extra', 'c4-retrigger']);
    const insertionGroundTruth = expectCompleteEvaluation(insertionScored.groundTruthEvaluation);
    expect(insertionGroundTruth.extras.map((extra) => extra.pitch).sort())
      .toEqual(['C4', 'G4']);
  });

  it('prevents counterfactuals from mutating audio or MIDI identity', () => {
    const base = scenario('base');
    const mutated = { ...base, scenarioId: 'counterfactual', expectedStrikes: [{ ...base.expectedStrikes[0], pitch: 'C#4' }] };
    expect(() => assertCounterfactualPreservesAudioAndMidi({ base, mutated })).not.toThrow();
    expect(() => assertCounterfactualPreservesAudioAndMidi({
      base,
      mutated: { ...mutated, source: { ...mutated.source, sourceMidiSha256: 'd'.repeat(64) } },
    })).toThrow(/audio and physical MIDI/);
  });

  it('requires matched scenario binding and preserves frozen candidate configs', () => {
    const base = scenario();
    expect(() => assertMatchedCandidateAudioIdentity({
      scenario: base,
      byteDanceRun: run('bytedance-score-aware-chunked-dev-v1', base.scenarioId),
      onlineAmtRun: run('online-amt-stateful-modern-compat-dev-v1', base.scenarioId),
    })).not.toThrow();
    expect(() => assertMatchedCandidateAudioIdentity({
      scenario: base,
      byteDanceRun: run('bytedance-score-aware-chunked-dev-v1', base.scenarioId),
      onlineAmtRun: run('online-amt-stateful-modern-compat-dev-v1', 'other'),
    })).toThrow(/same scenario/);
    expect(() => assertFrozenCandidateConfigsUnchanged()).not.toThrow();
  });

  it('keeps Primary and Secondary conclusions separate', () => {
    expect(decideOverallPublicEvidence({ primary: 'BYTE_DANCE_BETTER', secondary: 'ONLINE_AMT_BETTER' }))
      .toBe('NO_CLEAR_WINNER_ON_PUBLIC_FIXED_BPM_PROXY');
    expect(decideOverallPublicEvidence({ primary: 'UNAVAILABLE', secondary: 'ONLINE_AMT_BETTER' }))
      .toBe('PREFERRED_ON_SECONDARY_HUMAN_PROXY');
    expect(decideOverallPublicEvidence({ primary: 'BYTE_DANCE_BETTER', secondary: 'NO_CLEAR_WINNER' }))
      .toBe('PREFERRED_ON_PUBLIC_FIXED_BPM_EVIDENCE');
  });

  it('uses a bootstrap that is not degenerate for nonconstant 32-element vectors', () => {
    const values = Array.from({ length: 32 }, (_, index) => (index % 5) / 100);
    const ci = publicProxyBootstrapCi(values);
    expect(ci.draws).toBeGreaterThanOrEqual(5_000);
    expect(ci.high).toBeGreaterThan(ci.low);
  });

  it('keeps bootstrap deterministic and degenerate only for constant vectors', () => {
    const constant = Array.from({ length: 32 }, () => 0.25);
    expect(publicProxyBootstrapCi(constant)).toEqual(publicProxyBootstrapCi(constant));
    const ci = publicProxyBootstrapCi(constant);
    expect(ci.low).toBe(0.25);
    expect(ci.high).toBe(0.25);
  });

  it.each([8, 12, 19, 30, 32, 33])('avoids low-bit modulo artifacts for sample length %i', (length) => {
    const values = Array.from({ length }, (_, index) => (index % 7) / 50);
    const ci = publicProxyBootstrapCi(values);
    expect(ci.high).toBeGreaterThan(ci.low);
  });

  it('requires at least 5000 bootstrap draws in public paired reports', () => {
    expect(PUBLIC_PROXY_BOOTSTRAP_CONFIG.draws).toBeGreaterThanOrEqual(5_000);
    expect(() => publicProxyBootstrapCi([0, 1], { seed: 1, draws: 100 }))
      .toThrow(/at least 5000/);
  });

  it('applies safety vetoes and insufficient-family conservatism in the shared decision policy', () => {
    const measured = (diff: number, low: number, high: number, sampleCount = 32) => ({
      status: 'MEASURED' as const,
      sampleCount,
      meanDifferenceByteDanceMinusOnlineAmt: diff,
      bootstrap95Ci: { low, high, seed: 13_371, draws: 5_000 },
    });
    const notEvaluated = {
      status: 'NOT_EVALUATED' as const,
      sampleCount: 0,
      meanDifferenceByteDanceMinusOnlineAmt: null,
      bootstrap95Ci: null,
    };
    const paired = (verdictDiff: number, safetyDiff = 0) => ({
      pairedScenarioCount: 32,
      bootstrap: PUBLIC_PROXY_BOOTSTRAP_CONFIG,
      metrics: {
        verdictAgreementRate: measured(verdictDiff, verdictDiff - 0.02, verdictDiff + 0.02),
        falseMatchRateOnGroundTruthMissing: measured(safetyDiff, safetyDiff - 0.001, safetyDiff + 0.001),
        correctMissingRate: measured(0, -0.001, 0.001),
        chordExactCompletenessRate: measured(0, -0.001, 0.001),
        falseCompleteChordAcceptanceRate: measured(0, -0.001, 0.001),
        expectedStrikeRecall: measured(0, -0.001, 0.001),
        extraPrecision: measured(0, -0.001, 0.001),
        extraRecall: measured(0, -0.001, 0.001),
        timingAbsoluteMedianMs: measured(0, -0.001, 0.001),
        timingAbsoluteP95Ms: measured(0, -0.001, 0.001),
      },
    });
    const sufficientFamilies = {
      COUNTERFACTUAL_MISSING_NOTE: { status: 'MEASURED' as const, paired: paired(0.02) },
      COUNTERFACTUAL_WRONG_SEMITONE: { status: 'MEASURED' as const, paired: paired(0.02) },
      COUNTERFACTUAL_INCOMPLETE_CHORD: { status: 'MEASURED' as const, paired: paired(0.02) },
    };
    expect(decideSecondaryHumanFixedBpmProxy({ base: paired(0.03), families: sufficientFamilies }))
      .toBe('BYTE_DANCE_BETTER');
    expect(decideSecondaryHumanFixedBpmProxy({ base: paired(-0.03), families: sufficientFamilies }))
      .toBe('ONLINE_AMT_BETTER');
    expect(decideSecondaryHumanFixedBpmProxy({
      base: paired(0.03),
      families: {
        ...sufficientFamilies,
        COUNTERFACTUAL_MISSING_NOTE: { status: 'MEASURED', paired: paired(0.03, 0.02) },
      },
    })).toBe('NO_CLEAR_WINNER');
    expect(decideSecondaryHumanFixedBpmProxy({
      base: paired(0.03),
      families: {
        ...sufficientFamilies,
        COUNTERFACTUAL_WRONG_SEMITONE: {
          status: 'INSUFFICIENT_FAMILY_EVIDENCE',
          paired: { ...paired(0.03), metrics: { ...paired(0.03).metrics, verdictAgreementRate: notEvaluated } },
        },
      },
    })).toBe('NO_CLEAR_WINNER');
    expect(decideSecondaryHumanFixedBpmProxy({ base: paired(0.005), families: sufficientFamilies }))
      .toBe('NO_CLEAR_WINNER');
  });
});
