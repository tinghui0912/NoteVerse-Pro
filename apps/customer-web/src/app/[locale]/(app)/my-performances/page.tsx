'use client';
import { microsecondsToMilliseconds } from '@/lib/practice/recording/recording-timebase';

import { recordingMediaExtension } from '@/lib/practice/recording/media-admission';

import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Download,
  Music,
  Play,
  Radio,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/routing';

import { PageHeader } from '@/components/page';
import { SectionLoading } from '@/components/loading';
import { EmptyState, SectionErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PaginationControls } from '@/components/ui/pagination-controls';
import {
  useDeletePerformanceTake,
  usePerformanceTakePlayback,
  usePerformanceTakes,
} from '@/hooks/queries/use-performance-take-queries';
import { RecordingPlaybackPlayer } from '@/components/practice/recording-playback-player';
import {
  performanceTakesApi,
  type PerformanceTakeRead,
} from '@/lib/api/performance-takes';
import type { RecordingPlaybackSource } from '@/lib/practice/recording/recording-playback';
import { isPerformanceTakeCompositeVideoCandidate } from '@/lib/practice/performance-take/admission';
import { useToast } from '@/hooks/use-toast';

function normalizePage(value?: string | number): number {
  const page = Math.floor(Number(value ?? 1));
  return Number.isFinite(page) ? Math.max(1, page) : 1;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  return `0:${String(seconds).padStart(2, '0')}`;
}

function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

function getTempoLabel(
  take: PerformanceTakeRead,
  t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
  const plan = take.manifest.tempo_plan;
  const selection = plan?.selection;
  const mode = selection?.mode?.toUpperCase();

  if (mode === 'CUSTOM_FIXED_BPM') {
    const bpm = 'bpm' in selection ? selection.bpm : undefined;
    if (typeof bpm === 'number') {
      return `♩ = ${bpm} BPM`;
    }
  }

  if (plan?.segments && plan.segments.length > 0) {
    const uniqueBpms = Array.from(
      new Set(
        plan.segments
          .map((s) => s.bpm)
          .filter((b): b is number => typeof b === 'number'),
      ),
    );
    if (uniqueBpms.length === 1) {
      return t('tempoScoreModeWithBpm', { bpm: uniqueBpms[0] });
    }
    if (uniqueBpms.length > 1) {
      return t('tempoScoreModeVariable');
    }
  }

  if (mode === 'SCORE') {
    return t('tempoScoreMode');
  }

  return null;
}

interface PerformanceTakeCardProps {
  take: PerformanceTakeRead;
  isPlaying: boolean;
  isDeletePending?: boolean;
  onPlay: () => void;
  onDelete: () => void;
}

function PerformanceTakeCard({
  take,
  isPlaying,
  isDeletePending = false,
  onPlay,
  onDelete,
}: PerformanceTakeCardProps) {
  const t = useTranslations('practice');
  const common = useTranslations('common');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const scoreDisplayTitle = take.manifest.score_display_title_snapshot;
  const scoreDisplayTitleNode =
    take.can_open_score && take.linked_score_id ? (
      <Link
        href={`/score/${take.linked_score_id}`}
        className="truncate font-semibold text-gray-900 transition-colors hover:text-primary hover:underline"
      >
        {scoreDisplayTitle}
      </Link>
    ) : (
      <span className="truncate font-semibold text-gray-900">{scoreDisplayTitle}</span>
    );

  // Playback URL query - only active when playing this card and not being deleted.
  const playbackQuery = usePerformanceTakePlayback(
    take.take_id,
    isPlaying && !isDeletePending,
  );

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setDownloadError(null);
      const res = await performanceTakesApi.getPlaybackUrl(take.take_id);
      const downloadUrl = res?.download_url;
      if (!downloadUrl) {
        throw new Error('Missing download_url');
      }
      const a = document.createElement('a');
      a.href = downloadUrl;
      const ext = recordingMediaExtension(take.recording_media.mime_type);
      a.download = `performance-${take.take_id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      setDownloadError(t('downloadFailedRetry'));
    } finally {
      setDownloading(false);
    }
  };

  const playbackSource: RecordingPlaybackSource | null = playbackQuery.data
    ? take.manifest.capture.kind === 'VIDEO'
      ? {
          kind: 'VIDEO',
          url: playbackQuery.data.playback_url,
        }
      : {
          kind: 'AUDIO',
          url: playbackQuery.data.playback_url,
        }
    : null;

  const scopeLabel =
    take.manifest.scope.kind === 'FULL'
      ? t('scopeFull')
      : take.manifest.scope.kind === 'RANGE'
        ? t('scopeSection')
        : t('scopeUnavailable');

  const tempoLabel = getTempoLabel(take, t);

  return (
    <Card className="overflow-hidden border border-gray-200 transition-all hover:border-gray-300">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Music className="h-5 w-5 flex-shrink-0 text-primary" />
                {scoreDisplayTitleNode}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(take.created_at)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDuration(
                    microsecondsToMilliseconds(
                      take.manifest.recording_timebase.nominalMediaDurationUs,
                    ),
                  )}
                </span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
                  {take.recording_media.mime_type
                    .split('/')[1]
                    ?.toUpperCase() || 'AUDIO'}
                </span>
                <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
                  {scopeLabel}
                </span>
                {tempoLabel ? (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                    {tempoLabel}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={isPlaying ? 'secondary' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={onPlay}
                disabled={isDeletePending}
                data-testid={`play-take-${take.take_id}`}
              >
                <Play className="h-4 w-4" />
                {isPlaying ? common('playing') : common('play')}
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleDownload}
                disabled={downloading || isDeletePending}
                data-testid={`download-take-${take.take_id}`}
              >
                <Download className="h-4 w-4" />
                {downloading
                  ? common('downloading')
                  : take.manifest.capture.kind === 'VIDEO'
                    ? t('downloadVideo')
                    : t('downloadRecording')}
              </Button>

              {isPerformanceTakeCompositeVideoCandidate(take) ? (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link
                    href={`/my-performances/${take.take_id}/score-video`}
                    data-testid={`composite-video-take-${take.take_id}`}
                  >
                    {t('compositeVideoOpenAction')}
                  </Link>
                </Button>
              ) : null}

              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={onDelete}
                disabled={isDeletePending}
                data-testid={`delete-take-${take.take_id}`}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">{t('deletePerformanceTake')}</span>
              </Button>
            </div>
          </div>

          {downloadError ? (
            <div
              className="flex items-center justify-between rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700"
              data-testid={`download-error-${take.take_id}`}
            >
              <span>{downloadError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-red-700 underline"
                onClick={handleDownload}
                data-testid={`retry-download-${take.take_id}`}
              >
                {common('tryAgain')}
              </Button>
            </div>
          ) : null}

          {isPlaying ? (
            <div className="mt-2 border-t border-gray-100 pt-3">
              {playbackQuery.isLoading ? (
                <div className="py-2 text-xs text-gray-500">
                  {common('loading')}
                </div>
              ) : playbackQuery.isError ? (
                <div className="flex items-center gap-2 py-2 text-xs text-red-600">
                  <span>{t('audioPlaybackFailed')}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-red-700 underline"
                    onClick={() => playbackQuery.refetch()}
                    data-testid={`retry-playback-${take.take_id}`}
                  >
                    {common('tryAgain')}
                  </Button>
                </div>
              ) : playbackSource ? (
                <RecordingPlaybackPlayer
                  source={playbackSource}
                  autoStart={true}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyPerformancesPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const synchronousPageParam = readSynchronousPageParam(searchParams);
  const resolvedParams =
    synchronousPageParam !== undefined
      ? { page: synchronousPageParam }
      : searchParams
        ? React.use(searchParams)
        : undefined;
  return <MyPerformancesPageContent searchParams={resolvedParams} />;
}

function MyPerformancesPageContent({
  searchParams,
}: {
  searchParams?: { page?: string };
}) {
  const routerSearchParams = useSearchParams();
  const pageParam =
    searchParams?.page ?? routerSearchParams?.get('page') ?? undefined;
  const rawPage = normalizePage(pageParam);

  const t = useTranslations('practice');
  const common = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();

  const pageSize = 20;

  const takesQuery = usePerformanceTakes({
    limit: pageSize,
    offset: (rawPage - 1) * pageSize,
  });
  const deleteTake = useDeletePerformanceTake();

  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const [takePendingDelete, setTakePendingDelete] =
    useState<PerformanceTakeRead | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const total = takesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(rawPage, totalPages);
  const queryItems = takesQuery.data?.items;
  const takes = React.useMemo(() => queryItems ?? [], [queryItems]);
  const goToPage = React.useCallback(
    (nextPage: number) => {
      setActiveTakeId(null);
      const targetPage = Math.max(1, nextPage);
      const search =
        targetPage > 1 ? `?page=${targetPage}` : '/my-performances';
      router.push(search);
    },
    [router],
  );

  // If query succeeded and rawPage is beyond totalPages, normalize URL to totalPages
  React.useEffect(() => {
    if (takesQuery.isSuccess && rawPage > totalPages) {
      const targetPage = Math.max(1, totalPages);
      const search =
        targetPage > 1 ? `?page=${targetPage}` : '/my-performances';
      router.push(search);
    }
  }, [takesQuery.isSuccess, total, totalPages, rawPage, router]);

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const handleDeleteConfirm = async () => {
    if (!takePendingDelete) return;
    const takeId = takePendingDelete.take_id;
    setDeleteError(null);
    if (activeTakeId === takeId) {
      setActiveTakeId(null);
    }
    try {
      await deleteTake.mutateAsync(takeId);
      setActiveTakeId((current) => (current === takeId ? null : current));
      setTakePendingDelete(null);
      toast({
        title: t('deletePerformanceTakeSuccessTitle'),
        description: t('deletePerformanceTakeSuccessDesc'),
      });
    } catch {
      setDeleteError(t('deleteFailedRetry'));
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title={t('myPerformances')}
        description={t('noPerformancesDesc')}
      />

      {takesQuery.isLoading ? (
        <SectionLoading label={common('loading')} />
      ) : takesQuery.isError ? (
        <SectionErrorState
          description={common('loadFailedDescription')}
          retryLabel={common('tryAgain')}
          onRetry={() => takesQuery.refetch()}
        />
      ) : takes.length === 0 ? (
        <EmptyState
          icon={Radio}
          title={t('noPerformancesTitle')}
          description={t('noPerformancesDesc')}
          className="py-16"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {takes.map((take) => (
            <PerformanceTakeCard
              key={take.take_id}
              take={take}
              isPlaying={activeTakeId === take.take_id}
              isDeletePending={
                deleteTake.isPending &&
                takePendingDelete?.take_id === take.take_id
              }
              onPlay={() => {
                setActiveTakeId((current) =>
                  current === take.take_id ? null : take.take_id,
                );
              }}
              onDelete={() => {
                setDeleteError(null);
                setTakePendingDelete(take);
              }}
            />
          ))}

          {totalPages > 1 ? (
            <PaginationControls
              page={currentPage}
              totalPages={totalPages}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPageChange={goToPage}
              t={t}
            />
          ) : null}
        </div>
      )}

      <AlertDialog
        open={Boolean(takePendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteTake.isPending) {
            setTakePendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('deletePerformanceTakeConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('deletePerformanceTakeConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <div
              className="rounded-md bg-red-50 p-3 text-sm text-red-600"
              data-testid="delete-take-error"
            >
              {deleteError}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTake.isPending}>
              {common('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirm();
              }}
              disabled={deleteTake.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
              data-testid="confirm-delete-take-button"
            >
              {deleteTake.isPending ? common('loading') : common('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function readSynchronousPageParam(
  searchParams: Promise<{ page?: string }> | undefined,
): string | undefined {
  if (
    !searchParams ||
    typeof searchParams !== 'object' ||
    !('page' in searchParams)
  ) {
    return undefined;
  }
  const page = searchParams.page;
  return typeof page === 'string' ? page : undefined;
}
