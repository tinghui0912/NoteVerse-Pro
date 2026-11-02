import { describe, expect, it } from 'vitest';
import {
  buildMyScoresHref,
  myScoresTotal,
  MY_SCORE_PAGE_VIEWS,
  normalizeMyScoresSort,
  normalizeMyScoresView,
  normalizePage,
  visibleMyScoreJobs,
} from '@/lib/my-scores/state';
import type { ImportJobRead } from '@/generated/api';

function job(jobId: string, state: ImportJobRead['state']): ImportJobRead {
  return {
    job_id: jobId,
    state,
    progress: state === 'CONFIRMED' ? 100 : 0,
  };
}

describe('my scores view helpers', () => {
  it('exposes owned scores and import workflow views', () => {
    expect(MY_SCORE_PAGE_VIEWS).toEqual([
      'all',
      'importing',
      'review',
      'failed',
    ]);
  });

  it('normalizes unknown views to all', () => {
    expect(normalizeMyScoresView('archived')).toBe('all');
    expect(normalizeMyScoresView('missing')).toBe('all');
    expect(normalizeMyScoresView(undefined)).toBe('all');
  });

  it('normalizes sort and page', () => {
    expect(normalizeMyScoresSort('name_asc')).toBe('name_asc');
    expect(normalizeMyScoresSort('updated_asc')).toBe('updated_desc');
    expect(normalizePage('3')).toBe(3);
    expect(normalizePage('-4')).toBe(1);
    expect(normalizePage('not-a-number')).toBe(1);
  });

  it('filters aggregate import jobs by page view', () => {
    const jobs = [
      job('pending', 'PENDING'),
      job('running', 'RUNNING'),
      job('failed', 'FAILURE'),
      job('confirmed', 'CONFIRMED'),
      job('review', 'PENDING_REVIEW'),
    ];

    expect(visibleMyScoreJobs(jobs, 'importing').map((item) => item.job_id)).toEqual([
      'pending',
      'running',
    ]);
    expect(visibleMyScoreJobs(jobs, 'failed').map((item) => item.job_id)).toEqual(['failed']);
    expect(visibleMyScoreJobs(jobs, 'review').map((item) => item.job_id)).toEqual(['review']);
    expect(visibleMyScoreJobs(jobs, 'all').map((item) => item.job_id)).toEqual([
      'pending',
      'running',
      'failed',
      'review',
    ]);
  });

  it.each([['all', 13], ['importing', 3], ['review', 3], ['failed', 3]] as const)('counts visible scores and jobs in %s', (view, expected) => {
    expect(myScoresTotal({ scoreTotal: 10, view, visibleJobCount: 3 })).toBe(expected);
  });

  it('builds stable my-scores URLs and omits default params', () => {
    expect(buildMyScoresHref(
      { view: 'all', search: 'canon', sort: 'updated_desc' },
      { view: 'review', page: 2 }
    )).toBe('/my-scores?view=review&search=canon&page=2');
    expect(buildMyScoresHref(
      { view: 'review', search: 'canon', sort: 'updated_desc' },
      { search: null, sort: 'name_asc', page: 1 }
    )).toBe('/my-scores?view=review&sort=name_asc');
  });
});
