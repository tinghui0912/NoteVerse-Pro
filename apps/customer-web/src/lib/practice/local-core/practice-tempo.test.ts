import { describe, expect, it } from 'vitest';
import { PracticeScoreArtifact } from './artifact';
import {
  clampCustomTempo,
  DEFAULT_PRACTICE_TEMPO_BPM,
  hasExplicitScoreTempo,
  hasScoreTempoChanges,
  effectiveScoreTempoAtBeat,
  initialScoreTempoBpm,
  isCustomTempoValid,
  MAX_PRACTICE_TEMPO_BPM,
  MIN_PRACTICE_TEMPO_BPM,
  PracticeTempoTimeline,
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
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'PRODUCT_DEFAULT' }],
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
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 112, source: 'MUSICXML' },
          { startBeat: 8, bpm: 96, source: 'MUSICXML' },
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
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 80, source: 'PRODUCT_DEFAULT' },
          { startBeat: 4, bpm: 100, source: 'MUSICXML' },
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
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 },
        segments: [{ startBeat: 0, bpm: 60, source: 'CUSTOM' }],
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

  describe('effectiveScoreTempoAtBeat', () => {
    it('returns default 80 if artifact has no tempo segments', () => {
      const artifact = createMockArtifact([]);
      const eff = effectiveScoreTempoAtBeat(artifact, 0);
      expect(eff).toEqual({
        bpm: 80,
        isDefault: true,
        hasSubsequentChanges: false,
      });
    });

    it('returns default 80 with hasSubsequentChanges if first explicit tempo is at beat > 0', () => {
      const artifact = createMockArtifact([{ startBeat: 4, bpm: 120 }]);
      const eff = effectiveScoreTempoAtBeat(artifact, 0);
      expect(eff).toEqual({
        bpm: 80,
        isDefault: true,
        hasSubsequentChanges: true,
        explicitStartBeat: 4,
      });
    });

    it('returns active tempo at scopeStartBeat when multiple tempo segments exist', () => {
      const artifact = createMockArtifact([
        { startBeat: 0, bpm: 100 },
        { startBeat: 8, bpm: 120 },
        { startBeat: 16, bpm: 90 },
      ]);
      const effAt0 = effectiveScoreTempoAtBeat(artifact, 0);
      expect(effAt0.bpm).toBe(100);
      expect(effAt0.isDefault).toBe(false);
      expect(effAt0.hasSubsequentChanges).toBe(true);

      const effAt10 = effectiveScoreTempoAtBeat(artifact, 10);
      expect(effAt10.bpm).toBe(120);
      expect(effAt10.isDefault).toBe(false);
      expect(effAt10.hasSubsequentChanges).toBe(true);

      const effAt20 = effectiveScoreTempoAtBeat(artifact, 20);
      expect(effAt20.bpm).toBe(90);
      expect(effAt20.isDefault).toBe(false);
      expect(effAt20.hasSubsequentChanges).toBe(false);
    });
  });

  describe('PracticeTempoTimeline', () => {
    it('calculates beatToTimeMs, timeMsToBeat, and bpmAtBeat accurately across tempo changes', () => {
      const plan = resolvePracticeTempoPlan(
        createMockArtifact([
          { startBeat: 0, bpm: 120 }, // 1 beat = 500ms
          { startBeat: 4, bpm: 60 },  // 1 beat = 1000ms
        ]),
        { mode: 'SCORE' }
      );
      const timeline = new PracticeTempoTimeline(plan, 8);

      expect(timeline.bpmAtBeat(0)).toBe(120);
      expect(timeline.bpmAtBeat(2)).toBe(120);
      expect(timeline.bpmAtBeat(4)).toBe(60);
      expect(timeline.bpmAtBeat(6)).toBe(60);

      // Beat to time
      expect(timeline.beatToTimeMs(0)).toBe(0);
      expect(timeline.beatToTimeMs(2)).toBe(1000);
      expect(timeline.beatToTimeMs(4)).toBe(2000);
      expect(timeline.beatToTimeMs(5)).toBe(3000);
      expect(timeline.beatToTimeMs(8)).toBe(6000);

      // Time to beat
      expect(timeline.timeMsToBeat(0)).toBe(0);
      expect(timeline.timeMsToBeat(1000)).toBe(2);
      expect(timeline.timeMsToBeat(2000)).toBe(4);
      expect(timeline.timeMsToBeat(3000)).toBe(5);
      expect(timeline.timeMsToBeat(6000)).toBe(8);

      expect(timeline.durationMs).toBe(6000);
    });
  });
});
