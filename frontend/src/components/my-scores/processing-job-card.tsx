'use client';

import { CircleAlert, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatApiDateTime } from '@/lib/score/metadata-display';
import { cn } from '@/lib/utils';
import type { ProcessingJob } from '@/types/api';

export function isProcessingJob(job: ProcessingJob) {
  return job.state === 'PENDING' || job.state === 'PROGRESS';
}

function jobTitle(job: ProcessingJob) {
  return job.title || job.upload_ids?.[0]?.original_filename || job.job_id;
}

interface ProcessingJobCardProps {
  job: ProcessingJob;
  deletePending: boolean;
  onOpenScore: () => void;
  onDismiss: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function ProcessingJobCard({
  job,
  deletePending,
  onOpenScore,
  onDismiss,
  t,
}: ProcessingJobCardProps) {
  const processing = isProcessingJob(job);

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-muted">
          {processing ? (
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          ) : (
            <CircleAlert className="h-10 w-10 text-destructive" />
          )}
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{jobTitle(job)}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {job.updated_at ? formatApiDateTime(job.updated_at) : job.job_id}
            </p>
          </div>
          <span
            className={cn(
              'rounded-full px-2 py-1 text-xs',
              job.state === 'FAILURE'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-amber-100 text-amber-700'
            )}
          >
            {t(`jobStatus.${job.state}`)}
          </span>
        </div>
        {processing ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('jobProgress', {
                progress: job.progress,
                step: job.current_step || t('jobStepPending'),
              })}
            </p>
          </div>
        ) : (
          <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">
            {job.error || t('jobFailedFallback')}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {job.score_id ? (
            <Button size="sm" onClick={onOpenScore}>
              {t('openScore')}
            </Button>
          ) : null}
          {job.state === 'FAILURE' ? (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href="/upload">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('uploadAgain')}
                </Link>
              </Button>
              <Button size="sm" variant="ghost" disabled={deletePending} onClick={onDismiss}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t('dismissJob')}
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
