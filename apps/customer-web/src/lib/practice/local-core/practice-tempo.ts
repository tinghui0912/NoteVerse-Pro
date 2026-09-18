import { PracticeScoreArtifact, roundBeat, TempoSegment } from './artifact';

export const DEFAULT_PRACTICE_TEMPO_BPM = 80;
export const MIN_PRACTICE_TEMPO_BPM = 40;
export const MAX_PRACTICE_TEMPO_BPM = 240;

export type PracticeTempoSelection =
  | { mode: 'SCORE' }
  | { mode: 'CUSTOM_FIXED_BPM'; bpm: number };

export type PracticeTempoSegmentSource = 'MUSICXML' | 'PRODUCT_DEFAULT' | 'CUSTOM';

export interface ResolvedPracticeTempoSegment {
  readonly startBeat: number;
  readonly bpm: number;
  readonly source: PracticeTempoSegmentSource;
}

export interface ResolvedPracticeTempoPlan {
  readonly selection: PracticeTempoSelection;
  readonly segments: readonly ResolvedPracticeTempoSegment[];
}

export function isCustomTempoValid(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm >= MIN_PRACTICE_TEMPO_BPM && bpm <= MAX_PRACTICE_TEMPO_BPM;
}

export function clampCustomTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) {
    return DEFAULT_PRACTICE_TEMPO_BPM;
  }
  return Math.min(MAX_PRACTICE_TEMPO_BPM, Math.max(MIN_PRACTICE_TEMPO_BPM, Math.round(bpm)));
}

export type ScoreTempoInput =
  | PracticeScoreArtifact
  | { scoreTempoSegments?: readonly TempoSegment[] }
  | readonly TempoSegment[]
  | null
  | undefined;

function extractTempoSegments(input: ScoreTempoInput): readonly TempoSegment[] | undefined {
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
  const segments = extractTempoSegments(input);
  if (Array.isArray(segments) && segments.length > 0) {
    return segments[0].bpm;
  }
  return DEFAULT_PRACTICE_TEMPO_BPM;
}

export function hasScoreTempoChanges(input: ScoreTempoInput): boolean {
  const segments = extractTempoSegments(input);
  return Array.isArray(segments) && segments.length > 1;
}

export interface EffectiveScoreTempoInfo {
  readonly bpm: number;
  readonly isDefault: boolean;
  readonly hasSubsequentChanges: boolean;
  readonly explicitStartBeat?: number;
}

export function effectiveScoreTempoAtBeat(
  input: ScoreTempoInput,
  scopeStartBeat = 0
): EffectiveScoreTempoInfo {
  const segments = extractTempoSegments(input);
  if (!segments || segments.length === 0) {
    return {
      bpm: DEFAULT_PRACTICE_TEMPO_BPM,
      isDefault: true,
      hasSubsequentChanges: false,
    };
  }

  const sorted = [...segments].sort((a, b) => a.startBeat - b.startBeat);
  const targetBeat = roundBeat(Math.max(0, scopeStartBeat));

  const atOrBefore = sorted.filter((s) => roundBeat(s.startBeat) <= targetBeat);
  const subsequent = sorted.filter((s) => roundBeat(s.startBeat) > targetBeat);

  if (atOrBefore.length === 0) {
    // Explicit tempo markings exist, but the first one starts after scopeStartBeat
    return {
      bpm: DEFAULT_PRACTICE_TEMPO_BPM,
      isDefault: true,
      hasSubsequentChanges: true,
      explicitStartBeat: sorted[0].startBeat,
    };
  }

  const activeSegment = atOrBefore[atOrBefore.length - 1];
  return {
    bpm: activeSegment.bpm,
    isDefault: false,
    hasSubsequentChanges: subsequent.length > 0,
    explicitStartBeat: activeSegment.startBeat,
  };
}

export function resolvePracticeTempoPlan(
  artifact: PracticeScoreArtifact,
  tempoSelection: PracticeTempoSelection
): ResolvedPracticeTempoPlan {
  if (tempoSelection.mode === 'CUSTOM_FIXED_BPM') {
    const rawBpm = tempoSelection.bpm;
    if (!Number.isFinite(rawBpm) || rawBpm < MIN_PRACTICE_TEMPO_BPM || rawBpm > MAX_PRACTICE_TEMPO_BPM) {
      throw new Error(
        `Custom practice tempo must be between ${MIN_PRACTICE_TEMPO_BPM} and ${MAX_PRACTICE_TEMPO_BPM} BPM, received ${rawBpm}.`
      );
    }
    const bpm = Math.round(rawBpm);
    return {
      selection: tempoSelection,
      segments: [{ startBeat: 0, bpm, source: 'CUSTOM' }],
    };
  }

  const rawSegments = artifact.scoreTempoSegments;
  if (!rawSegments || rawSegments.length === 0) {
    return {
      selection: tempoSelection,
      segments: [{ startBeat: 0, bpm: DEFAULT_PRACTICE_TEMPO_BPM, source: 'PRODUCT_DEFAULT' }],
    };
  }

  const sortedSegments = [...rawSegments].sort((a, b) => a.startBeat - b.startBeat);
  const first = sortedSegments[0];

  if (roundBeat(first.startBeat) > 0) {
    return {
      selection: tempoSelection,
      segments: [
        { startBeat: 0, bpm: DEFAULT_PRACTICE_TEMPO_BPM, source: 'PRODUCT_DEFAULT' },
        ...sortedSegments.map((s) => ({ startBeat: s.startBeat, bpm: s.bpm, source: 'MUSICXML' as const })),
      ],
    };
  }

  return {
    selection: tempoSelection,
    segments: sortedSegments.map((s) => ({ startBeat: s.startBeat, bpm: s.bpm, source: 'MUSICXML' as const })),
  };
}

export type TimelineSegment = {
  readonly startBeat: number;
  readonly endBeat: number;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly bpm: number;
};

export function beatsToMs(beats: number, bpm: number): number {
  return (beats * 60_000) / bpm;
}

export function msToBeats(milliseconds: number, bpm: number): number {
  return (milliseconds * bpm) / 60_000;
}

export class PracticeTempoTimeline {
  readonly endBeat: number;
  readonly plan: ResolvedPracticeTempoPlan;
  private readonly segments: readonly TimelineSegment[];

  constructor(plan: ResolvedPracticeTempoPlan, scoreEndBeat: number) {
    if (!plan || !Array.isArray(plan.segments) || plan.segments.length === 0) {
      throw new Error('PracticeTempoTimeline requires a valid ResolvedPracticeTempoPlan with segments.');
    }
    this.plan = plan;
    this.endBeat = Math.max(0, scoreEndBeat);
    this.segments = buildTimelineSegments(this.endBeat, plan.segments);
  }

  beatToTimeMs(beat: number): number {
    if (this.segments.length === 0) {
      return 0;
    }
    const bounded = Math.min(Math.max(beat, 0), this.endBeat);
    const segment = this.segmentForBeat(bounded);
    return segment.startTimeMs + beatsToMs(bounded - segment.startBeat, segment.bpm);
  }

  timeMsToBeat(timeMs: number): number {
    if (this.segments.length === 0) {
      return 0;
    }
    const durationMs = this.segments[this.segments.length - 1]?.endTimeMs ?? 0;
    const bounded = Math.min(Math.max(timeMs, 0), durationMs);
    const segment = this.segmentForTimeMs(bounded);
    return roundBeat(segment.startBeat + msToBeats(bounded - segment.startTimeMs, segment.bpm));
  }

  bpmAtBeat(beat: number): number {
    if (this.segments.length === 0) {
      throw new Error('Cannot determine BPM: tempo timeline has no segments.');
    }
    return this.segmentForBeat(Math.min(Math.max(beat, 0), this.endBeat)).bpm;
  }

  get durationMs(): number {
    return this.segments[this.segments.length - 1]?.endTimeMs ?? 0;
  }

  getSegments(): readonly TimelineSegment[] {
    return this.segments;
  }

  private segmentForBeat(beat: number): TimelineSegment {
    return (
      this.segments.find((segment) => segment.startBeat <= beat && beat < segment.endBeat) ??
      this.segments[this.segments.length - 1]
    );
  }

  private segmentForTimeMs(timeMs: number): TimelineSegment {
    return (
      this.segments.find((segment) => segment.startTimeMs <= timeMs && timeMs < segment.endTimeMs) ??
      this.segments[this.segments.length - 1]
    );
  }
}

function buildTimelineSegments(
  endBeat: number,
  tempoSegments: readonly (TempoSegment | ResolvedPracticeTempoSegment)[]
): TimelineSegment[] {
  if (endBeat <= 0) {
    return [];
  }
  if (!tempoSegments || tempoSegments.length === 0) {
    throw new Error('Practice tempo timeline segments cannot be built without tempo segments.');
  }
  const byBeat = new Map<number, { startBeat: number; bpm: number }>();
  for (const segment of tempoSegments) {
    if (
      Number.isFinite(segment.startBeat) &&
      segment.startBeat >= 0 &&
      Number.isFinite(segment.bpm) &&
      segment.bpm > 0
    ) {
      byBeat.set(roundBeat(segment.startBeat), { startBeat: roundBeat(segment.startBeat), bpm: segment.bpm });
    }
  }
  if (!byBeat.has(0)) {
    throw new Error('Practice tempo timeline segments must contain beat 0.');
  }
  const normalized = Array.from(byBeat.values()).sort((a, b) => a.startBeat - b.startBeat);
  let currentTimeMs = 0;
  return normalized.flatMap((tempo, index) => {
    const nextStart = normalized[index + 1]?.startBeat ?? endBeat;
    const startBeat = Math.min(Math.max(tempo.startBeat, 0), endBeat);
    const end = Math.min(Math.max(nextStart, startBeat), endBeat);
    if (end <= startBeat) {
      return [];
    }
    const startTimeMs = currentTimeMs;
    const endTimeMs = startTimeMs + beatsToMs(end - startBeat, tempo.bpm);
    currentTimeMs = endTimeMs;
    return [{ startBeat, endBeat: end, startTimeMs, endTimeMs, bpm: tempo.bpm }];
  });
}
