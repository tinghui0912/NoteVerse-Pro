import { describe, expect, it } from 'vitest';
import type { MeterSegment, PracticeScoreArtifact } from '../local-core/artifact';
import {
  PracticeTempoTimeline,
  ResolvedPracticeTempoPlan,
} from '../local-core/practice-tempo';
import {
  isDownbeat,
  MetronomePulsePlanner,
  pulseIndexInMeasure,
  pulseStepBeats,
} from './metronome-pulse-planner';

function makeTestArtifact(overrides: Partial<PracticeScoreArtifact> = {}): PracticeScoreArtifact {
  return {
    schemaVersion: 2,
    scoreId: 'test-score',
    revisionId: 'test-rev',
    artifactId: 'practice-score-artifact-v2:test',
    firstPlayableBeat: 0.0,
    scoreEndBeat: 32.0,
    playableEvents: [],
    expectedPracticeGroups: [],
    practiceAttackSteps: [],
    meterSegments: [
      {
        startBeat: 0.0,
        numerator: 4,
        denominator: 4,
        measureDurationBeats: 4.0,
        countInPulses: 4,
        source: 'MUSICXML',
      },
    ],
    scoreTempoSegments: [{ startBeat: 0.0, bpm: 120.0 }],
    ...overrides,
  };
}

describe('MetronomePulsePlanner - Unit and Phase Tests', () => {
  describe('Meter pulseStep and downbeat calculation', () => {
    it('verifies pulseStepBeats for 4/4, 3/4, 6/8, and 2/2 meters', () => {
      const meter44: MeterSegment = {
        startBeat: 0,
        numerator: 4,
        denominator: 4,
        measureDurationBeats: 4,
        countInPulses: 4,
      };
      const meter34: MeterSegment = {
        startBeat: 0,
        numerator: 3,
        denominator: 4,
        measureDurationBeats: 3,
        countInPulses: 3,
      };
      const meter68: MeterSegment = {
        startBeat: 0,
        numerator: 6,
        denominator: 8,
        measureDurationBeats: 3,
        countInPulses: 6,
      };
      const meter22: MeterSegment = {
        startBeat: 0,
        numerator: 2,
        denominator: 2,
        measureDurationBeats: 4,
        countInPulses: 2,
      };

      // 4 / denominator
      expect(pulseStepBeats(meter44)).toBe(1.0);
      expect(pulseStepBeats(meter34)).toBe(1.0);
      expect(pulseStepBeats(meter68)).toBe(0.5);
      expect(pulseStepBeats(meter22)).toBe(2.0);
    });

    it('calculates downbeats and pulse indices on fractional grid for 6/8 meter', () => {
      const meter68: MeterSegment = {
        startBeat: 0,
        numerator: 6,
        denominator: 8,
        measureDurationBeats: 3.0,
        countInPulses: 6,
      };

      // Measure 1: beats 0.0 to 2.5
      expect(isDownbeat(meter68, 0.0)).toBe(true);
      expect(pulseIndexInMeasure(meter68, 0.0)).toBe(0);

      expect(isDownbeat(meter68, 0.5)).toBe(false);
      expect(pulseIndexInMeasure(meter68, 0.5)).toBe(1);

      expect(isDownbeat(meter68, 1.0)).toBe(false);
      expect(pulseIndexInMeasure(meter68, 1.0)).toBe(2);

      expect(isDownbeat(meter68, 2.5)).toBe(false);
      expect(pulseIndexInMeasure(meter68, 2.5)).toBe(5);

      // Measure 2: starts at beat 3.0
      expect(isDownbeat(meter68, 3.0)).toBe(true);
      expect(pulseIndexInMeasure(meter68, 3.0)).toBe(0);
    });
  });

  describe('CONTINUOUS mode planning', () => {
    it('anchors count-in to scopeStartBeat and does not advance score beat', () => {
      const artifact = makeTestArtifact({
        meterSegments: [
          {
            startBeat: 0.0,
            numerator: 6,
            denominator: 8,
            measureDurationBeats: 3.0,
            countInPulses: 6,
          },
        ],
      });
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
        segments: [{ startBeat: 0, bpm: 90, source: 'CUSTOM' }],
      };
      const timeline = new PracticeTempoTimeline(plan, 64);

      // Scope starts at beat 32 in 6/8 meter, 6 count-in pulses
      const pulses = MetronomePulsePlanner.planContinuousPulses({
        timeline,
        artifact,
        scopeStartBeat: 32.0,
        countInPulses: 6,
        countInBeats: 3.0,
        windowStartMs: -5000,
        windowEndMs: 0,
      });

      const countInPulses = pulses.filter((p) => p.isCountIn);
      expect(countInPulses).toHaveLength(6);

      // All count-in pulses must remain anchored to scoreBeat = 32!
      countInPulses.forEach((pulse, idx) => {
        expect(pulse.scoreBeat).toBe(32.0);
        expect(pulse.bpm).toBe(90);
        expect(pulse.denominator).toBe(8);
        expect(pulse.numerator).toBe(6);
        expect(pulse.pulseIndexInMeasure).toBe(idx);
        expect(pulse.isDownbeat).toBe(idx === 0);
      });
    });

    it('handles tempo change with count-in deterministically without pre-consuming tempo change', () => {
      // tempo: 0 -> 120, 4 -> 90; meter: 4/4; count-in: 4 beats
      const artifact = makeTestArtifact({
        meterSegments: [
          {
            startBeat: 0.0,
            numerator: 4,
            denominator: 4,
            measureDurationBeats: 4.0,
            countInPulses: 4,
          },
        ],
      });
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 120, source: 'MUSICXML' },
          { startBeat: 4, bpm: 90, source: 'MUSICXML' },
        ],
      };
      const timeline = new PracticeTempoTimeline(plan, 16);

      // Total count-in is 4 beats at 120 BPM = 2000 ms (times: -2000, -1500, -1000, -500)
      // Running from beat 0 to 6:
      // beat 0 (0 ms, 120 BPM), beat 1 (500 ms, 120 BPM), beat 2 (1000 ms, 120 BPM), beat 3 (1500 ms, 120 BPM)
      // beat 4 (2000 ms, 90 BPM), beat 5 (2000 + 666.67 ms, 90 BPM), beat 6 (2000 + 1333.33 ms, 90 BPM)
      const pulses = MetronomePulsePlanner.planContinuousPulses({
        timeline,
        artifact,
        scopeStartBeat: 0.0,
        countInPulses: 4,
        countInBeats: 4.0,
        windowStartMs: -2500,
        windowEndMs: 4000,
      });

      // 4 count-in pulses
      const countIn = pulses.filter((p) => p.isCountIn);
      expect(countIn).toHaveLength(4);
      countIn.forEach((p) => {
        expect(p.bpm).toBe(120);
        expect(p.scoreBeat).toBe(0);
      });

      // Running pulses
      const running = pulses.filter((p) => !p.isCountIn);
      expect(running.length).toBeGreaterThanOrEqual(6);

      // Beat 0, 1, 2, 3 must be 120 BPM
      expect(running[0].scoreBeat).toBe(0);
      expect(running[0].bpm).toBe(120);
      expect(running[0].isDownbeat).toBe(true);

      expect(running[1].scoreBeat).toBe(1);
      expect(running[1].bpm).toBe(120);
      expect(running[1].isDownbeat).toBe(false);

      expect(running[2].scoreBeat).toBe(2);
      expect(running[2].bpm).toBe(120);

      expect(running[3].scoreBeat).toBe(3);
      expect(running[3].bpm).toBe(120);

      // Beat 4 must switch to 90 BPM and be a downbeat!
      expect(running[4].scoreBeat).toBe(4);
      expect(running[4].bpm).toBe(90);
      expect(running[4].isDownbeat).toBe(true);

      // Beat 5 must also be 90 BPM
      expect(running[5].scoreBeat).toBe(5);
      expect(running[5].bpm).toBe(90);
    });

    it('plans selected range starting at beat 12 with meter change to 6/8 and tempo 90', () => {
      // tempo: 0 -> 120, 8 -> 90; meter: 0 -> 4/4, 12 -> 6/8; scope start: 12
      const artifact = makeTestArtifact({
        meterSegments: [
          {
            startBeat: 0.0,
            numerator: 4,
            denominator: 4,
            measureDurationBeats: 4.0,
            countInPulses: 4,
          },
          {
            startBeat: 12.0,
            numerator: 6,
            denominator: 8,
            measureDurationBeats: 3.0,
            countInPulses: 6,
          },
        ],
      });
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 120, source: 'MUSICXML' },
          { startBeat: 8, bpm: 90, source: 'MUSICXML' },
        ],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      const pulses = MetronomePulsePlanner.planContinuousPulses({
        timeline,
        artifact,
        scopeStartBeat: 12.0,
        countInPulses: 6,
        countInBeats: 3.0,
        windowStartMs: -3000,
        windowEndMs: 1000,
      });

      // Count-in must use beat 12 context: tempo 90, meter 6/8, 6 pulses
      const countIn = pulses.filter((p) => p.isCountIn);
      expect(countIn).toHaveLength(6);
      countIn.forEach((p) => {
        expect(p.scoreBeat).toBe(12.0);
        expect(p.bpm).toBe(90);
        expect(p.denominator).toBe(8);
        expect(p.numerator).toBe(6);
      });

      // Running must start at exactly beat 12.0
      const running = pulses.filter((p) => !p.isCountIn);
      expect(running[0].scoreBeat).toBe(12.0);
      expect(running[0].timeMs).toBe(0);

      // Subsequent eighth note pulses
      expect(running[1].scoreBeat).toBe(12.5);
      expect(running[1].bpm).toBe(90);
      expect(running[1].isDownbeat).toBe(false);
      expect(running[1].timeMs).toBeCloseTo(timeline.beatToTimeMs(12.5) - timeline.beatToTimeMs(12.0));
    });
  });

  describe('STEP mode planning', () => {
    it('maintains steady tempo and target scoreBeat even if stalled at step for 30 seconds', () => {
      const artifact = makeTestArtifact();
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 100, source: 'MUSICXML' },
          { startBeat: 8, bpm: 80, source: 'MUSICXML' },
        ],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      // Target is at onsetBeat = 0
      // Window is from 20,000 ms to 22,000 ms (user stalled at step 0 for over 20 seconds!)
      const pulses = MetronomePulsePlanner.planStepPulses({
        timeline,
        artifact,
        targetOnsetBeat: 0.0,
        windowStartMs: 20000,
        windowEndMs: 22000,
      });

      expect(pulses.length).toBeGreaterThan(0);
      pulses.forEach((p) => {
        // Must remain anchored to target onsetBeat = 0 and tempo = 100 BPM!
        // Never autonomously advance into future beat 8 (80 BPM)!
        expect(p.scoreBeat).toBe(0.0);
        expect(p.bpm).toBe(100);
      });
    });

    it('switches tempo context when target advances across tempo boundary (e.g. onsetBeat 8)', () => {
      const artifact = makeTestArtifact();
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 100, source: 'MUSICXML' },
          { startBeat: 8, bpm: 80, source: 'MUSICXML' },
        ],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      // Step 1: onsetBeat = 1 -> still 100 BPM
      const pulsesStep1 = MetronomePulsePlanner.planStepPulses({
        timeline,
        artifact,
        targetOnsetBeat: 1.0,
        windowStartMs: 0,
        windowEndMs: 2000,
      });
      expect(pulsesStep1[0].bpm).toBe(100);
      expect(pulsesStep1[0].scoreBeat).toBe(1.0);

      // Step 2: advances to onsetBeat = 8 -> switches to 80 BPM
      const pulsesStep2 = MetronomePulsePlanner.planStepPulses({
        timeline,
        artifact,
        targetOnsetBeat: 8.0,
        windowStartMs: 0,
        windowEndMs: 2000,
      });
      expect(pulsesStep2[0].bpm).toBe(80);
      expect(pulsesStep2[0].scoreBeat).toBe(8.0);
      expect(pulsesStep2[0].isDownbeat).toBe(true); // Beat 8 in 4/4 is a downbeat
    });
  });
});
