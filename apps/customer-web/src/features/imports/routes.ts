import type { ImportJobRead } from '@/generated/api';

export function importActivityLocation() {
  return '/upload#import-activity' as const;
}

export function importReviewLocation(jobId: string): `/imports/${string}/review` {
  return `/imports/${encodeURIComponent(jobId)}/review`;
}

export function importReviewEditLocation(jobId: string): `/imports/${string}/review/edit` {
  return `/imports/${encodeURIComponent(jobId)}/review/edit`;
}

export function importConfirmedScoreLocation(scoreId: string): `/score/${string}` {
  return `/score/${encodeURIComponent(scoreId)}`;
}

export type ImportJobDestination =
  | { kind: 'review'; href: ReturnType<typeof importReviewLocation> }
  | { kind: 'score'; href: ReturnType<typeof importConfirmedScoreLocation> };

export function importJobDestination(
  job: Pick<ImportJobRead, 'job_id' | 'state' | 'score_id'>,
): ImportJobDestination | null {
  const state = job.state;
  switch (state) {
    case 'READY_FOR_REVIEW':
      return { kind: 'review', href: importReviewLocation(job.job_id) };
    case 'CONFIRMED':
      return job.score_id ? { kind: 'score', href: importConfirmedScoreLocation(job.score_id) } : null;
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
