import type { ImportJobRead } from '@/generated/api';

export type ImportJobDestination =
  | { kind: 'review'; href: `/review/${string}` }
  | { kind: 'score'; href: `/score/${string}` };

export function importJobDestination(
  job: Pick<ImportJobRead, 'job_id' | 'state' | 'score_id'>,
): ImportJobDestination | null {
  const state = job.state;
  switch (state) {
    case 'READY_FOR_REVIEW':
      return { kind: 'review', href: `/review/${job.job_id}` };
    case 'CONFIRMED':
      return job.score_id ? { kind: 'score', href: `/score/${job.score_id}` } : null;
    case 'QUEUED':
    case 'PROCESSING':
    case 'FAILED':
      return null;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
