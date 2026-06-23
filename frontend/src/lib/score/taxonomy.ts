export const SCORE_TAXONOMY_CATEGORY_GENRE = 'genre' as const;

export type ScoreTaxonomyCategory = typeof SCORE_TAXONOMY_CATEGORY_GENRE;

export type ScoreGenreCode =
  | 'classical'
  | 'pop'
  | 'jazz'
  | 'rock'
  | 'folk'
  | 'blues'
  | 'soundtrack'
  | 'anime_game'
  | 'religious'
  | 'latin'
  | 'children'
  | 'original'
  | 'other';

export interface ScoreTaxonomyTagValue {
  category: ScoreTaxonomyCategory;
  code: ScoreGenreCode;
}

export const SCORE_GENRE_TAGS: ScoreTaxonomyTagValue[] = [
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'classical' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'pop' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'jazz' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'rock' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'folk' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'blues' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'soundtrack' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'anime_game' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'religious' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'latin' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'children' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'original' },
  { category: SCORE_TAXONOMY_CATEGORY_GENRE, code: 'other' },
];

export function taxonomyTagKey(tag: Pick<ScoreTaxonomyTagValue, 'category' | 'code'>) {
  return `${tag.category}:${tag.code}`;
}

export function isGenreTag(tag: { category: string; code: string }): tag is ScoreTaxonomyTagValue {
  return tag.category === SCORE_TAXONOMY_CATEGORY_GENRE
    && SCORE_GENRE_TAGS.some((item) => item.code === tag.code);
}
