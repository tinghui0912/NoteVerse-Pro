'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Clock,
  Clapperboard,
  Download,
  Gauge,
  HelpCircle,
  Loader2,
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
import { useSavePerformanceTake } from '@/hooks/queries/use-performance-take-queries';
import {
  performanceReviewDraftStore,
  type PerformanceReviewDraft,
  mediaTimeToPerformanceTimeMs,
} from '@/lib/practice/performance-review-draft';
import { PerformancePlayheadController } from '@/lib/practice/performance-playhead-controller';
import { PracticeSummaryAnnotationController } from '@/lib/practice/summary-annotation-controller';
import { PracticeTempoTimeline } from '@/lib/practice/local-core/practice-tempo';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';
import {
  exportSplitScreenPerformanceVideo,
  getSplitScreenExportReadiness,
  type SplitScreenExportBlockReason,
} from '@/lib/practice/split-screen-video-export';

const MAX_TAKE_MEDIA_BYTES = 100 * 1024 * 1024;

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

function extensionForMime(mimeType: string): string {
  const cleaned = mimeType.split(';')[0]?.trim().toLowerCase();
  if (cleaned === 'video/mp4' || cleaned === 'audio/mp4') return 'mp4';
  if (cleaned === 'audio/ogg') return 'ogg';
  if (cleaned === 'audio/wav' || cleaned === 'audio/x-wav') return 'wav';
  return 'webm';
}

function splitScreenBlockReasonToMessage(
  t: (key: string) => string,
  reason: SplitScreenExportBlockReason
) {
  switch (reason) {
    case 'video_not_ready':
    case 'empty_video':
      return t('exportScoreVideoUnavailableVideo');
    case 'score_identity_mismatch':
      return t('exportScoreVideoUnavailableScoreMismatch');
    case 'score_not_ready':
      return t('exportScoreVideoUnavailableScore');
    case 'timebase_unavailable':
      return t('exportScoreVideoUnavailableSync');
    case 'media_recorder_unsupported':
    case 'canvas_capture_unsupported':
      return t('exportScoreVideoUnsupportedBrowser');
  }
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

  const scoreQuery = useScoreDetail(id, isValidDraft && Boolean(id));
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

  const isRevisionMismatched = useMemo(() => {
    if (!isValidDraft || !draft || !artifact) return false;
    if (artifact.artifactId !== draft.artifactId) return true;
    if (draft.revisionId && artifact.revisionId && draft.revisionId !== artifact.revisionId) {
      return true;
    }
    return false;
  }, [artifact, draft, isValidDraft]);

  const isScoreIdentityConfirmed = useMemo(() => {
    if (!isValidDraft || !draft || !artifact || !xmlContent || isRevisionMismatched) {
      return false;
    }
    return (
      artifact.artifactId === draft.artifactId &&
      (!draft.revisionId || !artifact.revisionId || draft.revisionId === artifact.revisionId)
    );
  }, [artifact, draft, isRevisionMismatched, isValidDraft, xmlContent]);

  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const playheadController = useMemo(() => new PerformancePlayheadController(), []);
  const annotationController = useMemo(() => new PracticeSummaryAnnotationController(), []);

  const scoreContainerRef = useRef<HTMLDivElement | null>(null);
  const [scoreContainer, setScoreContainer] = useState<HTMLDivElement | null>(null);

  const confirmedCorrectNoteIds = useMemo(() => {
    if (!isScoreIdentityConfirmed || !draft?.performanceSnapshot?.performance?.outcomes) {
      return [];
    }
    const outcomes = draft.performanceSnapshot.performance.outcomes;
    const ids: string[] = [];
    for (const o of outcomes) {
      if (o.expectedStrikeOutcomes && o.expectedStrikeOutcomes.length > 0) {
        for (const s of o.expectedStrikeOutcomes) {
          if (s.result === 'MATCHED' && s.renderNoteIds) {
            ids.push(...s.renderNoteIds);
          }
        }
      } else if (o.result === 'MATCH' && o.renderNoteIds) {
        ids.push(...o.renderNoteIds);
      }
    }
    return ids;
  }, [draft, isScoreIdentityConfirmed]);

  const confirmedErrorNoteIds = useMemo(() => {
    if (!isScoreIdentityConfirmed || !draft?.performanceSnapshot?.performance?.outcomes) {
      return [];
    }
    const outcomes = draft.performanceSnapshot.performance.outcomes;
    const ids: string[] = [];
    for (const o of outcomes) {
      if (o.expectedStrikeOutcomes && o.expectedStrikeOutcomes.length > 0) {
        for (const s of o.expectedStrikeOutcomes) {
          if (s.result === 'MISSING' && s.renderNoteIds) {
            ids.push(...s.renderNoteIds);
          }
        }
      } else if (o.result === 'MISMATCH' && o.renderNoteIds) {
        ids.push(...o.renderNoteIds);
      }
    }
    return ids;
  }, [draft, isScoreIdentityConfirmed]);

  const handleScoreRendered = useCallback(
    (_adapter: unknown, container: HTMLDivElement) => {
      const isNewContainer = scoreContainerRef.current !== container;
      scoreContainerRef.current = container;
      if (isNewContainer) {
        setScoreContainer(container);
      }
      if (!isScoreIdentityConfirmed) {
        annotationController.apply(container, {
          confirmedCorrectNoteIds: [],
          confirmedErrorNoteIds: [],
        });
        return;
      }
      annotationController.apply(container, {
        confirmedCorrectNoteIds,
        confirmedErrorNoteIds,
      });
    },
    [annotationController, confirmedCorrectNoteIds, confirmedErrorNoteIds, isScoreIdentityConfirmed]
  );

  const handleReplayTimeChange = useCallback(
    (replayTimeMs: number | null, actualMediaDurationMs?: number | null) => {
      const container = scoreContainerRef.current;
      if (!container || !draft) return;
      if (replayTimeMs === null || !isScoreIdentityConfirmed) {
        playheadController.clear(container);
        return;
      }
      const perfTimeMs = mediaTimeToPerformanceTimeMs(
        replayTimeMs,
        draft.recordingTimebase,
        actualMediaDurationMs
      );
      if (perfTimeMs === null) {
        playheadController.clear(container);
        return;
      }
      const scoreEndBeat = artifact?.scoreEndBeat ?? draft.scope.terminalBeat;
      const timeline = new PracticeTempoTimeline(draft.tempoPlan, scoreEndBeat);
      const scopeStartMs = draft.replayTiming?.scopeStartMs ?? 0;
      const nominalTimeMs = scopeStartMs + perfTimeMs;
      const musicalBeat = timeline.timeMsToBeat(nominalTimeMs);
      playheadController.apply(container, adapter, musicalBeat, {
        startBeat: draft.scope.startBeat,
        terminalBeat: draft.scope.terminalBeat,
      });
    },
    [adapter, artifact, draft, isScoreIdentityConfirmed, playheadController]
  );

  useEffect(() => {
    const container = scoreContainerRef.current;
    if (!container) return;
    if (!isScoreIdentityConfirmed) {
      annotationController.apply(container, {
        confirmedCorrectNoteIds: [],
        confirmedErrorNoteIds: [],
      });
      playheadController.clear(container);
    }
  }, [annotationController, isScoreIdentityConfirmed, playheadController]);

  const replay = useMemo<PlayablePerformanceReplay | null>(() => {
    if (!draft) {
      return null;
    }
    if (draft.video?.status === 'READY') {
      return {
        kind: 'VIDEO_RECORDING',
        blob: draft.video.blob,
        contentType: draft.video.mimeType,
        byteSize: draft.video.blob.size,
        durationMs: draft.video.durationMs,
      };
    }
    if (draft.audio.status !== 'READY') {
      return null;
    }
    return {
      kind: 'AUDIO_RECORDING',
      blob: draft.audio.blob,
      contentType: draft.audio.mimeType,
      byteSize: draft.audio.blob.size,
      durationMs: draft.audio.durationMs,
    };
  }, [draft]);

  const saveMedia = useMemo(() => {
    if (draft?.video?.status === 'READY') {
      return {
        kind: 'VIDEO' as const,
        blob: draft.video.blob,
        mimeType: draft.video.mimeType,
        durationMs: draft.video.durationMs,
      };
    }
    if (draft?.audio.status === 'READY') {
      return {
        kind: 'AUDIO' as const,
        blob: draft.audio.blob,
        mimeType: draft.audio.mimeType,
        durationMs: draft.audio.durationMs,
      };
    }
    return null;
  }, [draft]);

  const clientRequestIdRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const splitExportAbortRef = useRef<AbortController | null>(null);
  const [splitExportStatus, setSplitExportStatus] = useState<
    'idle' | 'exporting' | 'success' | 'error'
  >('idle');
  const [splitExportProgress, setSplitExportProgress] = useState(0);
  const [splitExportError, setSplitExportError] = useState<string | null>(null);
  const saveMutation = useSavePerformanceTake();

  const splitScreenReadiness = useMemo(
    () =>
      getSplitScreenExportReadiness({
        draft,
        isScoreIdentityConfirmed,
        xmlContent,
        scoreContainer,
      }),
    [draft, isScoreIdentityConfirmed, scoreContainer, xmlContent]
  );

  const handleExportOriginalVideo = useCallback(() => {
    if (draft?.video?.status !== 'READY' || draft.video.blob.size <= 0) {
      return;
    }
    const url = URL.createObjectURL(draft.video.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-video-${Date.now()}.${extensionForMime(draft.video.mimeType)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [draft]);

  const handleExportSplitScreenVideo = useCallback(async () => {
    if (
      !draft ||
      draft.video?.status !== 'READY' ||
      !scoreContainerRef.current ||
      !splitScreenReadiness.ok ||
      splitExportStatus === 'exporting'
    ) {
      return;
    }

    const abortController = new AbortController();
    splitExportAbortRef.current = abortController;
    setSplitExportStatus('exporting');
    setSplitExportProgress(0);
    setSplitExportError(null);

    try {
      const result = await exportSplitScreenPerformanceVideo({
        draft,
        scoreContainer: scoreContainerRef.current,
        adapter,
        scoreEndBeat: artifact?.scoreEndBeat ?? draft.scope.terminalBeat,
        signal: abortController.signal,
        onProgress: (progress) => setSplitExportProgress(progress.ratio),
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `performance-score-video-${Date.now()}.${extensionForMime(result.mimeType)}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setSplitExportProgress(1);
      setSplitExportStatus('success');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setSplitExportStatus('idle');
        setSplitExportProgress(0);
        return;
      }
      setSplitExportStatus('error');
      setSplitExportError(
        err instanceof Error ? err.message : t('exportScoreVideoFailedDesc')
      );
    } finally {
      splitExportAbortRef.current = null;
    }
  }, [adapter, artifact, draft, splitExportStatus, splitScreenReadiness, t]);

  const handleCancelSplitScreenExport = useCallback(() => {
    splitExportAbortRef.current?.abort();
  }, []);

  const handleSavePerformance = useCallback(async () => {
    if (
      !draft ||
      !saveMedia ||
      saveStatus === 'saving' ||
      saveStatus === 'saved'
    ) {
      return;
    }
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = `take-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    if (
      saveMedia.kind === 'VIDEO' &&
      saveMedia.mimeType.split(';')[0]?.trim().toLowerCase() !== 'video/webm'
    ) {
      setSaveStatus('error');
      setSaveErrorMessage(t('savePerformanceVideoFormatUnsupported'));
      return;
    }
    if (saveMedia.blob.size > MAX_TAKE_MEDIA_BYTES) {
      setSaveStatus('error');
      setSaveErrorMessage(t('savePerformanceMediaTooLarge'));
      return;
    }
    setSaveStatus('saving');
    setSaveErrorMessage(null);

    const scopeType = draft.scope.startGroupId || draft.scope.endGroupId ? 'RANGE' : 'FULL';

    try {
      await saveMutation.mutateAsync({
        scoreId: id,
        revisionId: draft.revisionId ?? null,
        scopeType,
        artifactId: draft.artifactId,
        clientRequestId: clientRequestIdRef.current ?? '',
        mediaKind: saveMedia.kind,
        mediaBlob: saveMedia.blob,
        mimeType: saveMedia.mimeType,
        durationMs: saveMedia.durationMs,
        scopeStartBeat: draft.scope.startBeat,
        scopeTerminalBeat: draft.scope.terminalBeat,
        tempoSelection: draft.tempoPlan.selection as unknown as Record<string, unknown>,
        resolvedTempoPlan: draft.tempoPlan as unknown as Record<string, unknown>,
        syncMetadata: {
          recordingTimebase: draft.recordingTimebase,
          replayTiming: draft.replayTiming,
        },
      });
      setSaveStatus('saved');
    } catch (err: unknown) {
      setSaveStatus('error');
      setSaveErrorMessage(
        err instanceof Error ? err.message : t('savePerformanceFailed')
      );
    }
  }, [draft, id, saveMedia, saveMutation, saveStatus, t]);

  useEffect(() => {
    return () => {
      splitExportAbortRef.current?.abort();
    };
  }, []);

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
  const mismatchCount = outcomes.filter((o) => o.result === 'MISMATCH').length;
  const uncertainCount = outcomes.filter((o) => o.result === 'UNCERTAIN').length;
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
        .practice-summary-score-svg .practice-playhead-cursor {
          fill: rgb(251 191 36 / 22%);
          stroke: rgb(245 158 11 / 46%);
          stroke-width: 1.5px;
          filter: drop-shadow(0 0 4px rgb(245 158 11 / 24%));
          pointer-events: none !important;
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
            <Button variant="outline" size="sm" onClick={handleRestart}>
              <Repeat className="mr-1.5 h-4 w-4" />
              {t('retryPractice')}
            </Button>
            {draft.video?.status === 'READY' ? (
              <Button size="sm" variant="outline" onClick={handleExportOriginalVideo}>
                <Download className="mr-1.5 h-4 w-4" />
                {t('exportOriginalVideo')}
              </Button>
            ) : null}
            {draft.video?.status === 'READY' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportSplitScreenVideo}
                disabled={!splitScreenReadiness.ok || splitExportStatus === 'exporting'}
                title={
                  splitScreenReadiness.ok
                    ? undefined
                    : splitScreenBlockReasonToMessage(t, splitScreenReadiness.reason)
                }
              >
                {splitExportStatus === 'exporting' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Clapperboard className="mr-1.5 h-4 w-4" />
                )}
                {t('exportScoreVideo')}
              </Button>
            ) : null}
            {!saveMedia ? (
              <Button size="sm" variant="outline" disabled title={t('audioRecordingUnavailable')}>
                <Bookmark className="mr-1.5 h-4 w-4" />
                {t('savePerformance')}
              </Button>
            ) : saveStatus === 'saved' ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled>
                  <CheckCircle2 className="mr-1.5 h-4 w-4 text-green-600" />
                  {t('performanceSaved')}
                </Button>
                <Button size="sm" onClick={() => router.push('/my-performances')}>
                  {t('viewMyPerformances')}
                </Button>
              </div>
            ) : saveStatus === 'saving' ? (
              <Button size="sm" disabled>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                {t('savingPerformance')}
              </Button>
            ) : saveStatus === 'error' ? (
              <Button size="sm" variant="destructive" onClick={handleSavePerformance}>
                <AlertCircle className="mr-1.5 h-4 w-4" />
                {t('retrySavePerformance')}
              </Button>
            ) : (
              <Button size="sm" onClick={handleSavePerformance}>
                <Bookmark className="mr-1.5 h-4 w-4" />
                {t('savePerformance')}
              </Button>
            )}
          </div>
        }
      />

      {/* Save Error Alert */}
      {saveStatus === 'error' && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-4 text-red-900 dark:text-red-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-semibold">{t('savePerformanceFailedTitle')}</h4>
              <p className="text-xs text-red-700 dark:text-red-300">
                {saveErrorMessage ?? t('savePerformanceFailedDesc')}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={handleSavePerformance}>
            {t('retrySavePerformance')}
          </Button>
        </div>
      )}

      {draft.video?.status === 'READY' && splitExportStatus === 'exporting' ? (
        <div
          className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-100"
          data-testid="split-screen-export-progress"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold">{t('exportScoreVideoProgressTitle')}</h4>
              <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                {t('exportScoreVideoProgressDesc', {
                  progress: Math.round(splitExportProgress * 100),
                })}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{ width: `${Math.round(splitExportProgress * 100)}%` }}
                />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handleCancelSplitScreenExport}>
              {t('cancelExportScoreVideo')}
            </Button>
          </div>
        </div>
      ) : null}

      {draft.video?.status === 'READY' && splitExportStatus === 'error' ? (
        <div
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:bg-red-950/30 dark:text-red-200"
          data-testid="split-screen-export-error"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <h4 className="text-sm font-semibold">{t('exportScoreVideoFailedTitle')}</h4>
          </div>
          <p className="mt-1 pl-7 text-xs text-red-700 dark:text-red-300">
            {splitExportError ?? t('exportScoreVideoFailedDesc')}
          </p>
        </div>
      ) : null}

      {/* Save Success Banner */}
      {saveStatus === 'saved' && (
        <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-4 text-green-900 dark:text-green-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-semibold">{t('savePerformanceSuccessTitle')}</h4>
              <p className="text-xs text-green-700 dark:text-green-300">
                {t('savePerformanceSuccessDesc')}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => router.push('/my-performances')}>
            {t('viewMyPerformances')}
          </Button>
        </div>
      )}

      {/* Revision Mismatch Warning */}
      {isRevisionMismatched && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <h4 className="text-sm font-semibold">{t('scoreRevisionMismatchTitle')}</h4>
          </div>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 pl-7">
            {t('scoreRevisionMismatchDesc')}
          </p>
        </div>
      )}

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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-center">
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
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  <span>{t('mismatchGroupCount')}</span>
                </div>
                <div className="mt-1 text-lg font-bold text-red-600">
                  {mismatchCount}
                </div>
              </div>
              <div className="rounded-md border bg-slate-50 dark:bg-slate-900 p-3">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <HelpCircle className="h-3.5 w-3.5 text-purple-400" />
                  <span>{t('uncertainGroupCount')}</span>
                </div>
                <div className="mt-1 text-lg font-bold text-purple-600">
                  {uncertainCount}
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
