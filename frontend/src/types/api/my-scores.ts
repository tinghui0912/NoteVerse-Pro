import type { ScoreDetail } from './scores';

export type MyScoresView = 'all' | 'private' | 'published';
export type MyScoresPageView = MyScoresView | 'processing' | 'review' | 'failed';
export type MyScoresSort = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';

export type MyScore = ScoreDetail;
