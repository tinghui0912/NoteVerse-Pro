import { describe, expect, it } from 'vitest';
import { scoreGenresForDisplay, isScoreGenre, knownGenres } from '@/lib/score/genres';

describe('Score genres', () => {
  it('has the current ordered genre vocabulary', () => {
    expect(knownGenres([...scoreGenresForDisplay].reverse())).toEqual(scoreGenresForDisplay);
  });
  it('filters untrusted restored values and deduplicates in canonical order', () => {
    expect(
      knownGenres(['jazz', 'unknown', 'classical', 'jazz', { category: 'genre', code: 'rock' }])
    ).toEqual(['classical', 'jazz']);
    expect(knownGenres(null)).toEqual([]);
    expect(knownGenres([])).toEqual([]);
    expect(isScoreGenre('jazz')).toBe(true);
    expect(isScoreGenre('unknown')).toBe(false);
  });
});
