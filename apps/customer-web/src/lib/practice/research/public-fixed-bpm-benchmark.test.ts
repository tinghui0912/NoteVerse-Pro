import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { BenchmarkScenario, CandidateDefinition, CandidateScenarioRun } from './continuous-analyzer-bakeoff';
import {
  assertCounterfactualPreservesAudioAndMidi,
  assertFrozenCandidateConfigsUnchanged,
  assertMatchedCandidateAudioIdentity,
  assertPrimaryFixedGridProvenance,
  assertPublicDatasetMayEnterWinnerEvidence,
  buildPublicDiagnosticBakeoffReport,
  canonicalPublicScenarioManifestSha256,
  decideOverallPublicEvidence,
  productIntegerBpm,
  scoreFixedGridGroundTruthWithLedger,
  validatePublicScenarioManifest,
  validateSecondaryViennaFit,
  type PublicDatasetProvenance,
  type PublicScenarioManifest,
} from './public-fixed-bpm-benchmark';

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

  it('keeps score-derived truth separate from physical MIDI and uses the ledger for ground truth', () => {
    const scored = scoreFixedGridGroundTruthWithLedger(scenario());
    expect(scored.groundTruthStatus).toBe('MEASURED');
    expect(scored.candidateEvaluation.status).toBe('COMPLETE');
    expect(scored.metrics.verdictAgreementRate.status).toBe('MEASURED');
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
});
