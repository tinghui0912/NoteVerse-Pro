import { PracticeScoreArtifact, roundBeat, TempoSegment } from './artifact';

export const DEFAULT_PRACTICE_TEMPO_BPM = 80;
export const MIN_PRACTICE_TEMPO_BPM = 40;
export const MAX_PRACTICE_TEMPO_BPM = 240;

export type PracticeTempoSelection =
  | { mode: 'SCORE' }
  | { mode: 'CUSTOM_FIXED_BPM'; bpm: number };

export type PracticeTempoSource = 'MUSICXML' | 'PRODUCT_DEFAULT' | 'CUSTOM';

export interface ResolvedPracticeTempoPlan {
  readonly source: PracticeTempoSource;
  readonly segments: readonly TempoSegment[];
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
      source: 'CUSTOM',
      segments: [{ startBeat: 0, bpm }],
    };
  }

  const rawSegments = artifact.scoreTempoSegments;
  if (!rawSegments || rawSegments.length === 0) {
    return {
      source: 'PRODUCT_DEFAULT',
      segments: [{ startBeat: 0, bpm: DEFAULT_PRACTICE_TEMPO_BPM }],
    };
  }

  const sortedSegments = [...rawSegments].sort((a, b) => a.startBeat - b.startBeat);
  const first = sortedSegments[0];

  if (roundBeat(first.startBeat) > 0) {
    return {
      source: 'MUSICXML',
      segments: [
        { startBeat: 0, bpm: DEFAULT_PRACTICE_TEMPO_BPM },
        ...sortedSegments,
      ],
    };
  }

  return {
    source: 'MUSICXML',
    segments: sortedSegments,
  };
}
