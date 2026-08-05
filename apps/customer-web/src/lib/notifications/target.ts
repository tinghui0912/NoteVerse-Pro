import type { NotificationEvent } from '@/types/api';

function stringData(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function notificationHref(notification: NotificationEvent): string | null {
  if (notification.type === 'import.failed') {
    const jobId = stringData(notification.data.job_id);
    return jobId ? `/upload?job_id=${encodeURIComponent(jobId)}` : null;
  }

  if (notification.type === 'import.completed') {
    const scoreId = stringData(notification.data.score_id) ?? notification.score_id;
    if (scoreId) return `/score/${encodeURIComponent(scoreId)}`;

    const jobId = stringData(notification.data.job_id);
    return jobId ? `/review/${encodeURIComponent(jobId)}` : null;
  }

  if (notification.score_id) {
    return `/score/${notification.score_id}`;
  }

  return null;
}
