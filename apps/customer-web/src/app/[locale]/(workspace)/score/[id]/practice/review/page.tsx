'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Gauge,
  HelpCircle,
  Mic,
  Music,
  Piano,
  Repeat,
  Target,
} from 'lucide-react';

import { PageHeader } from '@/components/page';
import { PreviewLoading } from '@/components/loading';
import { EmptyState } from '@/components/states/empty-state';
import { PerformanceReplayPlayer } from '@/components/practice/performance-replay-player';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useScoreDetail } from '@/hooks/queries/use-score-queries';
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { usePracticeScoreArtifact } from '@/hooks/practice/use-practice-score-artifact';
import {
  performanceReviewDraftStore,
  type PerformanceReviewDraft,
} from '@/lib/practice/performance-review-draft';
import { PerformancePlayheadController } from '@/lib/practice/performance-playhead-controller';
import { PracticeSummaryAnnotationController } from '@/lib/practice/summary-annotation-controller';
import { PracticeTempoTimeline } from '@/lib/practice/local-core/practice-tempo';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';

function scoreIdFromParams(params: ReturnType<typeof useParams>): string {
  const id = params?.id;
  return Array.isArray(id) ? id[0] ?? '' : id ?? '';
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function PracticeReviewPage({
  params: _paramsProp,
}: {
  params?: Promise<{ id: string }>;
} = {}) {
  const urlParams = useParams();
  const id = scoreIdFromParams(urlParams);
  const t = useTranslations('practice');
  const router = useRouter();

  const [draft, setDraft] = useState<PerformanceReviewDraft | null>(() =>
    performanceReviewDraftStore.getDraft()
  );

  useEffect(() => {
    return performanceReviewDraftStore.subscribe(setDraft);
  }, []);

  const isValidDraft = Boolean(draft && draft.scoreId === id);

  const scoreQuery = useScoreDetail(id);
  const selectedRevisionId =
    draft?.revisionId ?? scoreQuery.data?.data?.head_revision_id ?? undefined;

  const revisionQuery = usePracticeReadyScoreContent(
    id,
    selectedRevisionId,
    isValidDraft && Boolean(id)
  );
  const xmlContent = revisionQuery.data?.data?.content ?? null;
  const isLoadingXml = revisionQuery.isLoading;

  const artifactQuery = usePracticeScoreArtifact(
    id,
    selectedRevisionId,
    isValidDraft && Boolean(id)
  );
  const artifact = artifactQuery.data ?? null;

  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const playheadController = useMemo(() => new PerformancePlayheadController(), []);
  const annotationController = useMemo(() => new PracticeSummaryAnnotationController(), []);

  const scoreContainerRef = useRef<HTMLDivElement | null>(null);

  const confirmedCorrectNoteIds = useMemo(() => {
    if (!isValidDraft || !draft?.performanceSnapshot?.performance?.outcomes) return [];
    const outcomes = draft.performanceSnapshot.performance.outcomes;
    return outcomes
      .filter((o) => o.result === 'MATCH')
      .flatMap((o) =>
        (o.expectedStrikeOutcomes ?? [])
          .filter((s) => s.result === 'MATCHED')
          .flatMap((s) => s.renderNoteIds ?? [])
      );
  }, [isValidDraft, draft]);

  const confirmedErrorNoteIds = useMemo(() => {
    if (!isValidDraft || !draft?.performanceSnapshot?.performance?.outcomes) return [];
    const outcomes = draft.performanceSnapshot.performance.outcomes;
    return outcomes
      .filter((o) => o.result === 'MISMATCH')
      .flatMap((o) => o.renderNoteIds ?? []);
  }, [isValidDraft, draft]);

  const handleScoreRendered = useCallback(
    (_adapter: unknown, container: HTMLDivElement) => {
      scoreContainerRef.current = container;
      annotationController.apply(container, {
        confirmedCorrectNoteIds,
        confirmedErrorNoteIds,
      });
    },
    [annotationController, confirmedCorrectNoteIds, confirmedErrorNoteIds]
  );

  const handleReplayTimeChange = useCallback(
    (replayTimeMs: number | null) => {
      const container = scoreContainerRef.current;
      if (!container || !draft) return;
      if (replayTimeMs === null) {
        playheadController.clear(container);
        return;
      }
      const scoreEndBeat = artifact?.scoreEndBeat ?? draft.scope.terminalBeat;
      const timeline = new PracticeTempoTimeline(draft.tempoPlan, scoreEndBeat);
      const nominalTimeMs = draft.replayTiming.scopeStartMs + replayTimeMs;
      const musicalBeat = timeline.timeMsToBeat(nominalTimeMs);
      playheadController.apply(container, adapter, musicalBeat, {
        startBeat: draft.scope.startBeat,
        terminalBeat: draft.scope.terminalBeat,
      });
    },
    [adapter, artifact, draft, playheadController]
  );

  const replay = useMemo<PlayablePerformanceReplay | null>(() => {
    if (!draft || draft.audio.status !== 'READY') {
      return null;
    }
    return {
      kind: 'AUDIO_RECORDING',
      blob: draft.audio.blob,
      contentType: draft.audio.mimeType,
      byteSize: draft.audio.blob.size,
      durationMs: draft.audio.durationMs,
      timebase: { version: 1, speedRatio: 1 },
    };
  }, [draft]);

  const handleRestart = useCallback(() => {
    performanceReviewDraftStore.clearDraft();
    router.push(`/score/${id}/practice`);
  }, [id, router]);

  const handleBackToScore = useCallback(() => {
    performanceReviewDraftStore.clearDraft();
    router.push(`/score/${id}`);
  }, [id, router]);

  if (!isValidDraft || !draft) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center p-6 text-center">
        <EmptyState
          icon={AlertTriangle}
          title={t('reviewExpiredTitle')}
          description={t('reviewExpiredDesc')}
          action={
            <Button onClick={() => router.push(`/score/${id}/practice`)}>
              <Repeat className="mr-2 h-4 w-4" />
              {t('backToPractice')}
            </Button>
          }
        />
      </div>
    );
  }

  const outcomes = draft.performanceSnapshot.performance.outcomes ?? [];
  const matchedCount = outcomes.filter((o) => o.result === 'MATCH').length;
  const partialCount = outcomes.filter((o) => o.result === 'PARTIAL').length;
  const unobservedCount = outcomes.filter((o) => o.result === 'NOT_OBSERVED').length;
  const totalCount = outcomes.length;

  const tempoText =
    draft.tempoPlan.selection.mode === 'CUSTOM_FIXED_BPM'
      ? `${draft.tempoPlan.selection.bpm} BPM`
      : '原曲速度';

  const scopeText = draft.scope.startGroupId
    ? `${t('scopeSection')} (${draft.scope.startBeat} - ${draft.scope.terminalBeat} 拍)`
    : `${t('scopeFull')} (${draft.scope.startBeat} - ${draft.scope.terminalBeat} 拍)`;

  const inputSourceText =
    draft.performanceSnapshot.inputSource === 'MICROPHONE'
      ? t('inputSourceMic')
      : t('inputSourceMidi');

  return (
    <div className="container mx-auto max-w-7xl space-y-6 py-6 px-4 sm:px-6 lg:px-8">
      <style>{`
        .practice-summary-score-svg .practice-summary-note-confirmed-correct {
          fill: #16a34a !important;
          stroke: #15803d !important;
          opacity: 1 !important;
        }
        .practice-summary-score-svg .practice-summary-note-confirmed-error {
          fill: #dc2626 !important;
          stroke: #b91c1c !important;
          opacity: 1 !important;
        }
        .practice-summary-score-svg .practice-note-active {
          fill: #f97316 !important;
          stroke: #ea580c !important;
          stroke-width: 2px !important;
          opacity: 1 !important;
          filter: drop-shadow(0 0 6px rgba(249, 115, 22, 0.65));
        }
        .practice-summary-score-svg svg {
          display: block;
          width: 100% !important;
          height: auto;
        }
      `}</style>

      <PageHeader
        title={t('reviewTitle')}
        description={`完成时间：${new Date(draft.completedAt).toLocaleTimeString()}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleBackToScore}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t('backToScore')}
            </Button>
            <Button size="sm" onClick={handleRestart}>
              <Repeat className="mr-1.5 h-4 w-4" />
              {t('retryPractice')}
            </Button>
          </div>
        }
      />

      {/* Factual Performance Evidence Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('performanceDuration')}
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">
              {formatDuration(draft.performanceSnapshot.performance.activeElapsedMs)}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('performanceTempo')}
            </CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{tempoText}</div>
          </CardContent>
        </Card>

        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('performanceInput')}
            </CardTitle>
            {draft.performanceSnapshot.inputSource === 'MICROPHONE' ? (
              <Mic className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Piano className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{inputSourceText}</div>
          </CardContent>
        </Card>

        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('performanceScope')}
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-semibold truncate" title={scopeText}>
              {scopeText}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Note Match Outcomes Summary */}
      {totalCount > 0 && (
        <Card className="rounded-lg bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-500" />
              {t('performanceOutcomes')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-center">
              <div className="rounded-md border bg-slate-50 dark:bg-slate-900 p-3">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>{t('matchedGroupCount')}</span>
                </div>
                <div className="mt-1 text-lg font-bold text-green-600">
                  {matchedCount} / {totalCount}
                </div>
              </div>
              <div className="rounded-md border bg-slate-50 dark:bg-slate-900 p-3">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                  <span>{t('partialGroupCount')}</span>
                </div>
                <div className="mt-1 text-lg font-bold text-amber-600">
                  {partialCount}
                </div>
              </div>
              <div className="rounded-md border bg-slate-50 dark:bg-slate-900 p-3">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
                  <span>{t('unobservedGroupCount')}</span>
                </div>
                <div className="mt-1 text-lg font-bold text-slate-600">
                  {unobservedCount}
                </div>
              </div>
              <div className="rounded-md border bg-slate-50 dark:bg-slate-900 p-3">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <Music className="h-3.5 w-3.5 text-primary" />
                  <span>{t('totalGroupCount')}</span>
                </div>
                <div className="mt-1 text-lg font-bold">
                  {totalCount}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Synchronized Replay Player / Recording Status */}
      {replay ? (
        <Card className="rounded-lg bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Music className="h-4 w-4 text-orange-500" />
              {t('playback')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceReplayPlayer
              replay={replay}
              onReplayTimeChange={handleReplayTimeChange}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-semibold">{t('audioRecordingUnavailable')}</span>
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400 pl-6">
            {draft.audio.status === 'UNAVAILABLE' &&
            (draft.audio.reason === 'PERMISSION_DENIED' ||
              draft.audio.reason === 'NotAllowedError')
              ? t('audioRecordingUnavailableMicDenied')
              : t('audioRecordingUnavailableDesc')}
          </p>
        </div>
      )}

      {/* Sheet Music Viewer with Synchronized Cursor & Annotations */}
      <Card className="rounded-lg bg-card">
        <CardContent className="p-4">
          <VerovioScoreViewer
            xmlContent={xmlContent}
            isLoading={isLoadingXml}
            adapterFactory={adapterFactory}
            pageDataAttribute="data-practice-review-page"
            onRendered={handleScoreRendered}
            className="max-h-[46rem] overflow-auto rounded-md border border-border bg-white"
            pagesClassName="gap-4 p-4"
            pageClassName="w-full overflow-hidden bg-white"
            svgClassName="practice-summary-score-svg"
            loadingContent={
              <PreviewLoading label="正在加载乐谱..." className="min-h-80" />
            }
            emptyContent={
              <EmptyState title="乐谱未加载" className="min-h-80" />
            }
            renderError={(message) => (
              <div className="flex min-h-80 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {message}
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
