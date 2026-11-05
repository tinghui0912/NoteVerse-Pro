import { expect, it } from 'vitest';
import exact from '../__fixtures__/exact-practice-score-artifact.json';
import { parsePracticeScoreArtifact } from './artifact';
import {
  measureDurationTicks,
  meterPulseTicks,
  scoreTick,
  ticksPerQuarter,
} from './score-time';
import { resolvePracticeScope } from '../planning/scope';
import { PracticeTempoTimeline, resolvePracticeTempoPlan } from '../planning/tempo';
import { MetronomePulsePlanner } from '../metronome/metronome-pulse-planner';

it('reads the backend-produced mixed-denominator, meter, tie, tempo and scope artifact', () => {
  const artifact = parsePracticeScoreArtifact(exact);
  expect(artifact.ticksPerQuarter).toBe(60);
  expect(artifact.events.map((e) => e.onsetTick)).toEqual([
    0, 20, 50, 62, 90, 110, 140,
  ]);
  expect(artifact.scoreEndTick).toBe(165);
  expect(artifact.scoreTempoSegments.map((t) => t.startTick)).toEqual([
    30, 113,
  ]);
  expect(
    artifact.meterSegments.map((m) => measureDurationTicks(m, 60))
  ).toEqual([90, 75]);
  expect(artifact.meterSegments.map((m) => meterPulseTicks(m, 60))).toEqual([
    30, 15,
  ]);
  const target = artifact.moments[3];
  expect(
    resolvePracticeScope(artifact, {
      kind: 'RANGE',
      startGroupId: target.groupId,
      endGroupId: target.groupId,
    })
  ).toMatchObject({ startTick: 62, terminalTick: 110 });
  const timeline = new PracticeTempoTimeline(
    resolvePracticeTempoPlan(artifact, { mode: 'SCORE' }),
    165,
    60
  );
  expect(timeline.tickToTimeMs(30)).toBe(375);
  expect(timeline.timeMsToTick(timeline.tickToTimeMs(113))).toBe(113);
  expect(timeline.timeMsToTick(timeline.tickToTimeMs(113) - 0.01)).toBe(112);
  const pulses = MetronomePulsePlanner.planContinuousPulses({
    timeline,
    artifact,
    scopeStartTick: 0,
    countInPulses: 0,
    countInTicks: 0,
    windowStartMs: 0,
    windowEndMs: timeline.durationMs,
  });
  expect(pulses.map((p) => p.scoreTick)).toEqual([
    0, 30, 60, 90, 105, 120, 135, 150, 165,
  ]);
});
it.each([1 / 3, 4 / 3, Number.MAX_SAFE_INTEGER + 1, -1, NaN, Infinity, true])(
  'rejects a noninteger/unsafe score coordinate %s',
  (value) => expect(() => scoreTick(value)).toThrow()
);
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid timebase %s',
  (value) => expect(() => ticksPerQuarter(value)).toThrow()
);
it('rejects unsafe event ends and nonintegral meter pulses', () => {
  const a = structuredClone(exact);
  a.events[0].durationTicks = Number.MAX_SAFE_INTEGER;
  a.events[0].onsetTick = 20;
  expect(() => parsePracticeScoreArtifact(a)).toThrow();
  expect(() => meterPulseTicks({ denominator: 16 }, 6)).toThrow();
});
