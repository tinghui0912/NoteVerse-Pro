'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock, Music2, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { practiceApi } from '@/lib/api';
import { formatApiDateTime } from '@/lib/date-time';
import { queryKeys } from '@/lib/query-client';
import type { SavedPracticePerformanceRead } from '@/generated/practice-api';

interface ScoreSavedPerformancesPanelProps {
  scoreId: string;
}

type ScoreTranslation = ReturnType<typeof useTranslations>;

function inputSourceLabel(item: SavedPracticePerformanceRead, t: ScoreTranslation) {
  return item.input_source === 'MIDI'
    ? t('savedPerformancesInputMidi')
    : t('savedPerformancesInputMicrophone');
}

function scopeLabel(item: SavedPracticePerformanceRead, t: ScoreTranslation) {
  const scope = item.practice_scope;
  if (!scope) {
    return t('savedPerformancesFullPiece');
  }
  const start = scope.start_measure_number;
  const end = scope.end_measure_number;
  if (start && end && start !== end) {
    return t('savedPerformancesMeasureRange', { start, end });
  }
  const measure = start ?? end;
  if (measure) {
    return t('savedPerformancesSingleMeasure', { measure });
  }
  return t('savedPerformancesSelectedRange');
}

function durationLabel(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
    : `${remainingSeconds}s`;
}

export function ScoreSavedPerformancesPanel({ scoreId }: ScoreSavedPerformancesPanelProps) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<SavedPracticePerformanceRead | null>(null);
  const savedPerformancesQuery = useQuery({
    queryKey: queryKeys.practice.savedPerformances(scoreId),
    queryFn: ({ signal }) => practiceApi.listSavedPracticePerformances(scoreId, signal),
    enabled: Boolean(scoreId),
  });
  const savedPerformances = savedPerformancesQuery.data?.data ?? [];
  const deleteSavedPerformance = useMutation({
    mutationFn: (item: SavedPracticePerformanceRead) =>
      practiceApi.deletePracticeReplayArtifact(item.session_id, item.artifact_id),
    onSuccess: async () => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.practice.savedPerformances(scoreId),
      });
      toast({
        title: t('savedPerformanceDeleted'),
        description: t('savedPerformanceDeletedDesc'),
      });
    },
    onError: () => {
      toast({
        title: t('savedPerformanceDeleteFailed'),
        description: t('savedPerformanceDeleteFailedDesc'),
        variant: 'destructive',
      });
    },
  });

  return (
    <>
      <Card className="rounded-2xl bg-white shadow-sm" data-testid="score-saved-performances-panel">
        <CardHeader>
          <CardTitle>{t('savedPerformances')}</CardTitle>
        </CardHeader>
        <CardContent>
          {savedPerformancesQuery.isLoading ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {common('loading')}
            </div>
          ) : savedPerformancesQuery.isError ? (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-4 text-sm text-red-700">
              {t('savedPerformancesLoadFailed')}
            </div>
          ) : savedPerformances.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center">
              <Music2 className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-slate-900">
                {t('savedPerformancesEmptyTitle')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('savedPerformancesEmptyDesc')}
              </p>
            </div>
          ) : (
            <div className="divide-y rounded-xl border">
              {savedPerformances.map((item) => (
                <article
                  key={item.artifact_id}
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <span>{scopeLabel(item, t)}</span>
                      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                        {inputSourceLabel(item, t)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span>{formatApiDateTime(item.saved_at)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {durationLabel(item.replay_duration_ms)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild variant="outline">
                      <Link
                        href={`/${locale}/score/${scoreId}/practice/summary?sessionId=${encodeURIComponent(item.session_id)}`}
                      >
                        {t('viewSavedPerformance')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-red-700 hover:bg-red-50 hover:text-red-800"
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('deleteSavedPerformance')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSavedPerformance.isPending) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteSavedPerformanceTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteSavedPerformanceDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSavedPerformance.isPending}>
              {common('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteSavedPerformance.isPending || deleteTarget === null}
              onClick={() => {
                if (deleteTarget) {
                  deleteSavedPerformance.mutate(deleteTarget);
                }
              }}
            >
              {t('deleteSavedPerformance')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
