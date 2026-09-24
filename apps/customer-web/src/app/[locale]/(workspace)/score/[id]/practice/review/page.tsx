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
import { ShareVideoStudio } from '@/components/practice/share-video-studio';

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
  const [sharePreviewTimeMs, setSharePreviewTimeMs] = useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replayVideo, setReplayVideo] = useState<HTMLVideoElement | null>(null);
  const latestReplayTimeMsRef = useRef(0);
  const [hasExportedOriginalMedia, setHasExportedOriginalMedia] = useState(false);
  const [leaveIntent, setLeaveIntent] = useState<'score' | 'practice' | null>(null);
  const [isShareStudioOpen, setIsShareStudioOpen] = useState(false);
  const [isShareExporting, setIsShareExporting] = useState(false);

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
      latestReplayTimeMsRef.current = Math.max(0, replayTimeMs ?? 0);
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

  const handleReplayPlaybackStateChange = useCallback((playing: boolean) => {
    setIsReplayPlaying(playing);
    if (!playing) {
      setSharePreviewTimeMs(latestReplayTimeMsRef.current);
    }
  }, []);

  const handleReplaySeekCommitted = useCallback((replayTimeMs: number) => {
    latestReplayTimeMsRef.current = Math.max(0, replayTimeMs);
    setSharePreviewTimeMs(Math.max(0, replayTimeMs));
  }, []);

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
  const saveMutation = useSavePerformanceTake();

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
    setHasExportedOriginalMedia(true);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [draft]);

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
    };
  }, []);

  const performLeave = useCallback((target: 'score' | 'practice') => {
    performanceReviewDraftStore.clearDraft();
    router.push(target === 'score' ? `/score/${id}` : `/score/${id}/practice`);
  }, [id, router]);

  const requestLeave = useCallback(
    (target: 'score' | 'practice') => {
      const hasUncommittedMedia = Boolean(
        draft &&
          (draft.audio.status === 'READY' || draft.video?.status === 'READY') &&
          saveStatus !== 'saved' &&
          !hasExportedOriginalMedia
      );
      if (hasUncommittedMedia || isShareExporting) {
        setLeaveIntent(target);
        return;
      }
      performLeave(target);
    },
    [draft, hasExportedOriginalMedia, isShareExporting, performLeave, saveStatus]
  );

  const handleRestart = useCallback(() => {
    requestLeave('practice');
  }, [requestLeave]);

  const handleBackToScore = useCallback(() => {
    requestLeave('score');
  }, [requestLeave]);

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
          stroke-width: 1.5px;
          pointer-events: none !important;
        }
        .practice-summary-score-svg .practice-playhead-cursor[data-playhead-staff='treble'] {
          fill: rgb(125 211 252 / 24%);
          stroke: rgb(14 165 233 / 48%);
          filter: drop-shadow(0 0 4px rgb(14 165 233 / 22%));
        }
        .practice-summary-score-svg .practice-playhead-cursor[data-playhead-staff='bass'] {
          fill: rgb(251 191 36 / 22%);
          stroke: rgb(245 158 11 / 46%);
          filter: drop-shadow(0 0 4px rgb(245 158 11 / 24%));
        }
        .practice-summary-score-svg .practice-playhead-cursor[data-playhead-staff='other'] {
          fill: rgb(148 163 184 / 20%);
          stroke: rgb(100 116 139 / 44%);
          filter: drop-shadow(0 0 4px rgb(100 116 139 / 18%));
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
          </div>
        }
      />

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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
                onPlaybackStateChange={handleReplayPlaybackStateChange}
                onReplaySeekCommitted={handleReplaySeekCommitted}
                onVideoElementChange={setReplayVideo}
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

      <Card className="rounded-lg bg-card" data-testid="original-performance-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('saveOriginalPerformanceTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('saveOriginalPerformanceDesc')}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {draft.video?.status === 'READY' ? (
            <Button size="sm" variant="outline" onClick={handleExportOriginalVideo}>
              <Download className="mr-1.5 h-4 w-4" />
              {t('exportOriginalVideo')}
            </Button>
          ) : null}
          {saveMedia ? (
            saveStatus === 'saved' ? (
              <div className="flex flex-wrap items-center gap-2">
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
            )
          ) : (
            <Button size="sm" variant="outline" disabled title={t('audioRecordingUnavailable')}>
              <Bookmark className="mr-1.5 h-4 w-4" />
              {t('savePerformance')}
            </Button>
          )}
          {saveStatus === 'error' ? (
            <div className="basis-full rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t('savePerformanceFailedTitle')}</p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    {saveErrorMessage ?? t('savePerformanceFailedDesc')}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {draft.video?.status === 'READY' ? (
        <ShareVideoStudio
          draft={draft}
          scoreContainer={scoreContainer}
          adapter={adapter}
          scoreEndBeat={artifact?.scoreEndBeat ?? draft.scope.terminalBeat}
          isScoreIdentityConfirmed={isScoreIdentityConfirmed}
          xmlContent={xmlContent}
          mediaTimeMs={sharePreviewTimeMs}
          isReplayPlaying={isReplayPlaying}
          replayVideo={replayVideo}
          open={isShareStudioOpen}
          onOpenChange={setIsShareStudioOpen}
          onExportingChange={setIsShareExporting}
        />
      ) : null}
      {/*
        <Card className="rounded-lg bg-card" data-testid="share-performance-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t('sharePerformanceVideoTitle')}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t('sharePerformanceVideoDesc')}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-3" aria-labelledby="share-video-orientation-heading">
              <div>
                <h3 id="share-video-orientation-heading" className="text-sm font-semibold">
                  {t('shareVideoOrientationStep')}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('shareVideoOrientationDesc')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="视频比例">
                <ShareChoiceCard
                  selected={videoOrientation === 'landscape'}
                  title={t('shareLandscapeTitle')}
                  description={t('shareLandscapeDesc')}
                  icon={RectangleHorizontal}
                  onClick={() => {
                    hasInitializedVideoOrientationRef.current = true;
                    setVideoOrientation('landscape');
                  }}
                  testId="share-orientation-landscape"
                />
                <ShareChoiceCard
                  selected={videoOrientation === 'portrait'}
                  title={t('sharePortraitTitle')}
                  description={t('sharePortraitDesc')}
                  icon={RectangleVertical}
                  onClick={() => {
                    hasInitializedVideoOrientationRef.current = true;
                    setVideoOrientation('portrait');
                  }}
                  testId="share-orientation-portrait"
                />
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="share-video-presentation-heading">
              <div>
                <h3 id="share-video-presentation-heading" className="text-sm font-semibold">
                  {t('sharePresentationStep')}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('sharePresentationDesc')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="乐谱呈现方式">
                <ShareChoiceCard
                  selected={scorePresentation === 'split'}
                  title={t('shareSplitTitle')}
                  description={t('shareSplitDesc')}
                  icon={Columns2}
                  onClick={() => setScorePresentation('split')}
                  testId="share-presentation-split"
                />
                {FLOATING_SHARE_TEMPLATE_ENABLED ? (
                  <ShareChoiceCard
                    selected={scorePresentation === 'floating'}
                    title={t('shareFloatingTitle')}
                    description={t('shareFloatingDesc')}
                    icon={Layers2}
                    badge={t('shareDevPreview')}
                    onClick={() => setScorePresentation('floating')}
                    testId="share-presentation-floating"
                  />
                ) : null}
              </div>
            </section>

            {scorePresentation === 'floating' ? (
              <section className="space-y-3" aria-labelledby="share-video-position-heading">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 id="share-video-position-heading" className="text-sm font-semibold">
                      {t('sharePositionStep')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('sharePositionDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                    aria-expanded={isFloatingAdvancedOpen}
                    onClick={() => setIsFloatingAdvancedOpen((open) => !open)}
                    data-testid="share-floating-advanced-toggle"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {t('shareAdjustPositionSize')}
                    {isFloatingAdvancedOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="乐谱位置">
                  <ShareChoiceCard
                    selected={floatingPosition === 'top'}
                    title={t('shareTop')}
                    description={t('shareTopDesc')}
                    icon={RectangleHorizontal}
                    onClick={() => setFloatingPosition('top')}
                    testId="share-floating-position-top"
                  />
                  <ShareChoiceCard
                    selected={floatingPosition === 'bottom'}
                    title={t('shareBottom')}
                    description={t('shareBottomDesc')}
                    icon={RectangleHorizontal}
                    onClick={() => setFloatingPosition('bottom')}
                    testId="share-floating-position-bottom"
                  />
                </div>
                {isFloatingAdvancedOpen ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                      <SlidersHorizontal className="h-4 w-4" />
                      {t('shareScoreSize')}
                    </div>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="悬浮乐谱大小">
                      {(['small', 'medium', 'large'] as const).map((size) => (
                        <button
                          key={size}
                          type="button"
                          role="radio"
                          aria-checked={floatingSize === size}
                          onClick={() => setFloatingSize(size)}
                          className={[
                            'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            floatingSize === size
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-background hover:border-primary/50',
                          ].join(' ')}
                          data-testid={`share-floating-size-${size}`}
                        >
                          {size === 'small'
                            ? t('shareSmall')
                            : size === 'medium'
                              ? t('shareMedium')
                              : t('shareLarge')}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-3" aria-labelledby="share-video-preview-heading">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="share-video-preview-heading" className="text-sm font-semibold">
                    {t('sharePreviewTitle')}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('sharePreviewDesc')}</p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('sharePreviewTime', { time: formatDuration(sharePreviewTimeMs) })}
                </span>
              </div>
              <ShareVideoPreview
                draft={draft}
                scoreContainer={scoreContainer}
                adapter={adapter}
                scoreEndBeat={artifact?.scoreEndBeat ?? draft.scope.terminalBeat}
                mediaTimeMs={sharePreviewTimeMs}
                template={shareTemplate}
                isReplayPlaying={isReplayPlaying}
                replayVideo={replayVideo}
              />
              {scorePresentation === 'floating' ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setIsFloatingAdvancedOpen(true)}
                  data-testid="share-adjust-frame"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {t('shareAdjustFrame')}
                </button>
              ) : null}
            </section>

            <section className="space-y-3" aria-labelledby="share-video-export-heading">
              <div>
                <h3 id="share-video-export-heading" className="text-sm font-semibold">
                  {t('shareExportTitle')}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{shareTemplateSummary}</p>
              </div>
              {!splitScreenReadiness.ok ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {splitScreenBlockReasonToMessage(t, splitScreenReadiness.reason)}
                </p>
              ) : null}
              <Button
                onClick={handleExportSplitScreenVideo}
                disabled={!splitScreenReadiness.ok || splitExportStatus === 'exporting'}
                aria-label={t('exportScoreVideo')}
                title={
                  splitScreenReadiness.ok
                    ? undefined
                    : splitScreenBlockReasonToMessage(t, splitScreenReadiness.reason)
                }
                data-testid="generate-share-video"
              >
                {splitExportStatus === 'exporting' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Clapperboard className="mr-1.5 h-4 w-4" />
                )}
                {t('shareExportAction')}
              </Button>
            </section>

            {splitExportStatus === 'exporting' ? (
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

            {splitExportStatus === 'error' ? (
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

            {saveStatus === 'saved' ? (
              <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-green-900 dark:bg-green-950/30 dark:text-green-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <h4 className="text-sm font-semibold">{t('savePerformanceSuccessTitle')}</h4>
                    <p className="text-xs text-green-700 dark:text-green-300">
                      {t('savePerformanceSuccessDesc')}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      */}

      <AlertDialog
        open={leaveIntent !== null}
        onOpenChange={(open) => {
          if (!open) setLeaveIntent(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>离开临时演奏报告？</AlertDialogTitle>
            <AlertDialogDescription>
              本地原始录音或录像尚未保存为正式演奏，也尚未导出。离开或重新练习后，这份临时媒体可能无法再次访问。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLeaveIntent(null)}>
              继续查看
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = leaveIntent;
                setLeaveIntent(null);
                if (target) performLeave(target);
              }}
            >
              确认离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
