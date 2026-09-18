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
    schemaVersion: 1,
    scoreId: 'test-score',
    revisionId: 'test-rev',
    artifactId: 'practice-score-artifact:test',
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

  describe('Incremental Cursor & Phase Unification', () => {
    it('CONTINUOUS: pauses during 4/4 count-in and resumes remaining pre-roll pulses before running', () => {
      const artifact = makeTestArtifact();
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 120, source: 'MUSICXML' }],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);
      // 4/4, 120 BPM: 500ms per beat. 4 pulses count-in = 2000ms total.
      // Pulse 0: 0ms, Pulse 1: 500ms, Pulse 2: 1000ms, Pulse 3: 1500ms, Running 0.0: 2000ms.

      // Simulate pause after pulse 1 (elapsed 700ms, remaining 1300ms)
      const syncPoint = {
        state: 'COUNT_IN' as const,
        scopeStartBeat: 0.0,
        countInTotalMs: 2000,
        countInRemainingMs: 1300,
        countInPulses: 4,
        countInPulse: 2,
      };

      const cursor = MetronomePulsePlanner.createContinuousCursor(syncPoint, artifact, timeline);
      expect(cursor.phase).toBe('COUNT_IN');
      if (cursor.phase !== 'COUNT_IN') return;

      // Pulse index 2 (3rd pulse) scheduled at 1000ms. Time until pulse = 1000 - 700 = 300ms.
      expect(cursor.pulseIndex).toBe(2);
      expect(cursor.timeUntilPulseMs).toBe(300);

      // Plan across 2000ms window
      const { pulses, nextCursor } = MetronomePulsePlanner.planNextPulses(cursor, 2000, {
        artifact,
        timeline,
        scopeEndBeat: 32,
      });

      // Must have:
      // Pulse 2 (count-in pulse 3) at 300ms
      // Pulse 3 (count-in pulse 4) at 800ms
      // Running beat 0.0 at 1300ms
      // Running beat 1.0 at 1800ms
      expect(pulses).toHaveLength(4);

      expect(pulses[0].isCountIn).toBe(true);
      expect(pulses[0].pulseIndexInMeasure).toBe(2);
      expect(pulses[0].timeMs).toBe(300);

      expect(pulses[1].isCountIn).toBe(true);
      expect(pulses[1].pulseIndexInMeasure).toBe(3);
      expect(pulses[1].timeMs).toBe(800);

      expect(pulses[2].isCountIn).toBe(false);
      expect(pulses[2].scoreBeat).toBe(0.0);
      expect(pulses[2].isDownbeat).toBe(true);
      expect(pulses[2].timeMs).toBe(1300);

      expect(pulses[3].isCountIn).toBe(false);
      expect(pulses[3].scoreBeat).toBe(1.0);
      expect(pulses[3].isDownbeat).toBe(false);
      expect(pulses[3].timeMs).toBe(1800);

      expect(nextCursor.phase).toBe('RUNNING');
    });

    it('CONTINUOUS: 6/8 count-in pause after pulse 3 and resumes pulses 4, 5, 6 before running', () => {
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
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 120, source: 'MUSICXML' }],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);
      // 6/8 at 120 BPM: quarter beat = 500ms, eighth beat = 250ms.
      // countInBeats = 3.0 quarter beats = 1500ms total. 6 pulses of 250ms each.
      // Pulse 0: 0ms, Pulse 1: 250ms, Pulse 2: 500ms, Pulse 3: 750ms, Pulse 4: 1000ms, Pulse 5: 1250ms.

      // Pause after pulse 3 (index 2) at elapsed 600ms (remaining 900ms)
      const syncPoint = {
        state: 'COUNT_IN' as const,
        scopeStartBeat: 0.0,
        countInTotalMs: 1500,
        countInRemainingMs: 900,
        countInPulses: 6,
        countInPulse: 3,
      };

      const cursor = MetronomePulsePlanner.createContinuousCursor(syncPoint, artifact, timeline);
      expect(cursor.phase).toBe('COUNT_IN');
      if (cursor.phase !== 'COUNT_IN') return;

      // Next pulse is index 3 (4th pulse, at 750ms). Time until pulse = 750 - 600 = 150ms.
      expect(cursor.pulseIndex).toBe(3);
      expect(cursor.timeUntilPulseMs).toBe(150);

      const { pulses } = MetronomePulsePlanner.planNextPulses(cursor, 1500, {
        artifact,
        timeline,
        scopeEndBeat: 32,
      });

      // Pulses expected:
      // index 3 at 150ms
      // index 4 at 400ms
      // index 5 at 650ms
      // Running beat 0.0 at 900ms (eighth-note interval 250ms)
      // Running beat 0.5 at 1150ms
      // Running beat 1.0 at 1400ms
      const countInPulses = pulses.filter((p) => p.isCountIn);
      expect(countInPulses).toHaveLength(3);
      expect(countInPulses[0].pulseIndexInMeasure).toBe(3);
      expect(countInPulses[0].timeMs).toBe(150);
      expect(countInPulses[1].pulseIndexInMeasure).toBe(4);
      expect(countInPulses[1].timeMs).toBe(400);
      expect(countInPulses[2].pulseIndexInMeasure).toBe(5);
      expect(countInPulses[2].timeMs).toBe(650);

      const runningPulses = pulses.filter((p) => !p.isCountIn);
      expect(runningPulses[0].scoreBeat).toBe(0.0);
      expect(runningPulses[0].isDownbeat).toBe(true);
      expect(runningPulses[0].timeMs).toBe(900);
      expect(runningPulses[1].scoreBeat).toBe(0.5);
      expect(runningPulses[1].timeMs).toBe(1150);
      expect(runningPulses[2].scoreBeat).toBe(1.0);
      expect(runningPulses[2].timeMs).toBe(1400);
    });

    it('CONTINUOUS: toggle ON during RUNNING at fractional beat syncs to next legal pulse', () => {
      const artifact = makeTestArtifact();
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 120, source: 'MUSICXML' }],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      // Runtime is currently at musicalBeat 2.25 in 4/4
      const syncPoint = {
        state: 'RUNNING' as const,
        musicalBeat: 2.25,
      };

      const cursor = MetronomePulsePlanner.createContinuousCursor(syncPoint, artifact, timeline);
      expect(cursor.phase).toBe('RUNNING');
      if (cursor.phase !== 'RUNNING') return;

      // Next legal pulse beat on 4/4 grid >= 2.25 is 3.0!
      expect(cursor.currentBeat).toBe(3.0);
      // Delta = 0.75 beats at 120 BPM (500ms/beat) = 375ms
      expect(cursor.timeUntilPulseMs).toBe(375);
    });
  });

  describe('STEP mode planning', () => {
    it('schedules only legal meter pulses for syncopated target (e.g. 2.25 in 4/4)', () => {
      const artifact = makeTestArtifact();
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 100, source: 'MUSICXML' }],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      const cursor = MetronomePulsePlanner.createStepCursor(2.25, artifact, timeline);
      expect(cursor.phase).toBe('STEP');
      expect(cursor.targetOnsetBeat).toBe(2.25);
      expect(cursor.fixedBpm).toBe(100);
      // First legal beat on 4/4 grid >= 2.25 is 3.0!
      expect(cursor.currentBeat).toBe(3.0);
      // Delta = 0.75 beats at 100 BPM (600ms/beat) = 450ms
      expect(cursor.timeUntilPulseMs).toBe(450);

      const { pulses } = MetronomePulsePlanner.planNextPulses(cursor, 3000, {
        artifact,
        timeline,
        scopeEndBeat: 32,
      });

      // Pulses must follow 3.0, 4.0, 5.0...
      expect(pulses[0].scoreBeat).toBe(3.0);
      expect(pulses[0].isDownbeat).toBe(false);
      expect(pulses[0].timeMs).toBe(450);

      expect(pulses[1].scoreBeat).toBe(4.0);
      expect(pulses[1].isDownbeat).toBe(true); // Downbeat on measure 2 (beat 4.0)
      expect(pulses[1].timeMs).toBe(1050);

      expect(pulses[2].scoreBeat).toBe(5.0);
      expect(pulses[2].isDownbeat).toBe(false);
      expect(pulses[2].timeMs).toBe(1650);
    });

    it('starts at target onset when target is a pulse-grid point (e.g. 2.5 in 6/8)', () => {
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
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 120, source: 'MUSICXML' }],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      const cursor = MetronomePulsePlanner.createStepCursor(2.5, artifact, timeline);
      expect(cursor.currentBeat).toBe(2.5);
      expect(cursor.timeUntilPulseMs).toBe(0); // 2.5 is on grid, fires immediately

      const { pulses } = MetronomePulsePlanner.planNextPulses(cursor, 600, {
        artifact,
        timeline,
        scopeEndBeat: 32,
      });

      expect(pulses[0].scoreBeat).toBe(2.5);
      expect(pulses[0].timeMs).toBe(0);
      expect(pulses[1].scoreBeat).toBe(3.0);
      expect(pulses[1].isDownbeat).toBe(true); // Beat 3.0 is downbeat of measure 2 in 6/8!
      expect(pulses[1].timeMs).toBe(250);
      expect(pulses[2].scoreBeat).toBe(3.5);
      expect(pulses[2].timeMs).toBe(500);
    });

    it('target onset 7.5 stays on target tempo context (100 BPM) across future score tempo boundary (8.0 -> 80 BPM)', () => {
      const artifact = makeTestArtifact();
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 100, source: 'MUSICXML' },
          { startBeat: 8, bpm: 80, source: 'MUSICXML' },
        ],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      // Target is at 7.5 (tempo context is 100 BPM). First pulse >= 7.5 is 8.0.
      const cursor = MetronomePulsePlanner.createStepCursor(7.5, artifact, timeline);
      expect(cursor.fixedBpm).toBe(100);
      expect(cursor.currentBeat).toBe(8.0);

      // Plan 5 pulses: 8.0, 9.0, 10.0, 11.0, 12.0
      const { pulses } = MetronomePulsePlanner.planNextPulses(cursor, 4000, {
        artifact,
        timeline,
        scopeEndBeat: 32,
      });

      expect(pulses.length).toBeGreaterThanOrEqual(4);
      pulses.forEach((p) => {
        // BPM must remain strictly 100 BPM! Never consume future score tempo of 80 BPM!
        expect(p.bpm).toBe(100);
      });
      expect(pulses[0].scoreBeat).toBe(8.0);
      expect(pulses[0].isDownbeat).toBe(true);
      expect(pulses[1].scoreBeat).toBe(9.0);
      expect(pulses[1].isDownbeat).toBe(false);
    });

    it('advancing target to >= 8.0 activates new 80 BPM tempo context', () => {
      const artifact = makeTestArtifact();
      const plan: ResolvedPracticeTempoPlan = {
        selection: { mode: 'SCORE' },
        segments: [
          { startBeat: 0, bpm: 100, source: 'MUSICXML' },
          { startBeat: 8, bpm: 80, source: 'MUSICXML' },
        ],
      };
      const timeline = new PracticeTempoTimeline(plan, 32);

      // New target is at beat 8.0
      const cursor = MetronomePulsePlanner.createStepCursor(8.0, artifact, timeline);
      expect(cursor.fixedBpm).toBe(80);
      expect(cursor.currentBeat).toBe(8.0);

      const { pulses } = MetronomePulsePlanner.planNextPulses(cursor, 1000, {
        artifact,
        timeline,
        scopeEndBeat: 32,
      });

      expect(pulses[0].bpm).toBe(80);
      expect(pulses[0].scoreBeat).toBe(8.0);
      expect(pulses[0].isDownbeat).toBe(true);
    });
  });
});
