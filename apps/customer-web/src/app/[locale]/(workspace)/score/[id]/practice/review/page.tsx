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
  Loader2,
  Music,
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
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { usePracticeScoreArtifact } from '@/hooks/practice/use-practice-score-artifact';
import { useSavePerformanceTake } from '@/hooks/queries/use-performance-take-queries';
import {
  completedPerformanceStore,
  type CompletedPerformance,
  mediaTimeToPerformanceTimeMs,
} from '@/lib/practice/completed-performance';
import { PerformancePlayheadController } from '@/lib/practice/performance-playhead-controller';
import {
  PerformanceAnnotationController,
  noteAnnotationsFromPerformanceOutcomes,
} from '@/lib/practice/performance-annotation-controller';
import { PracticeTempoTimeline } from '@/lib/practice/local-core/practice-tempo';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/local-core/practice-tempo';
import {
  resolvePracticeScopeCursorNoteIds,
  type PracticeScoreArtifact,
} from '@/lib/practice/local-core/artifact';
import type { CursorScope } from '@/lib/practice/local-core/cursor-scope';
import { resolveScopeTiming } from '@/lib/practice/scope-timing';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';
import { ShareVideoStudio } from '@/components/practice/share-video-studio';
import { createShareVideoSessionFromCompletedPerformance } from '@/lib/practice/share-video-session';
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

function buildFeedbackSummary({
  artifact,
  scope,
  outcomes,
}: {
  artifact: PracticeScoreArtifact | null | undefined;
  scope: CompletedPerformance['scope'];
  outcomes: CompletedPerformance['evaluation']['outcomes'];
}) {
  const byGroupId = new Map(outcomes.map((outcome) => [outcome.expectedGroupId, outcome]));
  const summary = {
    targetStrikeCount: 0,
    correctStrikeCount: 0,
    missingStrikeCount: 0,
    unconfirmedStrikeCount: 0,
    extraPitchCount: outcomes.reduce((sum, outcome) => sum + outcome.unexpectedPitches.length, 0),
  };

  const expectedGroups = artifact
    ? artifact.expectedPracticeGroups.slice(scope.startIndex, scope.endIndex + 1)
    : [];
  const expectedStrikeCount = expectedGroups.reduce(
    (count, group) => count + group.strikeTargets.length,
    0
  );
  if (expectedStrikeCount === 0) {
    applyOutcomeUniverseToSummary(summary, outcomes);
    return summary;
  }

  for (const group of expectedGroups) {
    const outcome = byGroupId.get(group.groupId);
    const byStrikeId = new Map(
      outcome?.expectedStrikeOutcomes.map((strike) => [strike.strikeId, strike]) ?? []
    );
    for (const strikeTarget of group.strikeTargets) {
      summary.targetStrikeCount += 1;
      const result = byStrikeId.get(strikeTarget.strikeId)?.result ?? 'UNCONFIRMED';
      if (result === 'MATCHED') {
        summary.correctStrikeCount += 1;
      } else if (result === 'MISSING') {
        summary.missingStrikeCount += 1;
      } else {
        summary.unconfirmedStrikeCount += 1;
      }
    }
  }
  return summary;
}

function applyOutcomeUniverseToSummary(
  summary: {
    targetStrikeCount: number;
    correctStrikeCount: number;
    missingStrikeCount: number;
    unconfirmedStrikeCount: number;
  },
  outcomes: CompletedPerformance['evaluation']['outcomes']
) {
  for (const outcome of outcomes) {
    for (const strike of outcome.expectedStrikeOutcomes ?? []) {
      summary.targetStrikeCount += 1;
      if (strike.result === 'MATCHED') {
        summary.correctStrikeCount += 1;
      } else if (strike.result === 'MISSING') {
        summary.missingStrikeCount += 1;
      } else {
        summary.unconfirmedStrikeCount += 1;
      }
    }
  }
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

  const [draft, setDraft] = useState<CompletedPerformance | null>(() =>
    completedPerformanceStore.getPerformance()
  );

  useEffect(() => {
    return completedPerformanceStore.subscribe(setDraft);
  }, []);

  const isValidDraft = Boolean(draft && draft.scoreId === id);

  const selectedRevisionId = draft?.revisionId ?? undefined;

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
  const cursorScopeResolution = useMemo<
    | { status: 'ready'; scope: CursorScope }
    | { status: 'invalid'; reason: string }
  >(() => {
    if (!artifact || !draft) {
      return { status: 'invalid', reason: 'score_source_unavailable' };
    }
    try {
      const isRange = draft.scope.kind === 'RANGE';
      if (!isRange) {
        return {
          status: 'ready',
          scope: {
            kind: 'FULL',
            startBeat: draft.scope.startBeat,
            terminalBeat: draft.scope.terminalBeat,
          },
        };
      }
      const allowedNoteIds = resolvePracticeScopeCursorNoteIds(artifact, draft.scope);
      if (allowedNoteIds.length === 0) {
        return { status: 'invalid', reason: 'range_has_no_selectable_notes' };
      }
      return {
        status: 'ready',
        scope: {
          kind: 'RANGE',
          startBeat: draft.scope.startBeat,
          terminalBeat: draft.scope.terminalBeat,
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
  }, [artifact, draft]);
  const shareVideoSession = useMemo(
    () => {
      if (!draft || !artifact) return null;
      try {
        return createShareVideoSessionFromCompletedPerformance(draft, artifact);
      } catch {
        return null;
      }
    },
    [artifact, draft]
  );

  const isRevisionMismatched = useMemo(() => {
    if (!isValidDraft || !draft || !artifact) return false;
    if (artifact.scoreId !== draft.scoreId) return true;
    if (artifact.artifactId !== draft.artifactId) return true;
    return artifact.revisionId !== draft.revisionId;
  }, [artifact, draft, isValidDraft]);

  const isScoreIdentityConfirmed = useMemo(() => {
    if (!isValidDraft || !draft || !artifact || !xmlContent || isRevisionMismatched) {
      return false;
    }
    return (
      artifact.scoreId === draft.scoreId &&
      artifact.artifactId === draft.artifactId &&
      artifact.revisionId === draft.revisionId
    );
  }, [artifact, draft, isRevisionMismatched, isValidDraft, xmlContent]);

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
    if (!isScoreIdentityConfirmed || !draft?.evaluation) {
      return {
        confirmedCorrectNoteIds: [],
        confirmedErrorNoteIds: [],
      };
    }
    return noteAnnotationsFromPerformanceOutcomes(draft.evaluation.outcomes);
  }, [draft, isScoreIdentityConfirmed]);

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
          confirmedCorrectNoteIds: [],
          confirmedErrorNoteIds: [],
        }, {
          renderRevision: scoreRenderRevisionRef.current,
        });
        return;
      }
      annotationController.apply(container, {
        confirmedCorrectNoteIds: scoreNoteAnnotations.confirmedCorrectNoteIds,
        confirmedErrorNoteIds: scoreNoteAnnotations.confirmedErrorNoteIds,
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
      if (!container || !draft) return;
      if (
        replayTimeMs === null ||
        !isScoreIdentityConfirmed ||
        cursorScopeResolution.status !== 'ready'
      ) {
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
      const scopeStartMs = resolveScopeTiming(
        draft.scope,
        draft.tempoPlan,
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
      draft,
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
        confirmedCorrectNoteIds: [],
        confirmedErrorNoteIds: [],
      }, {
        renderRevision: scoreRenderRevisionRef.current,
      });
      playheadController.clear(container);
      return;
    }
    annotationController.apply(container, {
      confirmedCorrectNoteIds: scoreNoteAnnotations.confirmedCorrectNoteIds,
      confirmedErrorNoteIds: scoreNoteAnnotations.confirmedErrorNoteIds,
    }, {
      renderRevision: scoreRenderRevisionRef.current,
    });
  }, [annotationController, isScoreIdentityConfirmed, playheadController, scoreNoteAnnotations]);

  const replay = useMemo<PlayablePerformanceReplay | null>(() => {
    if (!draft) {
      return null;
    }
    if (draft.media.status === 'READY' && draft.media.kind === 'VIDEO') {
      return {
        kind: 'VIDEO_RECORDING',
        blob: draft.media.blob,
        contentType: draft.media.mimeType,
        byteSize: draft.media.blob.size,
        durationMs: draft.media.durationMs,
      };
    }
    if (draft.media.status !== 'READY' || draft.media.kind !== 'AUDIO') {
      return null;
    }
    return {
      kind: 'AUDIO_RECORDING',
      blob: draft.media.blob,
      contentType: draft.media.mimeType,
      byteSize: draft.media.blob.size,
      durationMs: draft.media.durationMs,
    };
  }, [draft]);

  const saveMedia = useMemo(() => {
    if (draft?.media.status === 'READY') {
      return {
        kind: draft.media.kind,
        blob: draft.media.blob,
        mimeType: draft.media.mimeType,
        durationMs: draft.media.durationMs,
      };
    }
    return null;
  }, [draft]);

  const clientRequestIdRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const saveMutation = useSavePerformanceTake();

  const handleExportOriginalVideo = useCallback(() => {
    if (
      draft?.media.status !== 'READY' ||
      draft.media.kind !== 'VIDEO' ||
      draft.media.blob.size <= 0
    ) {
      return;
    }
    const url = URL.createObjectURL(draft.media.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-video-${Date.now()}.${extensionForMime(draft.media.mimeType)}`;
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

    try {
      await saveMutation.mutateAsync({
        scoreId: id,
        revisionId: draft.revisionId,
        artifactId: draft.artifactId,
        clientRequestId: clientRequestIdRef.current ?? '',
        mediaKind: saveMedia.kind,
        mediaBlob: saveMedia.blob,
        mimeType: saveMedia.mimeType,
        durationMs: saveMedia.durationMs,
        scope:
          draft.scope.kind === 'RANGE'
            ? {
                kind: 'RANGE',
                startBeat: draft.scope.startBeat,
                terminalBeat: draft.scope.terminalBeat,
                startGroupId: draft.scope.startGroupId,
                endGroupId: draft.scope.endGroupId,
              }
            : {
                kind: 'FULL',
                startBeat: draft.scope.startBeat,
                terminalBeat: draft.scope.terminalBeat,
              },
        tempoPlan: toPerformanceTakeTempoPlan(draft.tempoPlan),
        recordingTimebase: draft.recordingTimebase,
      });
      setSaveStatus('saved');
    } catch (err: unknown) {
      setSaveStatus('error');
      setSaveErrorMessage(
        err instanceof Error ? err.message : t('savePerformanceFailed')
      );
    }
  }, [draft, id, saveMedia, saveMutation, saveStatus, t]);

  const performLeave = useCallback((target: 'score' | 'practice') => {
    completedPerformanceStore.clearPerformance();
    router.push(target === 'score' ? `/score/${id}` : `/score/${id}/practice`);
  }, [id, router]);

  const requestLeave = useCallback(
    (target: 'score' | 'practice') => {
      const hasUncommittedMedia = Boolean(
        draft &&
          draft.media.status === 'READY' &&
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

  const hasUncommittedReviewMedia = Boolean(
    draft &&
      draft.media.status === 'READY' &&
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

  const outcomes = draft.evaluation.outcomes;
  const strikeSummary = buildFeedbackSummary({
    artifact: isScoreIdentityConfirmed ? artifact : null,
    scope: draft.scope,
    outcomes,
  });

  const tempoText =
    draft.tempoPlan.selection.mode === 'CUSTOM_FIXED_BPM'
      ? `${draft.tempoPlan.selection.bpm} BPM`
      : '原曲速度';

  const scopeText = draft.scope.kind === 'RANGE'
    ? `${t('scopeSection')} (${draft.scope.startBeat} - ${draft.scope.terminalBeat} 拍)`
    : `${t('scopeFull')} (${draft.scope.startBeat} - ${draft.scope.terminalBeat} 拍)`;

  const inputSourceText =
    draft.inputSource === 'MICROPHONE'
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

      {/* Strike-level performance summary */}
      <div className={strikeSummary.unconfirmedStrikeCount > 0
        ? 'grid grid-cols-2 gap-4 sm:grid-cols-5'
        : 'grid grid-cols-2 gap-4 sm:grid-cols-4'}>
        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('targetStrikes')}
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">
              {strikeSummary.targetStrikeCount}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('confirmedCorrectStrikes')}
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-green-600">
              {strikeSummary.correctStrikeCount}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('missingStrikes')}
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-red-600">
              {strikeSummary.missingStrikeCount}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t('extraPitchCount')}
            </CardTitle>
            <Music className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-amber-600">
              {strikeSummary.extraPitchCount}
            </div>
          </CardContent>
        </Card>

        {strikeSummary.unconfirmedStrikeCount > 0 ? (
          <Card className="rounded-lg bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {t('unconfirmedStrikes')}
              </CardTitle>
              <Clock className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-slate-600">
                {strikeSummary.unconfirmedStrikeCount}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {strikeSummary.unconfirmedStrikeCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('unconfirmedStrikesDesc')}
        </p>
      ) : null}

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
              {draft.media.status === 'UNAVAILABLE' &&
              (draft.media.reason === 'PERMISSION_DENIED' ||
                draft.media.reason === 'NotAllowedError')
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
              <div className="font-semibold">{formatDuration(draft.activeElapsedMs)}</div>
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
          {draft.media.status === 'READY' && draft.media.kind === 'VIDEO' ? (
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

      {draft.media.status === 'READY' && draft.media.kind === 'VIDEO' ? (
        <ShareVideoStudio
          key={draft.localSessionId}
          session={shareVideoSession}
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
