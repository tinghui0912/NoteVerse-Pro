'use client';

import { CheckCircle2, CircleAlert, Loader2, MoreVertical, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { importJobsApi } from '@/lib/api';
import { formatApiDateTime } from '@/lib/date-time';
import { cn } from '@/lib/utils';
import { isImportJob } from '@/lib/my-scores/state';
import type { ImportJob } from '@/types/api';

function jobTitle(job: ImportJob) {
  return job.title || job.upload_ids?.[0]?.original_filename || job.job_id;
}

interface ImportJobCardProps {
  job: ImportJob;
  deletePending: boolean;
  batchMode: boolean;
  selected: boolean;
  onOpenScore: () => void;
  onToggleSelection: () => void;
  onDismiss: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function ImportJobCard({
  job,
  deletePending,
  batchMode,
  selected,
  onOpenScore,
  onToggleSelection,
  onDismiss,
  t,
}: ImportJobCardProps) {
  const importing = isImportJob(job);
  const selectable = job.state === 'FAILURE' || job.state === 'PENDING_REVIEW';
  const openable = selectable || job.state === 'PENDING_REVIEW';
  const [thumbnail, setThumbnail] = useState<{ artifactId: string; url: string } | null>(null);
  const thumbnailArtifactId = job.thumbnail_artifact_id ?? null;
  const thumbnailUrl =
    thumbnailArtifactId && thumbnail?.artifactId === thumbnailArtifactId
      ? thumbnail.url
      : null;

  useEffect(() => {
    if (!thumbnailArtifactId) return;
    let active = true;
    let objectUrl: string | null = null;
    void importJobsApi
      .downloadImportJobArtifact(job.job_id, thumbnailArtifactId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnail({ artifactId: thumbnailArtifactId, url: objectUrl });
      })
      .catch(() => {
        if (active) setThumbnail(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [job.job_id, thumbnailArtifactId]);

  return (
    <Card
      className={cn(
        'group rounded-2xl',
        !batchMode && openable && 'cursor-pointer',
        batchMode && selectable && 'cursor-pointer',
        selected && 'ring-2 ring-primary'
      )}
      onClick={() => {
        if (batchMode && selectable) {
          onToggleSelection();
          return;
        }
        if (!batchMode && openable) onOpenScore();
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
        <div className="relative mb-4 flex h-32 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={jobTitle(job)}
              className="h-full w-full object-contain p-2"
            />
          ) : importing ? (
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          ) : job.state === 'PENDING_REVIEW' ? (
            <CheckCircle2 className="h-10 w-10 text-orange-500" />
          ) : (
            <CircleAlert className="h-10 w-10 text-destructive" />
          )}
          {importing && thumbnailUrl ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : null}
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
        {importing ? (
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
        ) : null}
        {!batchMode && selectable ? (
        <div
          className="absolute bottom-4 right-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
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
              <DropdownMenuItem disabled={deletePending} onClick={onDismiss}>
                <Trash2 className="h-4 w-4" />
                {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
