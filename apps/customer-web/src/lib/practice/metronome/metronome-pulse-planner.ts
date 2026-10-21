import type { MeterSegment, PracticeScoreArtifact } from '../local-core/artifact';
import { roundBeat } from '../local-core/artifact';
import { beatsToMs, PracticeTempoTimeline } from '../local-core/practice-tempo';
import type { PerformanceClockSnapshot } from '../local-core/performance-runtime';

export interface MetronomePulse {
  readonly scoreBeat: number;
  readonly pulseIndexInMeasure: number;
  readonly isDownbeat: boolean;
  readonly bpm: number;
  readonly denominator: number;
  readonly numerator: number;
  readonly timeMs: number;
  readonly isCountIn?: boolean;
}

export type ContinuousMetronomeSyncPoint =
  | {
      state: 'COUNT_IN';
      scopeStartBeat: number;
      countInTotalMs: number;
      countInRemainingMs: number;
      countInPulses: number;
      countInPulse: number;
    }
  | {
      state: 'RUNNING';
      musicalBeat: number;
    }
  | PerformanceClockSnapshot;

export interface ContinuousCountInState {
  readonly phase: 'COUNT_IN';
  readonly scopeStartBeat: number;
  readonly countInTotalMs: number;
  readonly countInPulses: number;
  readonly pulseIntervalMs: number;
  readonly pulseIndex: number;
  readonly nextPulseTimeMs: number;
  readonly timeUntilPulseMs: number;
}

export interface ContinuousRunningState {
  readonly phase: 'RUNNING';
  readonly currentBeat: number;
  readonly nextPulseTimeMs: number;
  readonly timeUntilPulseMs: number;
}

export interface StepRunningState {
  readonly phase: 'STEP';
  readonly targetOnsetBeat: number;
  readonly currentBeat: number;
  readonly fixedBpm: number;
  readonly stepPulseCounter: number;
  readonly nextPulseTimeMs: number;
  readonly timeUntilPulseMs: number;
}

export type MetronomePlanningCursor =
  | ContinuousCountInState
  | ContinuousRunningState
  | StepRunningState;

/**
 * Calculates the duration of a metronome pulse in quarter beats based on meter denominator.
 * In NoteVerse beat domain: 1 beat = quarter note.
 * pulseStepBeats = 4 / denominator:
 * - 4/4 -> 1.0 quarter beat
 * - 3/4 -> 1.0 quarter beat
 * - 6/8 -> 0.5 quarter beat (eighth note)
 * - 2/2 -> 2.0 quarter beats (half note)
 */
export function pulseStepBeats(meter: MeterSegment): number {
  if (!Number.isFinite(meter.denominator) || meter.denominator <= 0) {
    return 1.0;
  }
  return 4 / meter.denominator;
}

/**
 * Finds the active MeterSegment for a given musical beat in the score.
 */
export function meterAtBeat(artifact: PracticeScoreArtifact, beat: number): MeterSegment {
  const targetBeat = roundBeat(Math.max(0, beat));
  const segments = artifact.meterSegments;
  if (!segments || segments.length === 0) {
    return {
      startBeat: 0,
      numerator: 4,
      denominator: 4,
      measureDurationBeats: 4.0,
      countInPulses: 4,
      source: 'DEFAULT_4_4',
    };
  }

  let active = segments[0];
  for (const segment of segments) {
    if (roundBeat(segment.startBeat) <= targetBeat) {
      active = segment;
    } else {
      break;
    }
  }
  return active;
}

/**
 * Determines whether a score beat aligns with a measure downbeat for the active meter segment.
 */
export function isDownbeat(meter: MeterSegment, beat: number): boolean {
  const rel = roundBeat(beat - meter.startBeat);
  if (rel < -1e-4) return false;
  const measureBeats = meter.measureDurationBeats;
  const remainder = ((rel % measureBeats) + measureBeats) % measureBeats;
  return remainder < 1e-4 || Math.abs(remainder - measureBeats) < 1e-4;
}

/**
 * Computes pulse index in the measure for a given beat.
 */
export function pulseIndexInMeasure(meter: MeterSegment, beat: number): number {
  const step = pulseStepBeats(meter);
  const rel = roundBeat(beat - meter.startBeat);
  const measureBeats = meter.measureDurationBeats;
  const remainder = ((rel % measureBeats) + measureBeats) % measureBeats;
  const rawIndex = Math.round(remainder / step);
  return rawIndex % meter.numerator;
}

export class MetronomePulsePlanner {
  /**
   * Creates a cursor for CONTINUOUS mode starting from an explicit sync point.
   */
  static createContinuousCursor(
    syncPoint: ContinuousMetronomeSyncPoint,
    artifact: PracticeScoreArtifact,
    timeline: PracticeTempoTimeline,
    baseTimeMs = 0
  ): ContinuousCountInState | ContinuousRunningState {
    if (syncPoint.state === 'COUNT_IN') {
      const countInTotalMs = syncPoint.countInTotalMs;
      const countInPulses = syncPoint.countInPulses;
      const scopeStartBeat = syncPoint.scopeStartBeat;
      if (countInPulses <= 0 || countInTotalMs <= 0) {
        return {
          phase: 'RUNNING',
          currentBeat: scopeStartBeat,
          nextPulseTimeMs: baseTimeMs,
          timeUntilPulseMs: 0,
        };
      }
      const pulseIntervalMs = countInTotalMs / countInPulses;
      const countInElapsedMs = Math.max(0, countInTotalMs - syncPoint.countInRemainingMs);

      // Find first pulse index whose scheduled time >= countInElapsedMs - 1e-4
      let pulseIndex = Math.ceil(roundBeat((countInElapsedMs - 1e-4) / pulseIntervalMs));
      if (pulseIndex < 0) pulseIndex = 0;

      if (pulseIndex < countInPulses) {
        const scheduledPulseMs = pulseIndex * pulseIntervalMs;
        const timeUntilPulseMs = Math.max(0, scheduledPulseMs - countInElapsedMs);
        return {
          phase: 'COUNT_IN',
          scopeStartBeat,
          countInTotalMs,
          countInPulses,
          pulseIntervalMs,
          pulseIndex,
          nextPulseTimeMs: baseTimeMs + timeUntilPulseMs,
          timeUntilPulseMs,
        };
      }

      // All count-in pulses have occurred; transition to RUNNING at scopeStartBeat
      const timeUntilRunningMs = Math.max(0, countInTotalMs - countInElapsedMs);
      return {
        phase: 'RUNNING',
        currentBeat: scopeStartBeat,
        nextPulseTimeMs: baseTimeMs + timeUntilRunningMs,
        timeUntilPulseMs: timeUntilRunningMs,
      };
    }

    // RUNNING
    const beat = Math.max(0, syncPoint.musicalBeat);
    const meter = meterAtBeat(artifact, beat);
    const step = pulseStepBeats(meter);
    const k = Math.ceil(roundBeat((beat - meter.startBeat - 1e-4) / step));
    const nextBeat = roundBeat(meter.startBeat + Math.max(0, k) * step);
    const deltaBeats = Math.max(0, roundBeat(nextBeat - beat));
    const bpm = timeline.bpmAtBeat(beat);
    const timeUntilPulseMs = beatsToMs(deltaBeats, bpm);

    return {
      phase: 'RUNNING',
      currentBeat: nextBeat,
      nextPulseTimeMs: baseTimeMs + timeUntilPulseMs,
      timeUntilPulseMs,
    };
  }

  /**
   * Creates a cursor for STEP mode anchored to the given target onset beat.
   * Target onset beat determines meter and tempo context, but pulses strictly follow the legal score meter grid!
   */
  static createStepCursor(
    targetOnsetBeat: number,
    artifact: PracticeScoreArtifact,
    timeline: PracticeTempoTimeline,
    baseTimeMs = 0
  ): StepRunningState {
    const boundedTarget = Math.max(0, targetOnsetBeat);
    const fixedBpm = timeline.bpmAtBeat(boundedTarget);
    const meter = meterAtBeat(artifact, boundedTarget);
    const step = pulseStepBeats(meter);

    const diff = (boundedTarget - meter.startBeat) / step;
    const diffRounded = Math.round(diff);
    let firstBeat: number;
    let timeUntilPulseMs: number;

    if (Math.abs(diff - diffRounded) < 1e-4) {
      firstBeat = roundBeat(meter.startBeat + diffRounded * step);
      timeUntilPulseMs = 0;
    } else {
      const k = Math.ceil(roundBeat(diff));
      firstBeat = roundBeat(meter.startBeat + k * step);
      const deltaBeats = roundBeat(firstBeat - boundedTarget);
      timeUntilPulseMs = beatsToMs(deltaBeats, fixedBpm);
    }

    return {
      phase: 'STEP',
      targetOnsetBeat: boundedTarget,
      currentBeat: firstBeat,
      fixedBpm,
      stepPulseCounter: 0,
      nextPulseTimeMs: baseTimeMs + timeUntilPulseMs,
      timeUntilPulseMs,
    };
  }

  /**
   * Advances cursor time by elapsed milliseconds.
   */
  static advanceCursorTime(
    cursor: MetronomePlanningCursor,
    elapsedMs: number
  ): MetronomePlanningCursor {
    return {
      ...cursor,
      timeUntilPulseMs: Math.max(0, cursor.timeUntilPulseMs - elapsedMs),
    };
  }

  /**
   * Plans the next pulses within a lookahead window, returning the pulses and the advanced cursor.
   */
  static planNextPulses(
    cursor: MetronomePlanningCursor,
    horizonMs: number,
    context: {
      artifact: PracticeScoreArtifact;
      timeline: PracticeTempoTimeline;
      scopeEndBeat: number;
    }
  ): { pulses: MetronomePulse[]; nextCursor: MetronomePlanningCursor } {
    let current: MetronomePlanningCursor = { ...cursor };
    const pulses: MetronomePulse[] = [];

    while (current.nextPulseTimeMs <= horizonMs + 1e-4) {
      if (current.phase === 'COUNT_IN') {
        const meter = meterAtBeat(context.artifact, current.scopeStartBeat);
        const bpm = context.timeline.bpmAtBeat(current.scopeStartBeat);
        const p = current.pulseIndex;

        pulses.push({
          scoreBeat: current.scopeStartBeat,
          pulseIndexInMeasure: p % meter.numerator,
          isDownbeat: (p % meter.numerator) === 0,
          bpm,
          denominator: meter.denominator,
          numerator: meter.numerator,
          timeMs: Math.max(0, current.nextPulseTimeMs),
          isCountIn: true,
        });

        if (p + 1 < current.countInPulses) {
          current = {
            ...current,
            pulseIndex: p + 1,
            nextPulseTimeMs: current.nextPulseTimeMs + current.pulseIntervalMs,
            timeUntilPulseMs: current.timeUntilPulseMs + current.pulseIntervalMs,
          };
        } else {
          // Last count-in pulse has been scheduled.
          // The next pulse is the first running beat at scopeStartBeat, occurring pulseIntervalMs later.
          current = {
            phase: 'RUNNING',
            currentBeat: current.scopeStartBeat,
            nextPulseTimeMs: current.nextPulseTimeMs + current.pulseIntervalMs,
            timeUntilPulseMs: current.timeUntilPulseMs + current.pulseIntervalMs,
          };
        }
      } else if (current.phase === 'RUNNING') {
        if (current.currentBeat > context.scopeEndBeat + 1e-4) {
          break;
        }
        const meter = meterAtBeat(context.artifact, current.currentBeat);
        const bpm = context.timeline.bpmAtBeat(current.currentBeat);
        const step = pulseStepBeats(meter);

        pulses.push({
          scoreBeat: current.currentBeat,
          pulseIndexInMeasure: pulseIndexInMeasure(meter, current.currentBeat),
          isDownbeat: isDownbeat(meter, current.currentBeat),
          bpm,
          denominator: meter.denominator,
          numerator: meter.numerator,
          timeMs: Math.max(0, current.nextPulseTimeMs),
          isCountIn: false,
        });

        const intervalMs = beatsToMs(step, bpm);
        const nextBeat = roundBeat(current.currentBeat + step);
        current = {
          phase: 'RUNNING',
          currentBeat: nextBeat,
          nextPulseTimeMs: current.nextPulseTimeMs + intervalMs,
          timeUntilPulseMs: current.timeUntilPulseMs + intervalMs,
        };
      } else if (current.phase === 'STEP') {
        const meter = meterAtBeat(context.artifact, current.currentBeat);
        const step = pulseStepBeats(meter);
        const bpm = current.fixedBpm; // Fixed to target onset! Never future score tempo!

        pulses.push({
          scoreBeat: current.currentBeat,
          pulseIndexInMeasure: pulseIndexInMeasure(meter, current.currentBeat),
          isDownbeat: isDownbeat(meter, current.currentBeat),
          bpm,
          denominator: meter.denominator,
          numerator: meter.numerator,
          timeMs: Math.max(0, current.nextPulseTimeMs),
          isCountIn: false,
        });

        const intervalMs = beatsToMs(step, bpm);
        const nextBeat = roundBeat(current.currentBeat + step);
        current = {
          ...current,
          currentBeat: nextBeat,
          stepPulseCounter: current.stepPulseCounter + 1,
          nextPulseTimeMs: current.nextPulseTimeMs + intervalMs,
          timeUntilPulseMs: current.timeUntilPulseMs + intervalMs,
        };
      }
    }

    return { pulses, nextCursor: current };
  }

  /**
   * Batch planner for CONTINUOUS performance mode within [windowStartMs, windowEndMs].
   */
  static planContinuousPulses(options: {
    timeline: PracticeTempoTimeline;
    artifact: PracticeScoreArtifact;
    scopeStartBeat: number;
    countInPulses: number;
    countInBeats: number;
    windowStartMs: number;
    windowEndMs: number;
  }): MetronomePulse[] {
    const {
      timeline,
      artifact,
      scopeStartBeat,
      countInPulses,
      countInBeats,
      windowStartMs,
      windowEndMs,
    } = options;

    const pulses: MetronomePulse[] = [];
    const meterAtScopeStart = meterAtBeat(artifact, scopeStartBeat);
    const bpmAtScopeStart = timeline.bpmAtBeat(scopeStartBeat);

    // 1. COUNT-IN PULSES
    const countInTotalMs = beatsToMs(countInBeats, bpmAtScopeStart);
    if (countInPulses > 0 && countInTotalMs > 0) {
      const pulseIntervalMs = countInTotalMs / countInPulses;
      for (let i = 0; i < countInPulses; i += 1) {
        const pulseTimeMs = -countInTotalMs + i * pulseIntervalMs;
        if (pulseTimeMs >= windowStartMs - 1e-4 && pulseTimeMs <= windowEndMs + 1e-4) {
          pulses.push({
            scoreBeat: scopeStartBeat,
            pulseIndexInMeasure: i % meterAtScopeStart.numerator,
            isDownbeat: i % meterAtScopeStart.numerator === 0,
            bpm: bpmAtScopeStart,
            denominator: meterAtScopeStart.denominator,
            numerator: meterAtScopeStart.numerator,
            timeMs: pulseTimeMs,
            isCountIn: true,
          });
        }
      }
    }

    // 2. RUNNING PULSES (performanceTimeMs >= 0)
    if (windowEndMs >= 0) {
      const scopeStartTimeMs = timeline.beatToTimeMs(scopeStartBeat);
      const startMs = Math.max(0, windowStartMs);
      const endMs = Math.max(0, windowEndMs);

      const minTimelineMs = scopeStartTimeMs + startMs;
      const maxTimelineMs = scopeStartTimeMs + endMs;

      const minBeat = timeline.timeMsToBeat(minTimelineMs);
      const maxBeat = timeline.timeMsToBeat(maxTimelineMs);

      const meterSegments = artifact.meterSegments.length > 0
        ? artifact.meterSegments
        : [meterAtScopeStart];

      for (let sIdx = 0; sIdx < meterSegments.length; sIdx += 1) {
        const seg = meterSegments[sIdx];
        const nextSegStart = meterSegments[sIdx + 1]?.startBeat ?? timeline.endBeat;
        const segStartBeat = Math.max(scopeStartBeat, seg.startBeat);
        const segEndBeat = Math.min(timeline.endBeat, nextSegStart);

        if (segEndBeat <= segStartBeat) continue;
        if (segEndBeat < minBeat - 1e-4 || segStartBeat > maxBeat + 1e-4) continue;

        const step = pulseStepBeats(seg);
        const effectiveMinBeat = Math.max(segStartBeat, minBeat);
        const kStart = Math.max(0, Math.ceil(roundBeat((effectiveMinBeat - seg.startBeat) / step)));
        const effectiveMaxBeat = Math.min(segEndBeat, maxBeat);

        for (let k = kStart; ; k += 1) {
          const beat = roundBeat(seg.startBeat + k * step);
          if (beat >= segEndBeat - 1e-4 && segEndBeat < timeline.endBeat) {
            break;
          }
          if (beat > timeline.endBeat + 1e-4 || beat > effectiveMaxBeat + 1e-4) {
            break;
          }

          const pulseTimelineMs = timeline.beatToTimeMs(beat);
          const runningTimeMs = pulseTimelineMs - scopeStartTimeMs;
          if (runningTimeMs >= startMs - 1e-4 && runningTimeMs <= endMs + 1e-4) {
            pulses.push({
              scoreBeat: beat,
              pulseIndexInMeasure: pulseIndexInMeasure(seg, beat),
              isDownbeat: isDownbeat(seg, beat),
              bpm: timeline.bpmAtBeat(beat),
              denominator: seg.denominator,
              numerator: seg.numerator,
              timeMs: runningTimeMs,
              isCountIn: false,
            });
          }
        }
      }
    }

    return pulses.sort((a, b) => a.timeMs - b.timeMs);
  }

  /**
   * Batch planner for STEP-BY-STEP mode within [windowStartMs, windowEndMs].
   * Fixed tempo anchored to target onset beat. Legal pulses on score meter grid.
   */
  static planStepPulses(options: {
    timeline: PracticeTempoTimeline;
    artifact: PracticeScoreArtifact;
    targetOnsetBeat: number;
    windowStartMs: number;
    windowEndMs: number;
  }): MetronomePulse[] {
    const { timeline, artifact, targetOnsetBeat, windowStartMs, windowEndMs } = options;
    if (windowEndMs < 0) return [];

    const boundedTarget = Math.max(0, targetOnsetBeat);
    const fixedBpm = timeline.bpmAtBeat(boundedTarget);
    const meter = meterAtBeat(artifact, boundedTarget);
    const step = pulseStepBeats(meter);
    const pulseIntervalMs = beatsToMs(step, fixedBpm);
    if (pulseIntervalMs <= 0) return [];

    const diff = (boundedTarget - meter.startBeat) / step;
    const diffRounded = Math.round(diff);
    let firstBeat: number;
    let initialDelayMs: number;

    if (Math.abs(diff - diffRounded) < 1e-4) {
      firstBeat = roundBeat(meter.startBeat + diffRounded * step);
      initialDelayMs = 0;
    } else {
      const k = Math.ceil(roundBeat(diff));
      firstBeat = roundBeat(meter.startBeat + k * step);
      initialDelayMs = beatsToMs(roundBeat(firstBeat - boundedTarget), fixedBpm);
    }

    const pulses: MetronomePulse[] = [];
    for (let k = 0; ; k += 1) {
      const timeMs = initialDelayMs + k * pulseIntervalMs;
      if (timeMs > windowEndMs + 1e-4) break;
      if (timeMs >= windowStartMs - 1e-4) {
        const beat = roundBeat(firstBeat + k * step);
        pulses.push({
          scoreBeat: beat,
          pulseIndexInMeasure: pulseIndexInMeasure(meter, beat),
          isDownbeat: isDownbeat(meter, beat),
          bpm: fixedBpm,
          denominator: meter.denominator,
          numerator: meter.numerator,
          timeMs,
          isCountIn: false,
        });
      }
    }
    return pulses;
  }
}
