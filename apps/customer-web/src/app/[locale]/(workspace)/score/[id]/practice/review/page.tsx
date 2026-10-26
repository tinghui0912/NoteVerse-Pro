'use client';

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
import { mediaTimeToPerformanceTimeMs } from '@/lib/practice/recording/recording-timebase';
import { PerformancePlayheadController } from '@/lib/practice/performance-playhead-controller';
import {
  PerformanceAnnotationController,
  noteAnnotationsFromCompletedEvaluation,
} from '@/lib/practice/performance-annotation-controller';
import { PracticeTempoTimeline } from '@/lib/practice/kernel/tempo';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { resolvePracticeScopeCursorNoteIds } from '@/lib/practice/score-view/cursor-scope';
import type { CursorScope } from '@/lib/practice/score-view/cursor-scope';
import { resolveScopeTiming } from '@/lib/practice/scope-timing';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import type { PlayablePerformanceReplay } from '@/lib/practice/recording/performance-replay';
import { ShareVideoStudio } from '@/components/practice/share-video-studio';
import { createShareVideoSessionFromCompletion } from '@/lib/practice/share-video-session';
import type { PerformanceTakeTempoPlan } from '@/lib/api/performance-takes';


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
  const cursorScopeResolution = useMemo<
    | { status: 'ready'; scope: CursorScope }
    | { status: 'invalid'; reason: string }
  >(() => {
    if (!artifact || !result) {
      return { status: 'invalid', reason: 'score_source_unavailable' };
    }
    try {
      const isRange = result.scope.kind === 'RANGE';
      if (!isRange) {
        return {
          status: 'ready',
          scope: {
            kind: 'FULL',
            startBeat: result.scope.startBeat,
            terminalBeat: result.scope.terminalBeat,
          },
        };
      }
      const allowedNoteIds = resolvePracticeScopeCursorNoteIds(artifact, result.scope);
      if (allowedNoteIds.length === 0) {
        return { status: 'invalid', reason: 'range_has_no_selectable_notes' };
      }
      return {
        status: 'ready',
        scope: {
          kind: 'RANGE',
          startBeat: result.scope.startBeat,
          terminalBeat: result.scope.terminalBeat,
          allowedNoteIds,
        },
      };
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[NoteVerse] invalid review cursor scope', error);
      }
      return {
        status: 'invalid',
        reason: error instanceof Error ? error.message : 'cursor_scope_invalid',
      };
    }
  }, [artifact, result]);
  const shareVideoSession = useMemo(
    () => {
      if (!completion || !artifact) return null;
      try {
        return createShareVideoSessionFromCompletion(completion, artifact);
      } catch {
        return null;
      }
    },
    [artifact, completion]
  );

  const isRevisionMismatched = useMemo(() => {
    if (!isValidCompletion || !result || !artifact) return false;
    if (artifact.scoreId !== result.scoreId) return true;
    if (artifact.artifactId !== result.artifactId) return true;
    return artifact.revisionId !== result.revisionId;
  }, [artifact, result, isValidCompletion]);

  const isScoreIdentityConfirmed = useMemo(() => {
    if (!isValidCompletion || !result || !artifact || !xmlContent || isRevisionMismatched) {
      return false;
    }
    return (
      artifact.scoreId === result.scoreId &&
      artifact.artifactId === result.artifactId &&
      artifact.revisionId === result.revisionId
    );
  }, [artifact, result, isRevisionMismatched, isValidCompletion, xmlContent]);

  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const playheadController = useMemo(() => new PerformancePlayheadController(), []);
  const annotationController = useMemo(() => new PerformanceAnnotationController(), []);

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
        cursorScopeResolution.status !== 'ready'
      ) {
        playheadController.clear(container);
        return;
      }
      const perfTimeMs = mediaTimeToPerformanceTimeMs(
        replayTimeMs,
        recording.timebase,
        actualMediaDurationMs
      );
      if (perfTimeMs === null) {
        playheadController.clear(container);
        return;
      }
      const scoreEndBeat = artifact?.scoreEndBeat ?? result.scope.terminalBeat;
      const timeline = new PracticeTempoTimeline(result.tempoPlan, scoreEndBeat);
      const scopeStartMs = resolveScopeTiming(
        result.scope,
        result.tempoPlan,
        scoreEndBeat
      ).scopeStartMs;
      const nominalTimeMs = scopeStartMs + perfTimeMs;
      const musicalBeat = timeline.timeMsToBeat(nominalTimeMs);
      playheadController.apply(
        container,
        adapter,
        musicalBeat,
        cursorScopeResolution.scope
      );
    },
    [
      adapter,
      artifact,
      result,
      recording,
      isScoreIdentityConfirmed,
      playheadController,
      cursorScopeResolution,
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

  const replay = useMemo<PlayablePerformanceReplay | null>(() => {
    if (!recording) {
      return null;
    }
    if (recording?.status === 'READY' && recording.kind === 'VIDEO') {
      return {
        kind: 'VIDEO_RECORDING',
        blob: recording.blob,
        contentType: recording.mimeType,
        byteSize: recording.blob.size,
        durationMs: recording.durationMs,
      };
    }
    if (recording?.status !== 'READY' || recording.kind !== 'AUDIO') {
      return null;
    }
    return {
      kind: 'AUDIO_RECORDING',
      blob: recording.blob,
      contentType: recording.mimeType,
      byteSize: recording.blob.size,
      durationMs: recording.durationMs,
    };
  }, [recording]);

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const saveMutation = useSavePerformanceTake();

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

  const handleSavePerformance = useCallback(async () => {
    if (
      !result ||
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

    try {
      await saveMutation.mutateAsync({
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
      setSaveStatus('saved');
    } catch (err: unknown) {
      setSaveStatus('error');
      setSaveErrorMessage(
        err instanceof Error ? err.message : t('savePerformanceFailed')
      );
    }
  }, [result, id, saveMedia, saveMutation, saveStatus, t]);

  const performLeave = useCallback((target: 'score' | 'practice') => {
    continuousCompletionStore.clearCompletion();
    router.push(target === 'score' ? `/score/${id}` : `/score/${id}/practice`);
  }, [id, router]);

  const requestLeave = useCallback(
    (target: 'score' | 'practice') => {
      const hasUncommittedMedia = Boolean(
        recording?.status === 'READY' &&
          saveStatus !== 'saved' &&
          !hasExportedOriginalMedia
      );
      if (hasUncommittedMedia || isShareExporting) {
        setLeaveIntent(target);
        return;
      }
      performLeave(target);
    },
    [recording, hasExportedOriginalMedia, isShareExporting, performLeave, saveStatus]
  );

  const handleRestart = useCallback(() => {
    requestLeave('practice');
  }, [requestLeave]);

  const handleBackToScore = useCallback(() => {
    requestLeave('score');
  }, [requestLeave]);

  const hasUncommittedReviewMedia = Boolean(
    recording?.status === 'READY' &&
      saveStatus !== 'saved' &&
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

  const metrics = result.metrics;

  const tempoText =
    result.tempoPlan.selection.mode === 'CUSTOM_FIXED_BPM'
      ? `${result.tempoPlan.selection.bpm} BPM`
      : '原曲速度';

  const scopeText = result.scope.kind === 'RANGE'
    ? `${t('scopeSection')} (${result.scope.startBeat} - ${result.scope.terminalBeat} 拍)`
    : `${t('scopeFull')} (${result.scope.startBeat} - ${result.scope.terminalBeat} 拍)`;

  const inputSourceText =
    result.inputSource === 'MICROPHONE'
      ? t('inputSourceMic')
      : t('inputSourceMidi');

  return (
    <div className="container mx-auto max-w-7xl space-y-6 py-6 px-4 sm:px-6 lg:px-8">
      <style>{`
        .practice-summary-score-svg .practice-summary-note-supported {
          fill: #16a34a !important;
          stroke: #15803d !important;
          opacity: 1 !important;
        }
        .practice-summary-score-svg .practice-summary-note-wrong {
          fill: #dc2626 !important;
          stroke: #b91c1c !important;
          opacity: 1 !important;
        }
        .practice-summary-score-svg .practice-summary-note-missed {
          fill: #94a3b8 !important;
          color: #94a3b8 !important;
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
          <Card className="rounded-lg bg-card">
            <CardHeader><CardTitle className="text-xs text-muted-foreground">{t('targetStrikes')}</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold">{metrics.targetStrikeCount}</div></CardContent>
          </Card>
          {metrics.status === 'COMPLETE' && <>
            <Card className="rounded-lg bg-card">
              <CardHeader><CardTitle className="text-xs text-muted-foreground">{t(metrics.inputSource === 'MIDI' ? 'confirmedCorrectStrikes' : 'detectedTargetNotes')}</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-bold text-green-600">{metrics.inputSource === 'MIDI' ? metrics.correctStrikeCount : metrics.supportedStrikeCount}</div></CardContent>
            </Card>
            {metrics.inputSource === 'MIDI' && <Card className="rounded-lg bg-card">
              <CardHeader><CardTitle className="text-xs text-muted-foreground">{t('wrongStrikeCount')}</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-bold text-red-600">{metrics.wrongStrikeCount}</div></CardContent>
            </Card>}
            <Card className="rounded-lg bg-card">
              <CardHeader><CardTitle className="text-xs text-muted-foreground">{t(metrics.inputSource === 'MIDI' ? 'missingStrikes' : 'unconfirmedTargetNotes')}</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-bold text-slate-600">{metrics.inputSource === 'MIDI' ? metrics.missingStrikeCount : metrics.unconfirmedStrikeCount}</div></CardContent>
            </Card>
            <Card className="rounded-lg bg-card">
              <CardHeader><CardTitle className="text-xs text-muted-foreground">{t('notReachedStrikes')}</CardTitle></CardHeader>
              <CardContent><div className="text-xl font-bold text-slate-600">{metrics.notReachedStrikeCount}</div></CardContent>
            </Card>
          </>}
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
              <div className="font-semibold">{formatDuration(result.activeElapsedMs)}</div>
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
          <CardTitle className="text-sm font-semibold">{t('saveOriginalPerformanceTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('saveOriginalPerformanceDesc')}
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
