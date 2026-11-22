import { describe, expect, it } from 'vitest';
import type { ImportJobRead } from '@/generated/api';
import { importJobDestination, type ImportJobDestination } from './navigation';

type Case = {
  state: ImportJobRead['state'];
  score_id?: string | null;
  expected: ImportJobDestination | null;
};

const cases: Case[] = [
  { state: 'QUEUED', score_id: 'score', expected: null },
  { state: 'PROCESSING', score_id: 'score', expected: null },
  { state: 'FAILED', score_id: 'score', expected: null },
  { state: 'READY_FOR_REVIEW', score_id: null, expected: { kind: 'review', href: '/review/job' } },
  { state: 'CONFIRMED', score_id: 'score', expected: { kind: 'score', href: '/score/score' } },
  { state: 'CONFIRMED', score_id: null, expected: null },
  { state: 'CONFIRMED', expected: null },
];

describe('Import navigation destinations', () => {
  it.each(cases)('$state / $score_id resolves to $expected', ({ expected, ...facts }) => {
    expect(importJobDestination({ job_id: 'job', ...facts })).toEqual(expected);
  });
});
