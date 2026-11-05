import type { MeterSegment } from '@/lib/practice/kernel/artifact';
import {
  measureDurationTicks,
  meterPulseTicks,
  pulseAtOrAfter,
  scoreTick,
} from '@/lib/practice/kernel/score-time';
import { ticksToMs, PracticeTempoTimeline } from '@/lib/practice/kernel/tempo';

export type MetronomeMeterSource = {
  meterSegments: readonly Readonly<MeterSegment>[];
  ticksPerQuarter: number;
};
export interface MetronomePulse {
  readonly scoreTick: number;
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
      scopeStartTick: number;
      timelineTimeMs: number;
      countInTotalMs: number;
      countInRemainingMs: number;
      countInPulses: number;
    }
  | { state: 'RUNNING'; timelineTimeMs: number };
export interface ContinuousCountInState {
  readonly phase: 'COUNT_IN';
  readonly scopeStartTick: number;
  readonly timelineTimeMs: number;
  readonly countInTotalMs: number;
  readonly countInPulses: number;
  readonly pulseIntervalMs: number;
  readonly pulseIndex: number;
  readonly nextPulseTimeMs: number;
  readonly timeUntilPulseMs: number;
}
export interface ContinuousRunningState {
  readonly phase: 'RUNNING';
  readonly currentTick: number;
  readonly nextPulseTimeMs: number;
  readonly timeUntilPulseMs: number;
}
export interface StepRunningState {
  readonly phase: 'STEP';
  readonly targetOnsetTick: number;
  readonly currentTick: number;
  readonly fixedBpm: number;
  readonly stepPulseCounter: number;
  readonly nextPulseTimeMs: number;
  readonly timeUntilPulseMs: number;
}
export type MetronomePlanningCursor =
  | ContinuousCountInState
  | ContinuousRunningState
  | StepRunningState;
export function pulseStepTicks(
  meter: MeterSegment,
  resolution: number
): number {
  return meterPulseTicks(meter, resolution);
}
function meterAtTick(source: MetronomeMeterSource, tick: number): MeterSegment {
  scoreTick(tick);
  if (!source.meterSegments.length || source.meterSegments[0].startTick !== 0)
    throw new Error('Initial meter required.');
  let active = source.meterSegments[0];
  for (const segment of source.meterSegments) {
    if (segment.startTick > tick) break;
    active = segment;
  }
  return active;
}
export function isDownbeat(
  meter: MeterSegment,
  tick: number,
  resolution: number
): boolean {
  scoreTick(tick);
  return (
    tick >= meter.startTick &&
    BigInt(tick - meter.startTick) %
      BigInt(measureDurationTicks(meter, resolution)) ===
      0n
  );
}
export function pulseIndexInMeasure(
  meter: MeterSegment,
  tick: number,
  resolution: number
): number {
  scoreTick(tick);
  const step = BigInt(pulseStepTicks(meter, resolution));
  const relative = BigInt(tick - meter.startTick);
  if (relative < 0n || relative % step)
    throw new Error('Pulse is outside the integral meter grid.');
  return Number((relative / step) % BigInt(meter.numerator));
}
function gridAtOrAfter(source: MetronomeMeterSource, tick: number): number {
  const meter = meterAtTick(source, tick);
  const candidate = pulseAtOrAfter(
    tick,
    meter.startTick,
    pulseStepTicks(meter, source.ticksPerQuarter)
  );
  const nextMeter = source.meterSegments.find((s) => s.startTick > tick);
  return nextMeter ? Math.min(candidate, nextMeter.startTick) : candidate;
}
function nextGridTick(source: MetronomeMeterSource, tick: number): number {
  const meter = meterAtTick(source, tick);
  const candidate = scoreTick(
    tick + pulseStepTicks(meter, source.ticksPerQuarter)
  );
  const nextMeter = source.meterSegments.find((s) => s.startTick > tick);
  return nextMeter ? Math.min(candidate, nextMeter.startTick) : candidate;
}
function runningCursor(
  source: MetronomeMeterSource,
  timeline: PracticeTempoTimeline,
  timelineTimeMs: number,
  baseTimeMs: number
): ContinuousRunningState {
  let tick = gridAtOrAfter(source, timeline.timeMsToTick(timelineTimeMs));
  if (tick <= timeline.endTick && timeline.tickToTimeMs(tick) < timelineTimeMs)
    tick = nextGridTick(source, tick);
  const delay =
    tick > timeline.endTick
      ? Infinity
      : Math.max(0, timeline.tickToTimeMs(tick) - timelineTimeMs);
  return {
    phase: 'RUNNING',
    currentTick: tick,
    nextPulseTimeMs: baseTimeMs + delay,
    timeUntilPulseMs: delay,
  };
}
function pulse(
  source: MetronomeMeterSource,
  tick: number,
  bpm: number,
  timeMs: number,
  countInIndex?: number
): MetronomePulse {
  const meter = meterAtTick(source, tick);
  const index =
    countInIndex === undefined
      ? pulseIndexInMeasure(meter, tick, source.ticksPerQuarter)
      : countInIndex % meter.numerator;
  return {
    scoreTick: tick,
    pulseIndexInMeasure: index,
    isDownbeat:
      countInIndex === undefined
        ? isDownbeat(meter, tick, source.ticksPerQuarter)
        : index === 0,
    bpm,
    denominator: meter.denominator,
    numerator: meter.numerator,
    timeMs,
    isCountIn: countInIndex !== undefined,
  };
}
export class MetronomePulsePlanner {
  static createContinuousCursor(
    sync: ContinuousMetronomeSyncPoint,
    source: MetronomeMeterSource,
    timeline: PracticeTempoTimeline,
    baseTimeMs = 0
  ): ContinuousCountInState | ContinuousRunningState {
    if (sync.state === 'RUNNING')
      return runningCursor(source, timeline, sync.timelineTimeMs, baseTimeMs);
    scoreTick(sync.scopeStartTick);
    if (sync.countInPulses <= 0 || sync.countInTotalMs <= 0)
      return runningCursor(source, timeline, sync.timelineTimeMs, baseTimeMs);
    const interval = sync.countInTotalMs / sync.countInPulses;
    const elapsed = Math.max(0, sync.countInTotalMs - sync.countInRemainingMs);
    const index = Math.max(0, Math.ceil((elapsed - 0.0001) / interval));
    if (index >= sync.countInPulses)
      return runningCursor(
        source,
        timeline,
        sync.timelineTimeMs,
        baseTimeMs + Math.max(0, sync.countInTotalMs - elapsed)
      );
    const delay = Math.max(0, index * interval - elapsed);
    return {
      phase: 'COUNT_IN',
      scopeStartTick: sync.scopeStartTick,
      timelineTimeMs: sync.timelineTimeMs,
      countInTotalMs: sync.countInTotalMs,
      countInPulses: sync.countInPulses,
      pulseIntervalMs: interval,
      pulseIndex: index,
      nextPulseTimeMs: baseTimeMs + delay,
      timeUntilPulseMs: delay,
    };
  }
  static createStepCursor(
    targetOnsetTick: number,
    source: MetronomeMeterSource,
    timeline: PracticeTempoTimeline,
    baseTimeMs = 0
  ): StepRunningState {
    scoreTick(targetOnsetTick);
    const first = gridAtOrAfter(source, targetOnsetTick),
      bpm = timeline.bpmAtTick(targetOnsetTick);
    const delay = ticksToMs(
      first - targetOnsetTick,
      bpm,
      source.ticksPerQuarter
    );
    return {
      phase: 'STEP',
      targetOnsetTick,
      currentTick: first,
      fixedBpm: bpm,
      stepPulseCounter: 0,
      nextPulseTimeMs: baseTimeMs + delay,
      timeUntilPulseMs: delay,
    };
  }
  static advanceCursorTime(
    cursor: MetronomePlanningCursor,
    elapsedMs: number
  ): MetronomePlanningCursor {
    return {
      ...cursor,
      timeUntilPulseMs: Math.max(0, cursor.timeUntilPulseMs - elapsedMs),
    };
  }
  static planNextPulses(
    cursor: MetronomePlanningCursor,
    horizonMs: number,
    context: {
      artifact: MetronomeMeterSource;
      timeline: PracticeTempoTimeline;
      scopeEndTick: number;
    }
  ): { pulses: MetronomePulse[]; nextCursor: MetronomePlanningCursor } {
    let current = { ...cursor };
    const pulses: MetronomePulse[] = [];
    while (current.nextPulseTimeMs <= horizonMs + 0.0001) {
      if (current.phase === 'COUNT_IN') {
        pulses.push(
          pulse(
            context.artifact,
            current.scopeStartTick,
            context.timeline.bpmAtTick(current.scopeStartTick),
            current.nextPulseTimeMs,
            current.pulseIndex
          )
        );
        const nextTime = current.nextPulseTimeMs + current.pulseIntervalMs;
        current =
          current.pulseIndex + 1 < current.countInPulses
            ? {
                ...current,
                pulseIndex: current.pulseIndex + 1,
                nextPulseTimeMs: nextTime,
                timeUntilPulseMs:
                  current.timeUntilPulseMs + current.pulseIntervalMs,
              }
            : runningCursor(
                context.artifact,
                context.timeline,
                current.timelineTimeMs,
                nextTime
              );
        continue;
      }
      if (
        current.phase === 'RUNNING' &&
        current.currentTick > context.scopeEndTick
      )
        break;
      const bpm =
        current.phase === 'STEP'
          ? current.fixedBpm
          : context.timeline.bpmAtTick(current.currentTick);
      pulses.push(
        pulse(
          context.artifact,
          current.currentTick,
          bpm,
          current.nextPulseTimeMs
        )
      );
      if (
        current.phase === 'RUNNING' &&
        current.currentTick >= context.scopeEndTick
      ) {
        current = {
          ...current,
          nextPulseTimeMs: Infinity,
          timeUntilPulseMs: Infinity,
        };
        break;
      }
      const next = nextGridTick(context.artifact, current.currentTick);
      const interval =
        current.phase === 'STEP'
          ? ticksToMs(
              next - current.currentTick,
              current.fixedBpm,
              context.artifact.ticksPerQuarter
            )
          : context.timeline.tickToTimeMs(
              Math.min(next, context.timeline.endTick)
            ) - context.timeline.tickToTimeMs(current.currentTick);
      if (current.phase === 'RUNNING' && next > context.scopeEndTick) {
        current = {
          ...current,
          currentTick: next,
          nextPulseTimeMs: Infinity,
          timeUntilPulseMs: Infinity,
        };
        break;
      }
      if (interval <= 0)
        throw new Error('Unrepresentable metronome runtime interval.');
      current = {
        ...current,
        currentTick: next,
        nextPulseTimeMs: current.nextPulseTimeMs + interval,
        timeUntilPulseMs: current.timeUntilPulseMs + interval,
        ...(current.phase === 'STEP'
          ? { stepPulseCounter: current.stepPulseCounter + 1 }
          : {}),
      };
    }
    return { pulses, nextCursor: current };
  }
  static planContinuousPulses(options: {
    timeline: PracticeTempoTimeline;
    artifact: MetronomeMeterSource;
    scopeStartTick: number;
    countInPulses: number;
    countInTicks: number;
    windowStartMs: number;
    windowEndMs: number;
  }): MetronomePulse[] {
    const {
      timeline,
      artifact,
      scopeStartTick,
      countInPulses,
      countInTicks,
      windowStartMs,
      windowEndMs,
    } = options;
    const origin = timeline.tickToTimeMs(scopeStartTick),
      pulses: MetronomePulse[] = [];
    const duration = ticksToMs(
      countInTicks,
      timeline.bpmAtTick(scopeStartTick),
      artifact.ticksPerQuarter
    );
    if (countInPulses > 0 && duration > 0) {
      for (let i = 0; i < countInPulses; i++) {
        const time = -duration + (i * duration) / countInPulses;
        if (time >= windowStartMs - 0.0001 && time <= windowEndMs + 0.0001)
          pulses.push(
            pulse(
              artifact,
              scopeStartTick,
              timeline.bpmAtTick(scopeStartTick),
              time,
              i
            )
          );
      }
    }
    if (windowEndMs >= 0) {
      const start = Math.max(0, windowStartMs);
      const cursor = runningCursor(artifact, timeline, origin + start, start);
      pulses.push(
        ...this.planNextPulses(cursor, windowEndMs, {
          artifact,
          timeline,
          scopeEndTick: timeline.endTick,
        }).pulses
      );
    }
    return pulses.sort((a, b) => a.timeMs - b.timeMs);
  }
  static planStepPulses(options: {
    timeline: PracticeTempoTimeline;
    artifact: MetronomeMeterSource;
    targetOnsetTick: number;
    windowStartMs: number;
    windowEndMs: number;
  }): MetronomePulse[] {
    if (options.windowEndMs < 0) return [];
    return this.planNextPulses(
      this.createStepCursor(
        options.targetOnsetTick,
        options.artifact,
        options.timeline
      ),
      options.windowEndMs,
      {
        artifact: options.artifact,
        timeline: options.timeline,
        scopeEndTick: options.timeline.endTick,
      }
    ).pulses.filter((p) => p.timeMs >= options.windowStartMs - 0.0001);
  }
}
