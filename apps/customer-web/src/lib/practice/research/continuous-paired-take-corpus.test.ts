import { describe, expect, it } from 'vitest';

import { scoreCandidate } from './continuous-analyzer-bakeoff';
import { ContinuousFinalizationLedger } from '../local-core/continuous-finalization-ledger';
import {
  auditContinuousPairedTakeCorpus,
  canonicalManifestSha256,
  importContinuousPairedTakeAsBenchmarkScenario,
  validateContinuousPairedTake,
  validateContinuousPairedTakeManifest,
  type ContinuousPairedTake,
  type ContinuousPairedTakeManifest,
} from './continuous-paired-take-corpus';
import { onlineAmtCandidateDefinition } from './online-amt-stateful-streaming';

function take(overrides: Partial<ContinuousPairedTake> = {}): ContinuousPairedTake {
  const base: ContinuousPairedTake = {
    takeId: 'take-dev-001',
    captureSessionId: 'session-a',
    split: 'DEVELOPMENT',
    product: {
      configuredBpm: 90,
      scopeId: 'mini-etude-1',
      startPerformanceTimeMs: 0,
      completion: { kind: 'NATURAL', performanceTimeMs: 1_000 },
    },
    score: {
      practiceScoreArtifactSha256: 'score-sha',
      practiceScoreArtifactVersion: 'PracticeScoreArtifact.v1',
      expectedStrikes: [
        { strikeId: 'c4', groupId: 'g1', pitch: 'C4', expectedPerformanceTimeMs: 250, renderNoteIds: ['n1'] },
        { strikeId: 'e4', groupId: 'g2', pitch: 'E4', expectedPerformanceTimeMs: 500, renderNoteIds: ['n2'] },
      ],
    },
    audio: {
      path: 'backend/data/work/continuous/take-dev-001.wav',
      sha256: 'audio-sha',
      sampleRateHz: 48_000,
      channelCount: 1,
      encoding: 'PCM16_WAV',
      durationMs: 5_000,
      performanceOriginSourceMs: 2_000,
      preRollMs: 2_000,
      postRollMs: 2_000,
    },
    midi: {
      path: 'backend/data/work/continuous/take-dev-001.mid',
      sha256: 'midi-sha',
      sameTake: true,
      noteOns: [
        { eventId: 'note-on-c4-a', pitch: 'C4', performanceTimeMs: 250, velocity: 70 },
        { eventId: 'note-on-c4-b', pitch: 'C4', performanceTimeMs: 330, velocity: 72 },
        { eventId: 'wrong-f4', pitch: 'F4', performanceTimeMs: 500, velocity: 80 },
      ],
      rawControlEventCount: 1,
    },
    segments: [{
      segmentId: 'seg-0',
      sourcePerformanceStartSampleBoundary: 96_000,
      sourcePerformanceEndSampleBoundary: 144_000,
      sourceContextTailEndSampleBoundary: 240_000,
      performanceStartMs: 0,
      performanceEndMs: 1_000,
    }],
    sync: { quality: 'SHARED_CAPTURE_CLOCK_VERIFIED', method: 'shared browser capture origin' },
    taxonomy: ['correct_single', 'extra_wrong_note', 'same_pitch_retrigger'],
    captureInstructions: ['Play C4, then intentionally play F4 where E4 is written.'],
  };
  return { ...base, ...overrides };
}

function manifest(takes: ContinuousPairedTake[]): ContinuousPairedTakeManifest {
  return { schemaVersion: 1, manifestId: 'continuous-dev-v1', split: 'DEVELOPMENT', takes };
}

describe('Continuous paired take corpus contract', () => {
  it('imports a valid same-take recording into the existing BenchmarkScenario contract', () => {
    const scenario = importContinuousPairedTakeAsBenchmarkScenario(take());
    expect(scenario.expectedStrikes.map((strike) => strike.pitch)).toEqual(['C4', 'E4']);
    expect(scenario.physicalGroundTruth?.attacks.map((attack) => attack.pitch)).toEqual(['C4', 'C4', 'F4']);
    expect(scenario.completion).toEqual({ kind: 'NATURAL', performanceTimeMs: 1_000 });
  });

  it('rejects physical-MIDI-derived expected score and missing completion', () => {
    expect(() => validateContinuousPairedTake(take({
      score: {
        ...take().score,
        expectedStrikes: [
          { strikeId: 'a', groupId: 'a', pitch: 'C4', expectedPerformanceTimeMs: 250, renderNoteIds: ['a'] },
          { strikeId: 'b', groupId: 'b', pitch: 'C4', expectedPerformanceTimeMs: 330, renderNoteIds: ['b'] },
          { strikeId: 'c', groupId: 'c', pitch: 'F4', expectedPerformanceTimeMs: 500, renderNoteIds: ['c'] },
        ],
      },
    }))).toThrow(/physical MIDI/);
    expect(() => validateContinuousPairedTake(take({
      product: { ...take().product, completion: undefined as never },
    }))).toThrow(/completion/);
  });

  it('preserves manual completion and rejects insufficient synchronization', () => {
    expect(() => validateContinuousPairedTake(take({
      product: { ...take().product, completion: { kind: 'MANUAL', performanceTimeMs: 650 } },
      midi: { ...take().midi, noteOns: take().midi.noteOns.slice(0, 2) },
      segments: [{ ...take().segments[0], performanceEndMs: 650 }],
    }))).not.toThrow();
    expect(() => validateContinuousPairedTake(take({
      sync: { quality: 'INSUFFICIENT_SYNCHRONIZATION', method: 'none' },
    }))).toThrow(/synchronization/);
  });

  it('uses half-open source sample boundaries and does not let context tail extend performance ownership', () => {
    expect(() => validateContinuousPairedTake(take({
      segments: [{ ...take().segments[0], sourceContextTailEndSampleBoundary: 143_999 }],
    }))).toThrow(/half-open/);
    expect(() => validateContinuousPairedTake(take({
      segments: [{ ...take().segments[0], performanceEndMs: 1_001 }],
    }))).toThrow(/Context tail/);
  });

  it('supports pause/resume as distinct non-overlapping segments', () => {
    const paused = take({
      segments: [
        { ...take().segments[0], segmentId: 'seg-0', performanceEndMs: 400 },
        {
          segmentId: 'seg-1',
          sourcePerformanceStartSampleBoundary: 200_000,
          sourcePerformanceEndSampleBoundary: 228_800,
          sourceContextTailEndSampleBoundary: 240_000,
          performanceStartMs: 400,
          performanceEndMs: 1_000,
        },
      ],
    });
    expect(() => validateContinuousPairedTake(paused)).not.toThrow();
    expect(() => validateContinuousPairedTake(take({
      segments: [take().segments[0], { ...take().segments[0], segmentId: 'seg-1', performanceStartMs: 999 }],
    }))).toThrow(/overlap/);
  });

  it('detects split leakage and separates corpus validity from candidate context eligibility', () => {
    const shortContext = take({ takeId: 'short-context', audio: { ...take().audio, preRollMs: 500 } });
    const audit = auditContinuousPairedTakeCorpus(manifest([shortContext]));
    expect(audit.scoreableTakeCount).toBe(1);
    expect(audit.candidateEligibility['bytedance-score-aware-chunked-dev-v1']['short-context']).toBe('INELIGIBLE_INSUFFICIENT_CONTEXT');
    expect(audit.candidateEligibility['online-amt-stateful-modern-compat-dev-v1']['short-context']).toBe('ELIGIBLE');

    expect(() => validateContinuousPairedTakeManifest({
      ...manifest([
        take({ takeId: 'dev', split: 'DEVELOPMENT' }),
        take({ takeId: 'eval', split: 'EVALUATION' }),
      ]),
    })).toThrow(/split leakage/);
  });

  it('imports to the shared ContinuousFinalizationLedger scoring path', () => {
    const scenario = importContinuousPairedTakeAsBenchmarkScenario(take());
    const ledger = new ContinuousFinalizationLedger({
      expectedStrikes: scenario.expectedStrikes,
      assignmentWindowMs: 100,
    });
    ledger.publishObservations([{ observationId: 'obs-c4', pitch: 'C4', performanceTimeMs: 250, confidence: 1, source: 'ACOUSTIC' }], 1_000);
    ledger.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 1_000, terminalPerformanceMs: 1_000 });
    expect(ledger.completedEvaluation().status).toBe('COMPLETE');

    const definition = onlineAmtCandidateDefinition({ gitHead: 'test' });
    expect(() => scoreCandidate(scenario, definition, {
      candidateId: definition.candidateId,
      scenarioId: scenario.scenarioId,
      publications: [{
        publicationId: 'candidate-pub-1',
        observations: [{ observationId: 'candidate-c4', pitch: 'C4', performanceTimeMs: 250 }],
        analyzedThroughPerformanceMs: 1_000,
      }],
    })).not.toThrow();
  });

  it('keeps synthetic capture smoke out of real development counts', () => {
    expect(auditContinuousPairedTakeCorpus(manifest([]))).toMatchObject({
      takeCount: 0,
      scoreableTakeCount: 0,
      blockedTakeCount: 0,
    });
    expect(canonicalManifestSha256(manifest([]))).toMatch(/^[a-f0-9]{64}$/);
  });
});
