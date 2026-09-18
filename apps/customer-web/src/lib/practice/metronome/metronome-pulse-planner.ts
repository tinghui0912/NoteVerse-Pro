import type { MeterSegment, PracticeScoreArtifact } from '../local-core/artifact';
import { roundBeat } from '../local-core/artifact';
import { beatsToMs, PracticeTempoTimeline } from '../local-core/practice-tempo';

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

export type ContinuousMetronomePhase =
  | {
      kind: 'COUNT_IN';
      scopeStartBeat: number;
      countInTotalBeats: number;
      countInPulses: number;
      countInElapsedMs: number;
    }
  | {
      kind: 'RUNNING';
      musicalBeat: number;
      runningElapsedMs: number;
    };

export interface StepMetronomeContext {
  targetOnsetBeat: number;
  stepElapsedMs: number;
}

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
   * Plans pulses for CONTINUOUS performance mode within a time window [windowStartMs, windowEndMs].
   * All time values are in performance timeline ms (count-in times are negative: [-countInDurationMs, 0]).
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
   * Plans pulses for STEP-BY-STEP mode within a time window [windowStartMs, windowEndMs].
   * The tempo and meter context are completely anchored to current target onsetBeat!
   * Metronome ticks here NEVER advance target onsetBeat or cross into future score tempos.
   */
  static planStepPulses(options: {
    timeline: PracticeTempoTimeline;
    artifact: PracticeScoreArtifact;
    targetOnsetBeat: number;
    windowStartMs: number;
    windowEndMs: number;
  }): MetronomePulse[] {
    const { timeline, artifact, targetOnsetBeat, windowStartMs, windowEndMs } = options;
    const bpm = timeline.bpmAtBeat(targetOnsetBeat);
    const meter = meterAtBeat(artifact, targetOnsetBeat);
    const step = pulseStepBeats(meter);
    const pulseIntervalMs = beatsToMs(step, bpm);

    if (pulseIntervalMs <= 0 || windowEndMs < 0) {
      return [];
    }

    const pulses: MetronomePulse[] = [];
    const basePulseIndex = pulseIndexInMeasure(meter, targetOnsetBeat);

    const kStart = Math.max(0, Math.ceil(roundBeat(windowStartMs / pulseIntervalMs)));
    const kEnd = Math.floor(roundBeat(windowEndMs / pulseIntervalMs));

    for (let k = kStart; k <= kEnd; k += 1) {
      const timeMs = k * pulseIntervalMs;
      const pulseIdx = (basePulseIndex + k) % meter.numerator;
      pulses.push({
        scoreBeat: targetOnsetBeat,
        pulseIndexInMeasure: pulseIdx,
        isDownbeat: pulseIdx === 0,
        bpm,
        denominator: meter.denominator,
        numerator: meter.numerator,
        timeMs,
        isCountIn: false,
      });
    }

    return pulses;
  }
}
