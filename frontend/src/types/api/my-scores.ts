import type { ScoreDetail } from './scores';

export type MyScoresView = 'all' | 'drafts' | 'private' | 'published';
export type MyScoresPageView = MyScoresView | 'processing' | 'failed';
export type MyScoresSort = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';

export type MyScore = ScoreDetail;
