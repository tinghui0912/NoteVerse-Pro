import { describe, expect, it } from 'vitest';
import {
  buildMyScoresHref,
  isMyScoreView,
  myScoresBulkVisibility,
  myScoresTotal,
  MY_SCORE_PAGE_VIEWS,
  MY_SCORE_VIEWS,
  normalizeMyScoresSort,
  normalizeMyScoresView,
  normalizePage,
  scoreBackedView,
  visibleMyScoreJobs,
} from '@/lib/my-scores/state';
import type { ProcessingJob } from '@/types/api';

function job(jobId: string, state: ProcessingJob['state']): ProcessingJob {
  return {
    job_id: jobId,
    state,
    progress: state === 'SUCCESS' ? 100 : 0,
  };
}

describe('my scores view helpers', () => {
  it('keeps score-backed views separate from aggregate processing views', () => {
    expect(MY_SCORE_VIEWS).toEqual(['all', 'drafts', 'private', 'published']);
    expect(MY_SCORE_PAGE_VIEWS).toEqual([
      'all',
      'processing',
      'failed',
      'drafts',
      'private',
      'published',
    ]);
    expect(isMyScoreView('all')).toBe(true);
    expect(isMyScoreView('processing')).toBe(false);
    expect(isMyScoreView('failed')).toBe(false);
  });

  it('normalizes unknown views to all', () => {
    expect(normalizeMyScoresView('archived')).toBe('all');
    expect(normalizeMyScoresView('missing')).toBe('all');
    expect(normalizeMyScoresView(undefined)).toBe('all');
  });

  it('normalizes sort, page, and score-backed aggregate views', () => {
    expect(normalizeMyScoresSort('name_asc')).toBe('name_asc');
    expect(normalizeMyScoresSort('updated_asc')).toBe('updated_desc');
    expect(normalizePage('3')).toBe(3);
    expect(normalizePage('-4')).toBe(1);
    expect(normalizePage('not-a-number')).toBe(1);
    expect(scoreBackedView('processing')).toBe('all');
    expect(scoreBackedView('published')).toBe('published');
  });

  it('filters aggregate processing jobs by page view', () => {
    const jobs = [
      job('pending', 'PENDING'),
      job('progress', 'PROGRESS'),
      job('failed', 'FAILURE'),
      job('success', 'SUCCESS'),
      job('review', 'PENDING_REVIEW'),
    ];

    expect(visibleMyScoreJobs(jobs, 'processing').map((item) => item.job_id)).toEqual([
      'pending',
      'progress',
    ]);
    expect(visibleMyScoreJobs(jobs, 'failed').map((item) => item.job_id)).toEqual(['failed']);
    expect(visibleMyScoreJobs(jobs, 'all').map((item) => item.job_id)).toEqual([
      'pending',
      'progress',
      'failed',
    ]);
    expect(visibleMyScoreJobs(jobs, 'drafts')).toEqual([]);
    expect(visibleMyScoreJobs(jobs, 'private')).toEqual([]);
    expect(visibleMyScoreJobs(jobs, 'published')).toEqual([]);
  });

  it('counts aggregate jobs only where the UI shows them', () => {
    expect(myScoresTotal({
      showScores: true,
      scoreTotal: 10,
      view: 'all',
      visibleJobCount: 3,
    })).toBe(13);
    expect(myScoresTotal({
      showScores: true,
      scoreTotal: 10,
      view: 'private',
      visibleJobCount: 3,
    })).toBe(10);
    expect(myScoresTotal({
      showScores: false,
      scoreTotal: 10,
      view: 'failed',
      visibleJobCount: 3,
    })).toBe(3);
  });

  it('keeps bulk actions scoped to the relevant owner views', () => {
    expect(myScoresBulkVisibility('private')).toEqual({
      publish: true,
      unpublish: false,
    });
    expect(myScoresBulkVisibility('published')).toEqual({
      publish: false,
      unpublish: true,
    });
  });

  it('builds stable my-scores URLs and omits default params', () => {
    expect(buildMyScoresHref(
      { view: 'all', search: 'canon', sort: 'updated_desc' },
      { view: 'private', page: 2 }
    )).toBe('/my-scores?view=private&search=canon&page=2');
    expect(buildMyScoresHref(
      { view: 'private', search: 'canon', sort: 'updated_desc' },
      { search: null, sort: 'name_asc', page: 1 }
    )).toBe('/my-scores?view=private&sort=name_asc');
  });
});
