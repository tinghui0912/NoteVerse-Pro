import { describe, expect, it } from 'vitest';
import { PracticeScoreArtifact } from './artifact';
import {
  clampCustomTempo,
  DEFAULT_PRACTICE_TEMPO_BPM,
  hasExplicitScoreTempo,
  hasScoreTempoChanges,
  initialScoreTempoBpm,
  isCustomTempoValid,
  MAX_PRACTICE_TEMPO_BPM,
  MIN_PRACTICE_TEMPO_BPM,
  resolvePracticeTempoPlan,
} from './practice-tempo';

function createMockArtifact(scoreTempoSegments: { startBeat: number; bpm: number }[]): PracticeScoreArtifact {
  return {
    schemaVersion: 2,
    scoreId: 'test-score',
    revisionId: 'test-revision',
    artifactId: 'test-artifact',
    playableEvents: [],
    expectedPracticeGroups: [],
    practiceAttackSteps: [],
    meterSegments: [],
    scoreTempoSegments,
    firstPlayableBeat: 0,
    scoreEndBeat: 16,
  };
}

describe('practice-tempo', () => {
  describe('constants & validation', () => {
    it('defines standard boundaries and product default', () => {
      expect(DEFAULT_PRACTICE_TEMPO_BPM).toBe(80);
      expect(MIN_PRACTICE_TEMPO_BPM).toBe(40);
      expect(MAX_PRACTICE_TEMPO_BPM).toBe(240);
    });

    it('validates custom bpm range', () => {
      expect(isCustomTempoValid(40)).toBe(true);
      expect(isCustomTempoValid(240)).toBe(true);
      expect(isCustomTempoValid(120)).toBe(true);
      expect(isCustomTempoValid(39)).toBe(false);
      expect(isCustomTempoValid(241)).toBe(false);
      expect(isCustomTempoValid(NaN)).toBe(false);
      expect(isCustomTempoValid(Infinity)).toBe(false);
    });

    it('clamps custom bpm', () => {
      expect(clampCustomTempo(30)).toBe(40);
      expect(clampCustomTempo(300)).toBe(240);
      expect(clampCustomTempo(120.4)).toBe(120);
      expect(clampCustomTempo(120.6)).toBe(121);
      expect(clampCustomTempo(NaN)).toBe(80);
    });
  });

  describe('resolvePracticeTempoPlan', () => {
    it('resolves SCORE mode with empty scoreTempoSegments to PRODUCT_DEFAULT 80 BPM', () => {
      const artifact = createMockArtifact([]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

      expect(plan).toEqual({
        source: 'PRODUCT_DEFAULT',
        segments: [{ startBeat: 0, bpm: 80 }],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(false);
      expect(initialScoreTempoBpm(artifact)).toBe(80);
      expect(hasScoreTempoChanges(artifact)).toBe(false);
    });

    it('resolves SCORE mode with explicit tempo starting at beat 0 to MUSICXML', () => {
      const artifact = createMockArtifact([
        { startBeat: 0, bpm: 112 },
        { startBeat: 8, bpm: 96 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

      expect(plan).toEqual({
        source: 'MUSICXML',
        segments: [
          { startBeat: 0, bpm: 112 },
          { startBeat: 8, bpm: 96 },
        ],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(true);
      expect(initialScoreTempoBpm(artifact)).toBe(112);
      expect(hasScoreTempoChanges(artifact)).toBe(true);
    });

    it('resolves SCORE mode with first tempo starting at beat > 0 by prepending default 80 BPM at beat 0', () => {
      const artifact = createMockArtifact([
        { startBeat: 4, bpm: 100 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

      expect(plan).toEqual({
        source: 'MUSICXML',
        segments: [
          { startBeat: 0, bpm: 80 },
          { startBeat: 4, bpm: 100 },
        ],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(true);
      expect(initialScoreTempoBpm(artifact)).toBe(100);
      expect(hasScoreTempoChanges(artifact)).toBe(false);
    });

    it('resolves CUSTOM_FIXED_BPM mode across entire practice score', () => {
      const artifact = createMockArtifact([
        { startBeat: 0, bpm: 140 },
        { startBeat: 8, bpm: 120 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'CUSTOM_FIXED_BPM', bpm: 60 });

      expect(plan).toEqual({
        source: 'CUSTOM',
        segments: [{ startBeat: 0, bpm: 60 }],
      });
    });

    it('rejects invalid custom bpm', () => {
      const artifact = createMockArtifact([]);
      expect(() =>
        resolvePracticeTempoPlan(artifact, { mode: 'CUSTOM_FIXED_BPM', bpm: 20 })
      ).toThrowError(/Custom practice tempo must be between 40 and 240/);
      expect(() =>
        resolvePracticeTempoPlan(artifact, { mode: 'CUSTOM_FIXED_BPM', bpm: 300 })
      ).toThrowError(/Custom practice tempo must be between 40 and 240/);
    });
  });
});
