'use client';

import { SCORE_DECORATIONS } from '@/lib/practice/score-view/decorations';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Bookmark,
  Clock,
  Download,
  Loader2,
  Music,
  Repeat,
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
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { usePracticeScoreArtifact } from '@/hooks/practice/use-practice-score-artifact';
import { useSavePerformanceTake } from '@/hooks/queries/use-performance-take-queries';
import { continuousCompletionStore } from '@/lib/practice/continuous/completion-store';
import type { ContinuousPracticeCompletion } from '@/lib/practice/continuous/completion';
import { PerformancePlayheadController } from '@/lib/practice/score-view/performance-playhead-controller';
import {
  EvaluationAnnotationController,
  noteAnnotationsFromCompletedEvaluation,
} from '@/lib/practice/score-view/evaluation-annotations';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';
import { resolveReviewScoreState } from '@/lib/practice/review/review-score-state';
import { reviewReplay, reviewReplayMusicalBeat } from '@/lib/practice/review/review-replay';
import { reviewViewModel } from '@/lib/practice/review/review-view-model';
import { ShareVideoStudio } from '@/components/practice/share-video-studio';
import { createShareVideoSessionFromCompletion } from '@/lib/practice/sharing/video/current-completion-adapter';
import type { PerformanceTakeTempoPlan } from '@/lib/api/performance-takes';


const MAX_TAKE_MEDIA_BYTES = 100 * 1024 * 1024;

function scoreIdFromParams(params: ReturnType<typeof useParams>): string {
  const id = params?.id;
  return Array.isArray(id) ? id[0] ?? '' : id ?? '';
}

function extensionForMime(mimeType: string): string {
  const cleaned = mimeType.split(';')[0]?.trim().toLowerCase();
  if (cleaned === 'video/mp4' || cleaned === 'audio/mp4') return 'mp4';
  if (cleaned === 'audio/ogg') return 'ogg';
  if (cleaned === 'audio/wav' || cleaned === 'audio/x-wav') return 'wav';
  return 'webm';
}

function toPerformanceTakeTempoPlan(plan: ResolvedPracticeTempoPlan): PerformanceTakeTempoPlan {
  return {
    selection: plan.selection,
    segments: plan.segments.map((segment) => ({
      startBeat: segment.startBeat,
      bpm: segment.bpm,
      source: segment.source,
    })),
  };
}

export default function PracticeReviewPage({
  params: _paramsProp,
}: {
  params: Promise<{ id: string }>;
}) {
  const urlParams = useParams();
  const id = scoreIdFromParams(urlParams);
  const t = useTranslations('practice');
  const router = useRouter();

  const [completion, setCompletion] = useState<ContinuousPracticeCompletion | null>(() =>
    continuousCompletionStore.getCompletion()
  );

  useEffect(() => {
    return continuousCompletionStore.subscribe(setCompletion);
  }, []);

  const result = completion?.result ?? null;
  const recording = completion?.recording ?? null;

  const isValidCompletion = Boolean(result && result.scoreId === id);

  const selectedRevisionId = result?.revisionId ?? undefined;

  const revisionQuery = usePracticeReadyScoreContent(
    id,
    selectedRevisionId,
    isValidCompletion && Boolean(id)
  );
  const xmlContent = revisionQuery.data?.data?.content ?? null;
  const isLoadingXml = revisionQuery.isLoading;

  const artifactQuery = usePracticeScoreArtifact(
    id,
    selectedRevisionId,
    isValidCompletion && Boolean(id)
  );
  const artifact = artifactQuery.data ?? null;
  const scoreState = useMemo(() => resolveReviewScoreState({ result, artifact, xmlAvailable: Boolean(xmlContent), scoreId: id }),
    [artifact, result, xmlContent, id]);
  const isRevisionMismatched = scoreState.status === 'IDENTITY_MISMATCH';
  const isScoreIdentityConfirmed = scoreState.status === 'READY';
  const shareVideoSession = useMemo(() => {
    if (!completion || !artifact || scoreState.status !== 'READY') return null;
    try { return createShareVideoSessionFromCompletion(completion, artifact); } catch { return null; }
  }, [artifact, completion, scoreState]);

  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const playheadController = useMemo(() => new PerformancePlayheadController(), []);
  const annotationController = useMemo(() => new EvaluationAnnotationController(), []);

  const scoreContainerRef = useRef<HTMLDivElement | null>(null);
  const scoreRenderRevisionRef = useRef(0);
  const [scoreContainer, setScoreContainer] = useState<HTMLDivElement | null>(null);
  const [sharePreviewTimeMs, setSharePreviewTimeMs] = useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replayVideo, setReplayVideo] = useState<HTMLVideoElement | null>(null);
  const latestReplayTimeMsRef = useRef(0);
  const [hasExportedOriginalMedia, setHasExportedOriginalMedia] = useState(false);
  const [leaveIntent, setLeaveIntent] = useState<'score' | 'practice' | null>(null);
  const [isShareStudioOpen, setIsShareStudioOpen] = useState(false);
  const [isShareExporting, setIsShareExporting] = useState(false);

  const scoreNoteAnnotations = useMemo(() => {
    if (!isScoreIdentityConfirmed || !result?.evaluation) {
      return {
        supportedNoteIds: [],
        wrongNoteIds: [],
        missedNoteIds: [],
      };
    }
    return noteAnnotationsFromCompletedEvaluation(result.evaluation);
  }, [result, isScoreIdentityConfirmed]);

  const handleScoreRendered = useCallback(
    (_adapter: unknown, container: HTMLDivElement) => {
      scoreRenderRevisionRef.current += 1;
      const isNewContainer = scoreContainerRef.current !== container;
      scoreContainerRef.current = container;
      if (isNewContainer) {
        setScoreContainer(container);
      }
      if (!isScoreIdentityConfirmed) {
        annotationController.apply(container, {
          supportedNoteIds: [],
          wrongNoteIds: [],
        missedNoteIds: [],
        }, {
          renderRevision: scoreRenderRevisionRef.current,
        });
        return;
      }
      annotationController.apply(container, {
        supportedNoteIds: scoreNoteAnnotations.supportedNoteIds,
        wrongNoteIds: scoreNoteAnnotations.wrongNoteIds,
        missedNoteIds: scoreNoteAnnotations.missedNoteIds,
      }, {
        renderRevision: scoreRenderRevisionRef.current,
      });
    },
    [annotationController, isScoreIdentityConfirmed, scoreNoteAnnotations]
  );

  const handleReplayTimeChange = useCallback(
    (replayTimeMs: number | null, actualMediaDurationMs?: number | null) => {
      latestReplayTimeMsRef.current = Math.max(0, replayTimeMs ?? 0);
      const container = scoreContainerRef.current;
      if (!container || !result) return;
      if (
        replayTimeMs === null ||
        recording?.status !== 'READY' ||
        !isScoreIdentityConfirmed ||
        scoreState.status !== 'READY'
      ) {
        playheadController.clear(container);
        return;
      }
      const musicalBeat = reviewReplayMusicalBeat({ recording, mediaTimeMs: replayTimeMs,
        actualMediaDurationMs, scope: result.scope, tempoPlan: result.tempoPlan,
        scoreEndBeat: artifact?.scoreEndBeat ?? result.scope.terminalBeat });
      if (musicalBeat === null) { playheadController.clear(container); return; }
      playheadController.apply(
        container,
        adapter,
        musicalBeat,
        scoreState.scope
      );
    },
    [
      adapter,
      artifact,
      result,
      recording,
      isScoreIdentityConfirmed,
      playheadController,
      scoreState,
    ]
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
        supportedNoteIds: [],
        wrongNoteIds: [],
        missedNoteIds: [],
      }, {
        renderRevision: scoreRenderRevisionRef.current,
      });
      playheadController.clear(container);
      return;
    }
    annotationController.apply(container, {
      supportedNoteIds: scoreNoteAnnotations.supportedNoteIds,
      wrongNoteIds: scoreNoteAnnotations.wrongNoteIds,
        missedNoteIds: scoreNoteAnnotations.missedNoteIds,
    }, {
      renderRevision: scoreRenderRevisionRef.current,
    });
  }, [annotationController, isScoreIdentityConfirmed, playheadController, scoreNoteAnnotations]);

  const replay = useMemo(() => reviewReplay(recording), [recording]);

  const saveMedia = useMemo(() => {
    if (recording?.status === 'READY') {
      return {
        kind: recording.kind,
        blob: recording.blob,
        mimeType: recording.mimeType,
        durationMs: recording.durationMs,
        timebase: recording.timebase,
      };
    }
    return null;
  }, [recording]);

  const clientRequestIdRef = useRef<string | null>(null);
  const [saveRecordingStatus, setSaveRecordingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveRecordingErrorMessage, setSaveRecordingErrorMessage] = useState<string | null>(null);
  const saveRecordingMutation = useSavePerformanceTake();

  const handleExportOriginalVideo = useCallback(() => {
    if (
      recording?.status !== 'READY' ||
      recording.kind !== 'VIDEO' ||
      recording.blob.size <= 0
    ) {
      return;
    }
    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-video-${Date.now()}.${extensionForMime(recording.mimeType)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setHasExportedOriginalMedia(true);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [recording]);

  const handleSaveRecording = useCallback(async () => {
    if (
      !result ||
      !saveMedia ||
      saveRecordingStatus === 'saving' ||
      saveRecordingStatus === 'saved'
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
      setSaveRecordingStatus('error');
      setSaveRecordingErrorMessage(t('saveRecordingVideoFormatUnsupported'));
      return;
    }
    if (saveMedia.blob.size > MAX_TAKE_MEDIA_BYTES) {
      setSaveRecordingStatus('error');
      setSaveRecordingErrorMessage(t('saveRecordingMediaTooLarge'));
      return;
    }
    setSaveRecordingStatus('saving');
    setSaveRecordingErrorMessage(null);

    try {
      await saveRecordingMutation.mutateAsync({
        scoreId: id,
        revisionId: result.revisionId,
        artifactId: result.artifactId,
        clientRequestId: clientRequestIdRef.current ?? '',
        mediaKind: saveMedia.kind,
        mediaBlob: saveMedia.blob,
        mimeType: saveMedia.mimeType,
        durationMs: saveMedia.durationMs,
        scope:
          result.scope.kind === 'RANGE'
            ? {
                kind: 'RANGE',
                startBeat: result.scope.startBeat,
                terminalBeat: result.scope.terminalBeat,
                startGroupId: result.scope.startGroupId,
                endGroupId: result.scope.endGroupId,
              }
            : {
                kind: 'FULL',
                startBeat: result.scope.startBeat,
                terminalBeat: result.scope.terminalBeat,
              },
        tempoPlan: toPerformanceTakeTempoPlan(result.tempoPlan),
        recordingTimebase: { nominalMediaDurationMs: saveMedia.timebase.nominalMediaDurationMs,
          activeSegments: saveMedia.timebase.activeSegments.map(segment => ({ ...segment })) },
      });
      setSaveRecordingStatus('saved');
    } catch (err: unknown) {
      setSaveRecordingStatus('error');
      setSaveRecordingErrorMessage(
        err instanceof Error ? err.message : t('saveRecordingFailed')
      );
    }
  }, [result, id, saveMedia, saveRecordingMutation, saveRecordingStatus, t]);

  const performLeave = useCallback((target: 'score' | 'practice') => {
    continuousCompletionStore.clearCompletion();
    router.push(target === 'score' ? `/score/${id}` : `/score/${id}/practice`);
  }, [id, router]);

  const requestLeave = useCallback(
    (target: 'score' | 'practice') => {
      const hasUncommittedMedia = Boolean(
        recording?.status === 'READY' &&
          saveRecordingStatus !== 'saved' &&
          !hasExportedOriginalMedia
      );
      if (hasUncommittedMedia || isShareExporting) {
        setLeaveIntent(target);
        return;
      }
      performLeave(target);
    },
    [recording, hasExportedOriginalMedia, isShareExporting, performLeave, saveRecordingStatus]
  );

  const handleRestart = useCallback(() => {
    requestLeave('practice');
  }, [requestLeave]);

  const handleBackToScore = useCallback(() => {
    requestLeave('score');
  }, [requestLeave]);

  const hasUncommittedReviewMedia = Boolean(
    recording?.status === 'READY' &&
      saveRecordingStatus !== 'saved' &&
      !hasExportedOriginalMedia
  );
  const leaveReviewDescription = isShareExporting
    ? hasUncommittedReviewMedia
      ? t('leaveReviewWhileExportingAndUnsavedDesc')
      : t('leaveReviewWhileExportingDesc')
    : hasUncommittedReviewMedia
      ? t('leaveReviewUnsavedMediaDesc')
      : t('leaveReviewDesc');

  if (!isValidCompletion || !result || !recording) {
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

  const view = reviewViewModel(result);
  const { metrics, tempoText } = view;
  const scopeText = `${t(view.scopeLabel)} ${view.scopeBeatText}`;
  const inputSourceText = t(view.inputSourceLabel);

  return (
    <div className="container mx-auto max-w-7xl space-y-6 py-6 px-4 sm:px-6 lg:px-8">
      <style>{`
        .practice-summary-score-svg .${SCORE_DECORATIONS.supported} {
          fill: #16a34a !important;
          stroke: #15803d !important;
          opacity: 1 !important;
        }
        .practice-summary-score-svg .${SCORE_DECORATIONS.wrong} {
          fill: #dc2626 !important;
          stroke: #b91c1c !important;
          opacity: 1 !important;
        }
        .practice-summary-score-svg .${SCORE_DECORATIONS.missed} {
          fill: #94a3b8 !important;
          color: #94a3b8 !important;
        }
        .practice-summary-score-svg .${SCORE_DECORATIONS.cursor} {
          stroke-width: 1.5px;
          pointer-events: none !important;
        }
        .practice-summary-score-svg .${SCORE_DECORATIONS.cursor}[data-playhead-staff='treble'] {
          fill: rgb(125 211 252 / 24%);
          stroke: rgb(14 165 233 / 48%);
          filter: drop-shadow(0 0 4px rgb(14 165 233 / 22%));
        }
        .practice-summary-score-svg .${SCORE_DECORATIONS.cursor}[data-playhead-staff='bass'] {
          fill: rgb(251 191 36 / 22%);
          stroke: rgb(245 158 11 / 46%);
          filter: drop-shadow(0 0 4px rgb(245 158 11 / 24%));
        }
        .practice-summary-score-svg .${SCORE_DECORATIONS.cursor}[data-playhead-staff='other'] {
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
        description={`完成时间：${new Date(result.completedAt).toLocaleTimeString()}`}
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

      <section aria-labelledby="target-feedback-heading" className="space-y-3">
        <h2 id="target-feedback-heading" className="text-sm font-semibold">
          {t(metrics.inputSource === 'MIDI' ? 'targetNoteOutcomes' : 'targetNoteEvidence')}
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {view.targetCards.map(card => <Card key={card.label} className="rounded-lg bg-card">
            <CardHeader><CardTitle className="text-xs text-muted-foreground">{t(card.label)}</CardTitle></CardHeader>
            <CardContent><div className={`text-xl font-bold${card.tone === 'supported' ? ' text-green-600' : card.tone === 'wrong' ? ' text-red-600' : card.tone === 'neutral' ? ' text-slate-600' : ''}`}>{card.value}</div></CardContent>
          </Card>)}
        </div>
      </section>
      {metrics.status === 'COMPLETE' && metrics.inputSource === 'MIDI' && <section aria-labelledby="additional-playing-heading" className="space-y-3 border-t pt-4">
        <h2 id="additional-playing-heading" className="text-sm font-semibold">{t('additionalPlaying')}</h2>
        <Card className="max-w-xs rounded-lg bg-card">
          <CardHeader><CardTitle className="text-xs text-muted-foreground">{t('extraPitchCount')}</CardTitle></CardHeader>
          <CardContent><div className="text-xl font-bold text-amber-600">{metrics.extraObservationCount}</div></CardContent>
        </Card>
      </section>}
      {metrics.status === 'UNAVAILABLE' ? <p className="text-sm text-muted-foreground">{t('evaluationUnavailableDesc')}</p>
        : metrics.inputSource === 'MICROPHONE' ? <p className="text-sm text-muted-foreground">{t('acousticEvidenceDesc')}</p> : null}
      {metrics.status === 'COMPLETE' && metrics.notReachedStrikeCount > 0 ? <p className="text-sm text-muted-foreground">{t('notReachedStrikesDesc')}</p> : null}


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
        ) : recording.status === 'NOT_RECORDED' ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm font-semibold">{t('performanceNotRecorded')}</span>
            </div>
            <p className="mt-1 pl-6 text-xs text-slate-600 dark:text-slate-400">
              {t('performanceNotRecordedDesc')}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-amber-800 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm font-semibold">{t('audioRecordingUnavailable')}</span>
            </div>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400 pl-6">
              {recording.status === 'UNAVAILABLE' &&
              (recording.reason === 'PERMISSION_DENIED' ||
                recording.reason === 'NotAllowedError')
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

      <Card className="rounded-lg bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {t('performanceDetails')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">{t('performanceDuration')}</div>
              <div className="font-semibold">{view.durationText}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('performanceTempo')}</div>
              <div className="font-semibold">{tempoText}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('performanceInput')}</div>
              <div className="font-semibold">{inputSourceText}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('performanceScope')}</div>
              <div className="font-semibold">{scopeText}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg bg-card" data-testid="original-performance-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('saveOriginalRecordingTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('saveOriginalRecordingDesc')}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {recording?.status === 'READY' && recording.kind === 'VIDEO' ? (
            <Button size="sm" variant="outline" onClick={handleExportOriginalVideo}>
              <Download className="mr-1.5 h-4 w-4" />
              {t('exportOriginalVideo')}
            </Button>
          ) : null}
          {saveMedia ? (
            saveRecordingStatus === 'saved' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" disabled>
                  <CheckCircle2 className="mr-1.5 h-4 w-4 text-green-600" />
                  {t('recordingSaved')}
                </Button>
                <Button size="sm" onClick={() => router.push('/my-performances')}>
                  {t('viewMyPerformances')}
                </Button>
              </div>
            ) : saveRecordingStatus === 'saving' ? (
              <Button size="sm" disabled>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                {t('savingRecording')}
              </Button>
            ) : saveRecordingStatus === 'error' ? (
              <Button size="sm" variant="destructive" onClick={handleSaveRecording}>
                <AlertCircle className="mr-1.5 h-4 w-4" />
                {t('retrySaveRecording')}
              </Button>
            ) : (
              <Button size="sm" onClick={handleSaveRecording}>
                <Bookmark className="mr-1.5 h-4 w-4" />
                {t('saveRecording')}
              </Button>
            )
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled
              title={
                recording.status === 'NOT_RECORDED'
                  ? t('performanceNotRecorded')
                  : t('audioRecordingUnavailable')
              }
            >
              <Bookmark className="mr-1.5 h-4 w-4" />
              {t('saveRecording')}
            </Button>
          )}
          {saveRecordingStatus === 'error' ? (
            <div className="basis-full rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t('saveRecordingFailedTitle')}</p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    {saveRecordingErrorMessage ?? t('saveRecordingFailedDesc')}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {recording?.status === 'READY' && recording.kind === 'VIDEO' ? (
        <ShareVideoStudio
          key={result.localSessionId}
          session={shareVideoSession}
          scoreContainer={scoreContainer}
          adapter={adapter}
          scoreEndBeat={artifact?.scoreEndBeat ?? result.scope.terminalBeat}
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
      <AlertDialog
        open={leaveIntent !== null}
        onOpenChange={(open) => {
          if (!open) setLeaveIntent(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('leaveReviewTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {leaveReviewDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLeaveIntent(null)}>
              {t('leaveReviewContinue')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = leaveIntent;
                setLeaveIntent(null);
                if (target) performLeave(target);
              }}
            >
              {t('leaveReviewConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
