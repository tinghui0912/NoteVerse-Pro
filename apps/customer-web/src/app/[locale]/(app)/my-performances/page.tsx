'use client';

import React, { useState } from 'react';
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
  usePerformanceTakes,
} from '@/hooks/queries/use-performance-take-queries';
import { useScoreDetail } from '@/hooks/queries/use-score-queries';
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

  // Score details query - handles gracefully if score is deleted
  const scoreQuery = useScoreDetail(String(take.score_id), Boolean(take.score_id));
  const scoreTitle =
    take.score_title ||
    scoreQuery.data?.data?.title ||
    (take.score_id ? t('scoreFallback', { id: take.score_id }) : t('deletedScoreNotice'));

  // Playback URL query - only active when playing this card
  const playbackQuery = usePerformanceTakePlayback(take.take_id, isPlaying);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const res = await performanceTakesApi.getPlaybackUrl(take.take_id);
      const downloadUrl = res.data?.download_url ?? res.data?.playback_url;
      if (downloadUrl) {
        const a = document.createElement('a');
        a.href = downloadUrl;
        const ext = take.media_mime_type.includes('mp4') ? 'mp4' : 'webm';
        a.download = `performance-${take.take_id}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      // ignore
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
    (take.scope_start_beat === 0 && take.scope_terminal_beat === 0) ||
    take.scope_terminal_beat <= take.scope_start_beat;

  const scopeLabel = isFullScope
    ? t('scopeFull')
    : `${t('scopeSection')} (${t('takeScopeBeats', { start: take.scope_start_beat, end: take.scope_terminal_beat })})`;

  const tempoBpm =
    (take.tempo_selection as { customBpm?: number; mode?: string } | null)?.customBpm ??
    (take.resolved_tempo_plan as { nominal_bpm?: number } | null)?.nominal_bpm ??
    null;

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
                {tempoBpm ? <span>♩ = {tempoBpm} BPM</span> : null}
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

          {isPlaying ? (
            <div className="mt-2 border-t border-gray-100 pt-3">
              {playbackQuery.isLoading ? (
                <div className="py-2 text-xs text-gray-500">{common('loading')}</div>
              ) : playbackQuery.isError ? (
                <div className="py-2 text-xs text-red-600">
                  {t('audioPlaybackFailed')}
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
  const [limit, setLimit] = useState(50);
  const takesQuery = usePerformanceTakes({ limit, offset: 0 });
  const deleteTake = useDeletePerformanceTake();

  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const [takePendingDelete, setTakePendingDelete] = useState<PerformanceTakeRead | null>(null);

  const takes = takesQuery.data?.data?.items ?? [];
  const total = takesQuery.data?.data?.total ?? 0;
  const hasMore = takes.length < total;

  const handleLoadMore = () => {
    setLimit((prev) => prev + 50);
  };

  const handleDeleteConfirm = async () => {
    if (!takePendingDelete) return;
    try {
      await deleteTake.mutateAsync(takePendingDelete.take_id);
      if (activeTakeId === takePendingDelete.take_id) {
        setActiveTakeId(null);
      }
    } finally {
      setTakePendingDelete(null);
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
              onDelete={() => setTakePendingDelete(take)}
            />
          ))}

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={takesQuery.isFetching}
                data-testid="load-more-takes"
              >
                {takesQuery.isFetching ? common('loading') : t('loadMore')}
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
          if (!open) setTakePendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deletePerformanceTakeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deletePerformanceTakeConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{common('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {common('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
