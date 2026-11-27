import type { ScoreGenre } from '@/generated/api';

export const SCORE_GENRE_LABEL_KEYS = {
  classical: 'classical',
  pop: 'pop',
  jazz: 'jazz',
  rock: 'rock',
  folk: 'folk',
  blues: 'blues',
  soundtrack: 'soundtrack',
  anime_game: 'anime_game',
  religious: 'religious',
  latin: 'latin',
  children: 'children',
  original: 'original',
  other: 'other',
} as const satisfies Record<ScoreGenre, string>;

export const scoreGenresForDisplay = Object.freeze(
  Object.keys(SCORE_GENRE_LABEL_KEYS) as ScoreGenre[]
);

export function isScoreGenre(value: unknown): value is ScoreGenre {
  return typeof value === 'string' && Object.hasOwn(SCORE_GENRE_LABEL_KEYS, value);
}

export function knownGenres(value: unknown): ScoreGenre[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.filter(isScoreGenre));
  return scoreGenresForDisplay.filter((code) => selected.has(code));
}
