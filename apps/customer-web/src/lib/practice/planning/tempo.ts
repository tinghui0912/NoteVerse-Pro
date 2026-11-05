import { scoreTick, ticksPerQuarter as requireResolution } from '@/lib/practice/score/score-time';
import {
  PracticeScoreArtifact,
  TempoSegment,
} from '@/lib/practice/score/artifact';

import { DEFAULT_SCORE_TEMPO_BPM } from '@/lib/score/tempo-policy';
export const MIN_PRACTICE_TEMPO_BPM = 40;
export const MAX_PRACTICE_TEMPO_BPM = 240;

export type PracticeTempoSelection =
  | { mode: 'SCORE' }
  | { mode: 'CUSTOM_FIXED_BPM'; bpm: number };

export type PracticeTempoSegmentSource =
  | 'MUSICXML'
  | 'PRODUCT_DEFAULT'
  | 'CUSTOM';

export interface ResolvedPracticeTempoSegment {
  readonly startTick: number;
  readonly bpm: number;
  readonly source: PracticeTempoSegmentSource;
}

export interface ResolvedPracticeTempoPlan {
  readonly selection: Readonly<PracticeTempoSelection>;
  readonly segments: readonly ResolvedPracticeTempoSegment[];
}

export function isCustomTempoValid(bpm: number): boolean {
  return (
    Number.isFinite(bpm) &&
    bpm >= MIN_PRACTICE_TEMPO_BPM &&
    bpm <= MAX_PRACTICE_TEMPO_BPM
  );
}

export function clampCustomTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) {
    throw new Error('Custom tempo editing requires a finite number.');
  }
  return Math.min(
    MAX_PRACTICE_TEMPO_BPM,
    Math.max(MIN_PRACTICE_TEMPO_BPM, Math.round(bpm))
  );
}

export type ScoreTempoInput =
  | PracticeScoreArtifact
  | { scoreTempoSegments?: readonly TempoSegment[] }
  | readonly TempoSegment[]
  | null
  | undefined;

function extractTempoSegments(
  input: ScoreTempoInput
): readonly TempoSegment[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) return input;
  if ('scoreTempoSegments' in input) return input.scoreTempoSegments;
  return undefined;
}

export function hasExplicitScoreTempo(input: ScoreTempoInput): boolean {
  const segments = extractTempoSegments(input);
  return Array.isArray(segments) && segments.length > 0;
}

export function initialScoreTempoBpm(input: ScoreTempoInput): number {
  return effectiveScoreTempoAtTick(input, 0).bpm;
}

export function hasScoreTempoChanges(input: ScoreTempoInput): boolean {
  const segments = extractTempoSegments(input);
  return Array.isArray(segments) && segments.length > 1;
}

export interface EffectiveScoreTempoInfo {
  readonly bpm: number;
  readonly source: 'MUSICXML' | 'PRODUCT_DEFAULT';
  readonly hasSubsequentScoreTempoChanges: boolean;
  readonly nextScoreTempoTick?: number;
  readonly isDefault: boolean;
  readonly hasSubsequentChanges: boolean;
  readonly explicitStartTick?: number;
}

export function effectiveScoreTempoAtTick(
  input: ScoreTempoInput,
  scopeStartTick = 0
): EffectiveScoreTempoInfo {
  const targetTick = scoreTick(scopeStartTick);
  const segments = extractTempoSegments(input);
  if (!segments || segments.length === 0) {
    return {
      bpm: DEFAULT_SCORE_TEMPO_BPM,
      source: 'PRODUCT_DEFAULT',
      hasSubsequentScoreTempoChanges: false,
      isDefault: true,
      hasSubsequentChanges: false,
    };
  }

  const sorted = [...segments].sort((a, b) => a.startTick - b.startTick);

  const atOrBefore = sorted.filter((s) => s.startTick <= targetTick);
  const subsequent = sorted.filter((s) => s.startTick > targetTick);

  if (atOrBefore.length === 0) {
    // Explicit tempo markings exist, but the first one starts after scopeStartTick
    return {
      bpm: DEFAULT_SCORE_TEMPO_BPM,
      source: 'PRODUCT_DEFAULT',
      hasSubsequentScoreTempoChanges: true,
      nextScoreTempoTick: sorted[0].startTick,
      isDefault: true,
      hasSubsequentChanges: true,
      explicitStartTick: sorted[0].startTick,
    };
  }

  const activeSegment = atOrBefore[atOrBefore.length - 1];
  return {
    bpm: activeSegment.bpm,
    source: 'MUSICXML',
    hasSubsequentScoreTempoChanges: subsequent.length > 0,
    nextScoreTempoTick: subsequent[0]?.startTick,
    isDefault: false,
    hasSubsequentChanges: subsequent.length > 0,
    explicitStartTick: activeSegment.startTick,
  };
}

export function resolvePracticeTempoPlan(
  artifact: PracticeScoreArtifact,
  tempoSelection: PracticeTempoSelection
): ResolvedPracticeTempoPlan {
  if (tempoSelection.mode === 'CUSTOM_FIXED_BPM') {
    const rawBpm = tempoSelection.bpm;
    if (
      !Number.isFinite(rawBpm) ||
      rawBpm < MIN_PRACTICE_TEMPO_BPM ||
      rawBpm > MAX_PRACTICE_TEMPO_BPM
    ) {
      throw new Error(
        `Custom practice tempo must be between ${MIN_PRACTICE_TEMPO_BPM} and ${MAX_PRACTICE_TEMPO_BPM} BPM, received ${rawBpm}.`
      );
    }
    const bpm = Math.round(rawBpm);
    return {
      selection: tempoSelection,
      segments: [{ startTick: 0, bpm, source: 'CUSTOM' }],
    };
  }

  const rawSegments = artifact.scoreTempoSegments;
  if (!rawSegments || rawSegments.length === 0) {
    return {
      selection: tempoSelection,
      segments: [
        {
          startTick: 0,
          bpm: DEFAULT_SCORE_TEMPO_BPM,
          source: 'PRODUCT_DEFAULT',
        },
      ],
    };
  }

  if (
    rawSegments.some(
      (s) =>
        !Number.isSafeInteger(s.startTick) ||
        s.startTick < 0 ||
        !Number.isFinite(s.bpm) ||
        s.bpm <= 0
    )
  ) {
    throw new Error('Invalid explicit score tempo.');
  }
  const sortedSegments = [...rawSegments].sort(
    (a, b) => a.startTick - b.startTick
  );
  const first = sortedSegments[0];

  if (first.startTick > 0) {
    return {
      selection: tempoSelection,
      segments: [
        {
          startTick: 0,
          bpm: DEFAULT_SCORE_TEMPO_BPM,
          source: 'PRODUCT_DEFAULT',
        },
        ...sortedSegments.map((s) => ({
          startTick: s.startTick,
          bpm: s.bpm,
          source: 'MUSICXML' as const,
        })),
      ],
    };
  }

  return {
    selection: tempoSelection,
    segments: sortedSegments.map((s) => ({
      startTick: s.startTick,
      bpm: s.bpm,
      source: 'MUSICXML' as const,
    })),
  };
}

export type TimelineSegment = {
  readonly startTick: number;
  readonly endTick: number;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly bpm: number;
};

/** Runtime time conversion boundary; the returned milliseconds never define score identity. */
export function ticksToMs(
  ticks: number,
  bpm: number,
  resolution: number
): number {
  scoreTick(ticks);
  requireResolution(resolution);
  if (!Number.isFinite(bpm) || bpm <= 0)
    throw new Error('Invalid Practice tempo.');
  const milliseconds = ((ticks / resolution) * 60_000) / bpm;
  if (!Number.isFinite(milliseconds))
    throw new Error('Unrepresentable Practice runtime duration.');
  return milliseconds;
}

export class PracticeTempoTimeline {
  readonly endTick: number;
  readonly ticksPerQuarter: number;
  readonly plan: ResolvedPracticeTempoPlan;
  private readonly segments: readonly TimelineSegment[];

  constructor(
    plan: ResolvedPracticeTempoPlan,
    scoreEndTick: number,
    resolution: number
  ) {
    this.endTick = scoreTick(scoreEndTick);
    this.ticksPerQuarter = requireResolution(resolution);
    this.plan = plan;
    if (!plan?.segments.length)
      throw new Error('Practice tempo segments required.');
    let previous = -1;
    for (const segment of plan.segments) {
      scoreTick(segment.startTick);
      if (
        segment.startTick <= previous ||
        !Number.isFinite(segment.bpm) ||
        segment.bpm <= 0
      )
        throw new Error('Invalid explicit tempo timeline segment.');
      previous = segment.startTick;
    }
    if (plan.segments[0].startTick !== 0)
      throw new Error('Practice tempo requires tick 0.');
    let time = 0;
    this.segments = plan.segments.flatMap((tempo, index) => {
      const startTick = Math.min(tempo.startTick, this.endTick);
      const endTick = Math.min(
        plan.segments[index + 1]?.startTick ?? this.endTick,
        this.endTick
      );
      if (endTick <= startTick) return [];
      const startTimeMs = time;
      time += ticksToMs(endTick - startTick, tempo.bpm, this.ticksPerQuarter);
      if (!Number.isFinite(time))
        throw new Error('Unrepresentable Practice runtime duration.');
      return [
        { startTick, endTick, startTimeMs, endTimeMs: time, bpm: tempo.bpm },
      ];
    });
  }

  tickToTimeMs(tick: number): number {
    const bounded = Math.min(scoreTick(tick), this.endTick);
    const segment =
      this.segments.find(
        (s) => s.startTick <= bounded && bounded < s.endTick
      ) ?? this.segments.at(-1);
    return segment
      ? segment.startTimeMs +
          ticksToMs(
            bounded - segment.startTick,
            segment.bpm,
            this.ticksPerQuarter
          )
      : 0;
  }

  /** Greatest integral grid tick reached at this wall-clock instant, for cursor selection. */
  timeMsToTick(timeMs: number): number {
    if (!Number.isFinite(timeMs))
      throw new Error('Invalid Practice runtime time.');
    const bounded = Math.min(Math.max(timeMs, 0), this.durationMs);
    let low = 0,
      high = this.endTick;
    while (low < high) {
      const middle = Number((BigInt(low) + BigInt(high) + 1n) / 2n);
      if (this.tickToTimeMs(middle) <= bounded) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  bpmAtTick(tick: number): number {
    const bounded = Math.min(scoreTick(tick), this.endTick);
    let bpm = this.plan.segments[0].bpm;
    for (const segment of this.plan.segments) {
      if (segment.startTick > bounded) break;
      bpm = segment.bpm;
    }
    return bpm;
  }
  get durationMs(): number {
    return this.segments.at(-1)?.endTimeMs ?? 0;
  }
  getSegments(): readonly TimelineSegment[] {
    return this.segments;
  }
}
