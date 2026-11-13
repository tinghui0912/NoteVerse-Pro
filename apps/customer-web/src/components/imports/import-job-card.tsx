'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatApiDateTime } from '@/lib/date-time';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
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
  const active = job.state === 'PENDING' || job.state === 'RUNNING';
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="font-semibold">{job.title || t('untitled')}</h3>
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
        {job.state === 'FAILURE' ? (
          <p className="text-sm text-destructive">
            {userFacingErrorMessage(
              errors,
              { code: job.public_code, message: job.public_message },
              job.public_message || t('failed'),
            )}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {job.state === 'PENDING_REVIEW' ? (
            <Button asChild>
              <Link href={`/review/${job.job_id}`}>{t('review')}</Link>
            </Button>
          ) : null}
          {job.state === 'FAILURE' ? (
            <Button disabled={retryPending} onClick={onRetry}>
              {t('retry')}
            </Button>
          ) : null}
          {job.state === 'FAILURE' || job.state === 'PENDING_REVIEW' ? (
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
