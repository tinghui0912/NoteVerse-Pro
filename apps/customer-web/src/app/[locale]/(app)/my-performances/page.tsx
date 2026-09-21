'use client';

import React, { useMemo, useState } from 'react';
import { Calendar, Clock, Download, Music, Play, Radio, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
import {
  useDeletePerformanceTake,
  usePerformanceTakePlayback,
  useInfinitePerformanceTakes,
} from '@/hooks/queries/use-performance-take-queries';
import { PerformanceReplayPlayer } from '@/components/practice/performance-replay-player';
import { performanceTakesApi, type PerformanceTakeRead } from '@/lib/api/performance-takes';
import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';

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
  t: (key: string, values?: Record<string, string | number>) => string
): string | null {
  const selection = take.tempo_selection as {
    mode?: string;
    bpm?: number;
    customBpm?: number;
  } | null;
  const mode = selection?.mode?.toUpperCase();

  if (mode === 'CUSTOM_FIXED_BPM' || mode === 'CUSTOM') {
    const bpm = selection?.bpm ?? selection?.customBpm;
    if (bpm) {
      return `♩ = ${bpm} BPM`;
    }
  }

  const plan = take.resolved_tempo_plan as {
    segments?: Array<{ startBeat?: number; bpm?: number }>;
    nominal_bpm?: number;
  } | null;

  if (plan?.segments && plan.segments.length > 0) {
    const uniqueBpms = Array.from(
      new Set(plan.segments.map((s) => s.bpm).filter((b): b is number => typeof b === 'number'))
    );
    if (uniqueBpms.length === 1) {
      return t('tempoScoreModeWithBpm', { bpm: uniqueBpms[0] });
    }
    if (uniqueBpms.length > 1) {
      return t('tempoScoreModeVariable');
    }
  }

  if (plan?.nominal_bpm) {
    return t('tempoScoreModeWithBpm', { bpm: plan.nominal_bpm });
  }

  if (mode === 'SCORE') {
    return t('tempoScoreMode');
  }

  return null;
}

interface PerformanceTakeCardProps {
  take: PerformanceTakeRead;
  isPlaying: boolean;
  onPlay: () => void;
  onDelete: () => void;
}

function PerformanceTakeCard({
  take,
  isPlaying,
  onPlay,
  onDelete,
}: PerformanceTakeCardProps) {
  const t = useTranslations('practice');
  const common = useTranslations('common');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const scoreTitle = take.score_id
    ? take.score_title || t('scoreFallback', { id: take.score_id })
    : take.score_title || t('deletedScoreNotice');

  // Playback URL query - only active when playing this card
  const playbackQuery = usePerformanceTakePlayback(take.take_id, isPlaying);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setDownloadError(null);
      const res = await performanceTakesApi.getPlaybackUrl(take.take_id);
      const downloadUrl = res.data?.download_url;
      if (!downloadUrl) {
        throw new Error('Missing download_url');
      }
      const a = document.createElement('a');
      a.href = downloadUrl;
      const ext = take.media_mime_type.includes('mp4') ? 'mp4' : 'webm';
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

  const replay: PlayablePerformanceReplay | null = playbackQuery.data?.data
    ? {
        kind: 'AUDIO_RECORDING',
        url: playbackQuery.data.data.playback_url,
        durationMs: take.duration_ms,
        contentType: take.media_mime_type,
      }
    : null;

  const isFullScope =
    take.scope_type === 'FULL' ||
    (!take.scope_type &&
      ((take.scope_start_beat === 0 && take.scope_terminal_beat === 0) ||
        take.scope_terminal_beat <= take.scope_start_beat));

  const scopeLabel = isFullScope
    ? t('scopeFull')
    : `${t('scopeSection')} (${t('takeScopeBeats', {
        start: take.scope_start_beat,
        end: take.scope_terminal_beat,
      })})`;

  const tempoLabel = getTempoLabel(take, t);

  return (
    <Card className="overflow-hidden border border-gray-200 transition-all hover:border-gray-300">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Music className="h-4 w-4 text-orange-600 shrink-0" />
                {take.score_id ? (
                  <Link
                    href={`/score/${take.score_id}`}
                    className="font-medium text-gray-900 hover:text-orange-600 hover:underline truncate"
                    data-testid={`take-score-link-${take.take_id}`}
                  >
                    {scoreTitle}
                  </Link>
                ) : (
                  <span
                    className="font-medium text-gray-500 truncate"
                    data-testid={`take-deleted-score-${take.take_id}`}
                  >
                    {scoreTitle}
                  </span>
                )}
                <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                  {t('performanceInput')}: {t('inputSourceMic')}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(take.created_at)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDuration(take.duration_ms)}
                </span>
                <span>{scopeLabel}</span>
                {tempoLabel ? <span>{tempoLabel}</span> : null}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!isPlaying ? (
                <Button variant="outline" size="sm" onClick={onPlay} data-testid={`play-take-${take.take_id}`}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  {common('play')}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={downloading}
                data-testid={`download-take-${take.take_id}`}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {t('downloadRecording')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={onDelete}
                data-testid={`delete-take-${take.take_id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">{t('deletePerformanceTake')}</span>
              </Button>
            </div>
          </div>

          {downloadError ? (
            <div
              className="flex items-center gap-2 text-xs text-red-600"
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
                <div className="py-2 text-xs text-gray-500">{common('loading')}</div>
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
              ) : replay ? (
                <PerformanceReplayPlayer
                  replay={replay}
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

export default function MyPerformancesPage() {
  const t = useTranslations('practice');
  const common = useTranslations('common');
  const takesQuery = useInfinitePerformanceTakes();
  const deleteTake = useDeletePerformanceTake();

  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const [takePendingDelete, setTakePendingDelete] = useState<PerformanceTakeRead | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const takes = useMemo(() => {
    const map = new Map<string, PerformanceTakeRead>();
    if (takesQuery.data?.pages) {
      for (const page of takesQuery.data.pages) {
        if (page.data?.items) {
          for (const item of page.data.items) {
            if (!map.has(item.take_id)) {
              map.set(item.take_id, item);
            }
          }
        }
      }
    }
    return Array.from(map.values());
  }, [takesQuery.data]);

  const total = takesQuery.data?.pages?.[0]?.data?.total ?? 0;
  const hasMore = Boolean(takesQuery.hasNextPage);

  const handleDeleteConfirm = async () => {
    if (!takePendingDelete) return;
    setDeleteError(null);
    try {
      await deleteTake.mutateAsync(takePendingDelete.take_id);
      if (activeTakeId === takePendingDelete.take_id) {
        setActiveTakeId(null);
      }
      setTakePendingDelete(null);
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
              onPlay={() => setActiveTakeId(take.take_id)}
              onDelete={() => {
                setDeleteError(null);
                setTakePendingDelete(take);
              }}
            />
          ))}

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => takesQuery.fetchNextPage()}
                disabled={takesQuery.isFetchingNextPage}
                data-testid="load-more-takes"
              >
                {takesQuery.isFetchingNextPage ? common('loading') : t('loadMore')}
              </Button>
            </div>
          ) : total > 50 ? (
            <div className="py-4 text-center text-xs text-gray-400">
              {t('noMorePerformances')}
            </div>
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
            <AlertDialogTitle>{t('deletePerformanceTakeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deletePerformanceTakeConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600" data-testid="delete-take-error">
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
