import { DEFAULT_SCORE_TEMPO_BPM } from '@/lib/score/tempo-policy';
import canonical from '../__fixtures__/canonical-practice-score-artifact.json';
import { parsePracticeScoreArtifact } from './artifact';
import { leadingRestArtifact } from '@/lib/practice/__fixtures__/leading-rest-artifact';
import { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import {
  clampCustomTempo,
  effectiveScoreTempoAtTick,
  hasExplicitScoreTempo,
  hasScoreTempoChanges,
  initialScoreTempoBpm,
  isCustomTempoValid,
  MAX_PRACTICE_TEMPO_BPM,
  MIN_PRACTICE_TEMPO_BPM,
  PracticeTempoTimeline,
  resolvePracticeTempoPlan,
} from '@/lib/practice/kernel/tempo';
import { describe, expect, it } from 'vitest';

function createMockArtifact(scoreTempoSegments: { startTick: number; bpm: number }[]): PracticeScoreArtifact {
  return {
    schemaVersion: 1, ticksPerQuarter: 1,
    scoreId: 'test-score',
    revisionId: 'test-revision',
    artifactId: 'test-artifact',
    notes: [],
    events: [],
    moments: [],
    meterSegments: [],
    scoreTempoSegments,

    scoreEndTick: 16,
  };
}

describe('practice-tempo', () => {
  describe('constants & validation', () => {
    it('defines standard boundaries and product default', () => {
      expect(DEFAULT_SCORE_TEMPO_BPM).toBe(80);
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
      expect(() => clampCustomTempo(NaN)).toThrow();
    });
  });

  describe('resolvePracticeTempoPlan', () => {
    it('resolves SCORE mode with empty scoreTempoSegments to PRODUCT_DEFAULT 80 BPM', () => {
      const artifact = createMockArtifact([]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

      expect(plan).toEqual({
        selection: { mode: 'SCORE' },
        segments: [{ startTick: 0, bpm: 80, source: 'PRODUCT_DEFAULT' }],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(false);
      expect(initialScoreTempoBpm(artifact)).toBe(80);
      expect(hasScoreTempoChanges(artifact)).toBe(false);
    });

    it('resolves SCORE mode with explicit tempo starting at tick 0 to MUSICXML', () => {
      const artifact = createMockArtifact([
        { startTick: 0, bpm: 112 },
        { startTick: 8, bpm: 96 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

      expect(plan).toEqual({
        selection: { mode: 'SCORE' },
        segments: [
          { startTick: 0, bpm: 112, source: 'MUSICXML' },
          { startTick: 8, bpm: 96, source: 'MUSICXML' },
        ],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(true);
      expect(initialScoreTempoBpm(artifact)).toBe(112);
      expect(hasScoreTempoChanges(artifact)).toBe(true);
    });

    it('resolves SCORE mode with first tempo starting at tick > 0 by prepending default 80 BPM at tick 0', () => {
      const artifact = createMockArtifact([
        { startTick: 4, bpm: 100 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

      expect(plan).toEqual({
        selection: { mode: 'SCORE' },
        segments: [
          { startTick: 0, bpm: 80, source: 'PRODUCT_DEFAULT' },
          { startTick: 4, bpm: 100, source: 'MUSICXML' },
        ],
      });
      expect(hasExplicitScoreTempo(artifact)).toBe(true);
      expect(initialScoreTempoBpm(artifact)).toBe(80);
      expect(hasScoreTempoChanges(artifact)).toBe(false);
    });

    it('resolves CUSTOM_FIXED_BPM mode across entire practice score', () => {
      const artifact = createMockArtifact([
        { startTick: 0, bpm: 140 },
        { startTick: 8, bpm: 120 },
      ]);
      const plan = resolvePracticeTempoPlan(artifact, { mode: 'CUSTOM_FIXED_BPM', bpm: 60 });

      expect(plan).toEqual({
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 },
        segments: [{ startTick: 0, bpm: 60, source: 'CUSTOM' }],
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

  describe('effectiveScoreTempoAtTick', () => {
    it('returns default 80 with PRODUCT_DEFAULT source if artifact has no tempo segments', () => {
      const artifact = createMockArtifact([]);
      const eff = effectiveScoreTempoAtTick(artifact, 0);
      expect(eff).toEqual({
        bpm: 80,
        source: 'PRODUCT_DEFAULT',
        hasSubsequentScoreTempoChanges: false,
        isDefault: true,
        hasSubsequentChanges: false,
      });
    });

    it('returns default 80 with PRODUCT_DEFAULT source and hasSubsequentScoreTempoChanges if first explicit tempo is at tick > 0', () => {
      const artifact = createMockArtifact([{ startTick: 4, bpm: 120 }]);
      const eff = effectiveScoreTempoAtTick(artifact, 0);
      expect(eff).toEqual({
        bpm: 80,
        source: 'PRODUCT_DEFAULT',
        hasSubsequentScoreTempoChanges: true,
        nextScoreTempoTick: 4,
        isDefault: true,
        hasSubsequentChanges: true,
        explicitStartTick: 4,
      });
    });

    it('returns active tempo with MUSICXML source when scopeStartTick reaches explicit tempo', () => {
      const artifact = createMockArtifact([{ startTick: 4, bpm: 120 }]);
      const eff = effectiveScoreTempoAtTick(artifact, 4);
      expect(eff).toEqual({
        bpm: 120,
        source: 'MUSICXML',
        hasSubsequentScoreTempoChanges: false,
        nextScoreTempoTick: undefined,
        isDefault: false,
        hasSubsequentChanges: false,
        explicitStartTick: 4,
      });
    });

    it('returns active tempo at scopeStartTick when multiple tempo segments exist', () => {
      const artifact = createMockArtifact([
        { startTick: 0, bpm: 100 },
        { startTick: 8, bpm: 120 },
        { startTick: 16, bpm: 90 },
      ]);
      const effAt0 = effectiveScoreTempoAtTick(artifact, 0);
      expect(effAt0.bpm).toBe(100);
      expect(effAt0.source).toBe('MUSICXML');
      expect(effAt0.hasSubsequentScoreTempoChanges).toBe(true);
      expect(effAt0.nextScoreTempoTick).toBe(8);

      const effAt10 = effectiveScoreTempoAtTick(artifact, 10);
      expect(effAt10.bpm).toBe(120);
      expect(effAt10.source).toBe('MUSICXML');
      expect(effAt10.hasSubsequentScoreTempoChanges).toBe(true);
      expect(effAt10.nextScoreTempoTick).toBe(16);

      const effAt20 = effectiveScoreTempoAtTick(artifact, 20);
      expect(effAt20.bpm).toBe(90);
      expect(effAt20.source).toBe('MUSICXML');
      expect(effAt20.hasSubsequentScoreTempoChanges).toBe(false);
      expect(effAt20.nextScoreTempoTick).toBeUndefined();
    });
  });

  describe('PracticeTempoTimeline', () => {
    it('calculates tickToTimeMs, timeMsToTick, and bpmAtTick accurately across tempo changes', () => {
      const plan = resolvePracticeTempoPlan(
        createMockArtifact([
          { startTick: 0, bpm: 120 }, // 1 tick = 500ms
          { startTick: 4, bpm: 60 },  // 1 tick = 1000ms
        ]),
        { mode: 'SCORE' }
      );
      const timeline = new PracticeTempoTimeline(plan, 8, 1);

      expect(timeline.bpmAtTick(0)).toBe(120);
      expect(timeline.bpmAtTick(2)).toBe(120);
      expect(timeline.bpmAtTick(4)).toBe(60);
      expect(timeline.bpmAtTick(6)).toBe(60);

      // Beat to time
      expect(timeline.tickToTimeMs(0)).toBe(0);
      expect(timeline.tickToTimeMs(2)).toBe(1000);
      expect(timeline.tickToTimeMs(4)).toBe(2000);
      expect(timeline.tickToTimeMs(5)).toBe(3000);
      expect(timeline.tickToTimeMs(8)).toBe(6000);

      // Time to tick
      expect(timeline.timeMsToTick(0)).toBe(0);
      expect(timeline.timeMsToTick(1000)).toBe(2);
      expect(timeline.timeMsToTick(2000)).toBe(4);
      expect(timeline.timeMsToTick(3000)).toBe(5);
      expect(timeline.timeMsToTick(6000)).toBe(8);

      expect(timeline.durationMs).toBe(6000);
    });
  });
});

it("resolves score tempo at the first playable onset after a leading rest", () => {
    // Effective tempo at start of practice (tick 2.0)
    const tempoInfo = effectiveScoreTempoAtTick(leadingRestArtifact, leadingRestArtifact.moments[0].onsetTick);
    expect(tempoInfo.bpm).toBe(100);
    expect(tempoInfo.source).toBe('MUSICXML');

});

it.each([{scoreTempoSegments:[]},{scoreTempoSegments:[{startTick:3,bpm:100}]}])('admitted explicit meter supports optional and delayed score tempo',({scoreTempoSegments})=>{
  const artifact=parsePracticeScoreArtifact({...structuredClone(canonical),scoreTempoSegments});
  const plan=resolvePracticeTempoPlan(artifact,{mode:'SCORE'});
  expect(plan.segments[0]).toEqual({startTick:0,bpm:80,source:'PRODUCT_DEFAULT'});
  expect(plan.segments.slice(1)).toEqual(scoreTempoSegments.map(t=>({...t,source:'MUSICXML'})));
  const timeline=new PracticeTempoTimeline(plan,artifact.scoreEndTick, artifact.ticksPerQuarter);
  expect(timeline.bpmAtTick(0)).toBe(80);
  if(scoreTempoSegments.length)expect(timeline.bpmAtTick(3)).toBe(100);
});
