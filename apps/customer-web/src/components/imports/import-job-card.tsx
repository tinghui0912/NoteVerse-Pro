'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatApiDateTime } from '@/lib/date-time';
import { translateErrorCode } from '@/lib/i18n/error-message';
import type { ImportJobRead } from '@/generated/api';

export function ImportJobCard({
  job,
  retryPending,
  deletePending,
  onRetry,
  onDelete,
}: {
  job: ImportJobRead;
  retryPending: boolean;
  deletePending: boolean;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('imports');
  const errors = useTranslations('errors');
  const active = job.state === 'QUEUED' || job.state === 'PROCESSING';
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="font-semibold">{job.display_title || t('untitled')}</h3>
        <p>{t(`state.${job.state}`)}</p>
        {job.created_at ? (
          <p className="text-xs text-muted-foreground">
            {formatApiDateTime(job.created_at)}
          </p>
        ) : null}
        {active ? (
          <div>
            <Progress
              value={job.progress}
              aria-label={t('progress', { progress: job.progress })}
            />
            <p>{t('progress', { progress: job.progress })}</p>
          </div>
        ) : null}
        {job.state === 'FAILED' ? (
          <p className="text-sm text-destructive">
            {translateErrorCode(
              errors,
              job.public_code,
              t('failed'),
            )}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {job.state === 'READY_FOR_REVIEW' ? (
            <Button asChild>
              <Link href={`/review/${job.job_id}`}>{t('review')}</Link>
            </Button>
          ) : null}
          {job.state === 'FAILED' ? (
            <Button disabled={retryPending} onClick={onRetry}>
              {t('retry')}
            </Button>
          ) : null}
          {job.state === 'FAILED' || job.state === 'READY_FOR_REVIEW' ? (
            <Button
              variant="outline"
              disabled={deletePending}
              onClick={onDelete}
            >
              {t('deleteImport')}
            </Button>
          ) : null}
          {job.state === 'CONFIRMED' && job.score_id ? (
            <Button asChild>
              <Link href={`/score/${job.score_id}`}>{t('openScore')}</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
