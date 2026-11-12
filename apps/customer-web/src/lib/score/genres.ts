export const SCORE_GENRES = [
  'classical',
  'pop',
  'jazz',
  'rock',
  'folk',
  'blues',
  'soundtrack',
  'anime_game',
  'religious',
  'latin',
  'children',
  'original',
  'other',
] as const;

export type ScoreGenreCode = (typeof SCORE_GENRES)[number];

export function isScoreGenre(value: unknown): value is ScoreGenreCode {
  return typeof value === 'string' && SCORE_GENRES.some((code) => code === value);
}

export function knownGenres(value: unknown): ScoreGenreCode[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.filter(isScoreGenre));
  return SCORE_GENRES.filter((code) => selected.has(code));
}
