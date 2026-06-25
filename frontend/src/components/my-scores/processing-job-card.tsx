'use client';

import { CircleAlert, Loader2, MoreVertical, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatApiDateTime } from '@/lib/score/metadata-display';
import { cn } from '@/lib/utils';
import { isProcessingJob } from '@/lib/my-scores/state';
import type { ProcessingJob } from '@/types/api';

function jobTitle(job: ProcessingJob) {
  return job.title || job.upload_ids?.[0]?.original_filename || job.job_id;
}

interface ProcessingJobCardProps {
  job: ProcessingJob;
  deletePending: boolean;
  retryPending: boolean;
  batchMode: boolean;
  selected: boolean;
  onOpenScore: () => void;
  onToggleSelection: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function ProcessingJobCard({
  job,
  deletePending,
  retryPending,
  batchMode,
  selected,
  onOpenScore,
  onToggleSelection,
  onRetry,
  onDismiss,
  t,
}: ProcessingJobCardProps) {
  const processing = isProcessingJob(job);
  const selectable = job.state === 'FAILURE';

  return (
    <Card
      className={cn(
        'group rounded-2xl',
        batchMode && selectable && 'cursor-pointer',
        selected && 'ring-2 ring-primary'
      )}
      onClick={() => {
        if (batchMode && selectable) onToggleSelection();
      }}
    >
      <CardContent className="relative p-5">
        {batchMode && selectable ? (
          <div
            className="absolute left-4 top-4 z-10 rounded-md bg-white/90 p-1 shadow-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelection}
              aria-label={t('selectJob', { title: jobTitle(job) })}
            />
          </div>
        ) : null}
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
        {!batchMode ? (
        <div className="absolute bottom-4 right-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t('moreActions')}
                className="h-9 w-9 rounded-full bg-white/95 shadow-md"
                size="icon"
                variant="ghost"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {job.score_id ? (
                <DropdownMenuItem onClick={onOpenScore}>
                  {t('openScore')}
                </DropdownMenuItem>
              ) : null}
              {job.state === 'FAILURE' ? (
                <>
                  <DropdownMenuItem disabled={retryPending} onClick={onRetry}>
                    <RefreshCw className="h-4 w-4" />
                    {t('retryJob')}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={deletePending} onClick={onDismiss}>
                    <Trash2 className="h-4 w-4" />
                    {t('dismissJob')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
