'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Music2,
  Play,
  Save,
  Target,
  XCircle,
} from 'lucide-react';

import { PreviewLoading, ResourceLoading } from '@/components/loading';
import { PerformanceReplayPlayer } from '@/components/practice/performance-replay-player';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page';
import { ScoreSurface } from '@/components/score/score-surface';
import { EmptyState, SectionErrorState } from '@/components/states';
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { useToast } from '@/hooks/use-toast';
import { practiceApi } from '@/lib/api';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';
import { readPlayablePerformanceReplay } from '@/lib/practice/local-performance-replay-store';
import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';
import { PerformancePlayheadController } from '@/lib/practice/performance-playhead-controller';
import type { PracticePerformanceTimelinePayload } from '@/lib/practice/protocol';
import {
  buildSavedPerformanceReplayUpload,
  checksumSha256Hex,
  readSavedPerformanceReplay,
} from '@/lib/practice/saved-performance-replay';
import { PracticeSummaryAnnotationController } from '@/lib/practice/summary-annotation-controller';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import type {
  PracticeSessionSummaryMeasureRead,
  PracticeSessionSummaryPayloadRead,
  PracticeSessionSummaryTargetRead,
  PracticeSessionDetailRead,
  PracticePerformanceTimelineRead,
  SavedPracticeReplayArtifactRead,
} from '@/generated/practice-api';

type MetricValue = PracticeSessionSummaryPayloadRead['metrics'][string];

const EvidenceMetric = ({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ElementType;
  title: string;
  value: string;
  detail?: string;
}) => {
  const Icon = icon;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
        <Icon className="h-4 w-4 text-orange-500" />
        <span>{title}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
};

const TextCard = ({
  icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) => {
  const Icon = icon;
  return (
    <Card className="rounded-lg bg-white shadow-sm">
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <Icon className="h-5 w-5 text-orange-500" />
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};

function metric(metrics: PracticeSessionSummaryPayloadRead['metrics'], key: string): MetricValue {
  return metrics[key];
}

function formatNumber(value: MetricValue): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (typeof value === 'string') {
    return value;
  }
  return 'n/a';
}

function numberMetric(
  metrics: PracticeSessionSummaryPayloadRead['metrics'],
  key: string
): number | null {
  const value = metric(metrics, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatReplayTimeLabel(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatMeasureLabel(measureNumber: string): string {
  return measureNumber === 'unknown' ? 'n/a' : measureNumber;
}

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function findSummaryNoteElement(container: HTMLElement, verovioId: string) {
  return (
    container.querySelector<HTMLElement>(`[data-id="${verovioId}"]`) ??
    container.querySelector<HTMLElement>(`#${escapeCssId(verovioId)}`)
  );
}

function annotationNoteIds(summary: PracticeSessionSummaryPayloadRead | null): {
  confirmedCorrectNoteIds: string[];
  confirmedErrorNoteIds: string[];
} {
  const confirmedCorrectNoteIds: string[] = [];
  const confirmedErrorNoteIds: string[] = [];
  for (const target of summary?.targets ?? []) {
    confirmedCorrectNoteIds.push(...(target.confirmed_correct_render_note_ids ?? []));
    confirmedErrorNoteIds.push(...(target.confirmed_error_render_note_ids ?? []));
  }
  return {
    confirmedCorrectNoteIds: Array.from(new Set(confirmedCorrectNoteIds)),
    confirmedErrorNoteIds: Array.from(new Set(confirmedErrorNoteIds)),
  };
}

function reviewReasonKey(measure: PracticeSessionSummaryMeasureRead): string {
  if (measure.incomplete_target_count > 0) {
    return 'reviewReasonIncomplete';
  }
  if (measure.mismatch_attempt_count > 0) {
    return 'reviewReasonWrongNotes';
  }
  if (measure.partial_attempt_count > 0) {
    return 'reviewReasonPartialNotes';
  }
  return 'reviewReasonNeedsAttention';
}

function targetsForMeasure(
  summary: PracticeSessionSummaryPayloadRead | null,
  measureNumber: string
): PracticeSessionSummaryTargetRead[] {
  return (summary?.targets ?? []).filter((target) =>
    (target.measure_numbers ?? []).includes(measureNumber)
  );
}

function unexpectedPitchesForMeasure(
  summary: PracticeSessionSummaryPayloadRead | null,
  measureNumber: string
): string[] {
  return targetsForMeasure(summary, measureNumber).flatMap(
    (target) => target.unexpected_pitches ?? []
  );
}

function missingPitchesForMeasure(
  summary: PracticeSessionSummaryPayloadRead | null,
  measureNumber: string
): string[] {
  return targetsForMeasure(summary, measureNumber).flatMap(
    (target) => target.missing_pitches ?? []
  );
}

function formatPitchCounts(pitches: string[]): string {
  const counts = new Map<string, number>();
  for (const pitch of pitches) {
    counts.set(pitch, (counts.get(pitch) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([pitch, count]) => (count > 1 ? `${pitch} x${count}` : pitch))
    .join(', ');
}

type PerformanceFact = {
  icon: React.ElementType;
  titleKey: string;
  value?: string;
  detailKey?: string;
  detailValues?: Record<string, string | number>;
};

function performanceFacts(summary: PracticeSessionSummaryPayloadRead): PerformanceFact[] {
  const inputSource = metric(summary.metrics, 'input_source');
  if (inputSource !== 'MIDI') {
    return [];
  }

  const confirmedCorrectStrikes = numberMetric(
    summary.metrics,
    'confirmed_correct_strike_targets'
  );
  const missingStrikes = numberMetric(summary.metrics, 'missing_strike_targets');
  const extraPitchCount = numberMetric(summary.metrics, 'extra_pitch_count');
  const problemMeasureCount = numberMetric(summary.metrics, 'problem_measure_count');
  const facts: PerformanceFact[] = [];

  if (confirmedCorrectStrikes !== null) {
    facts.push({
      icon: CheckCircle2,
      titleKey: 'confirmedCorrectStrikes',
      value: formatNumber(confirmedCorrectStrikes),
    });
  }
  if (missingStrikes !== null) {
    facts.push({
      icon: XCircle,
      titleKey: 'missingStrikes',
      value: formatNumber(missingStrikes),
    });
  }
  if (extraPitchCount !== null) {
    facts.push({
      icon: AlertTriangle,
      titleKey: 'extraPitchCount',
      value: formatNumber(extraPitchCount),
      detailKey: problemMeasureCount !== null ? 'problemMeasureCount' : undefined,
      detailValues:
        problemMeasureCount !== null
          ? {
              count: formatNumber(problemMeasureCount),
            }
          : undefined,
    });
  }

  return facts;
}

function selectFocusTarget(
  summary: PracticeSessionSummaryPayloadRead | null,
  measureNumber: string
): PracticeSessionSummaryTargetRead | null {
  return targetsForMeasure(summary, measureNumber)[0] ?? null;
}

function scoreIdFromParams(params: ReturnType<typeof useParams>): string {
  const id = params.id;
  return Array.isArray(id) ? id[0] ?? '' : id ?? '';
}

function practiceTimelinePayload(
  timeline: PracticePerformanceTimelineRead | null | undefined
): PracticePerformanceTimelinePayload | null {
  if (!timeline) {
    return null;
  }
  return {
    scope_start_beat: timeline.scope_start_beat,
    scope_terminal_beat: timeline.scope_terminal_beat,
    segments: timeline.segments ?? [],
  };
}

export default function PracticeSummaryPage() {
  const t = useTranslations('practice');
  const errors = useTranslations('errors');
  const router = useRouter();
  const { toast } = useToast();
  const params = useParams();
  const routeScoreId = scoreIdFromParams(params);
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const [session, setSession] = useState<PracticeSessionDetailRead | null>(null);
  const [sessionLoadFailed, setSessionLoadFailed] = useState(false);
  const [hasRouteSessionMismatch, setHasRouteSessionMismatch] = useState(false);
  const scoreId = session?.score_id ?? routeScoreId;
  const revisionId = session?.revision_id ?? null;
  const revisionQuery = usePracticeReadyScoreContent(scoreId, revisionId);
  const xmlContent = revisionQuery.data?.data?.content ?? null;
  const isLoadingScore = Boolean(sessionId) && !sessionLoadFailed && (
    !session ||
    revisionQuery.isLoading
  );
  const [summary, setSummary] = useState<PracticeSessionSummaryPayloadRead | null>(null);
  const [performanceTimeline, setPerformanceTimeline] =
    useState<PracticePerformanceTimelinePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [savedReplayArtifact, setSavedReplayArtifact] =
    useState<SavedPracticeReplayArtifactRead | null>(null);
  const [savedPerformanceReplay, setSavedPerformanceReplay] =
    useState<PlayablePerformanceReplay | null>(null);
  const [isLoadingSavedReplay, setIsLoadingSavedReplay] = useState(false);
  const [savedReplayPlaybackFailed, setSavedReplayPlaybackFailed] = useState(false);
  const [autoStartSavedReplay, setAutoStartSavedReplay] = useState(false);
  const [isSavingReplay, setIsSavingReplay] = useState(false);
  const localPerformanceReplay = useMemo(
    () => readPlayablePerformanceReplay(sessionId),
    [sessionId]
  );
  const performanceReplay = localPerformanceReplay ?? savedPerformanceReplay;
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const annotationController = useMemo(
    () => new PracticeSummaryAnnotationController(),
    []
  );
  const performancePlayheadController = useMemo(
    () => new PerformancePlayheadController(),
    []
  );
  const annotationRenderNoteIds = useMemo(() => annotationNoteIds(summary), [summary]);
  const scoreContainerRef = useRef<HTMLDivElement | null>(null);
  const focusedNoteIdsRef = useRef<string[]>([]);
  const [renderRevision, setRenderRevision] = useState(0);
  const [focusedTarget, setFocusedTarget] = useState<PracticeSessionSummaryTargetRead | null>(
    null
  );
  const handleScoreRendered = useCallback(
    (_adapter: unknown, container: HTMLDivElement) => {
      scoreContainerRef.current = container;
      setRenderRevision((revision) => revision + 1);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      if (!sessionId) {
        setSession(null);
        setSessionLoadFailed(true);
        setHasRouteSessionMismatch(false);
        return;
      }

      try {
        setSessionLoadFailed(false);
        setHasRouteSessionMismatch(false);
        const response = await practiceApi.getPracticeSession(sessionId);
        if (!cancelled) {
          const loadedSession = response.data ?? null;
          const routeMismatch =
            Boolean(loadedSession) && loadedSession?.score_id !== routeScoreId;
          setSession(routeMismatch ? null : loadedSession);
          setSessionLoadFailed(!loadedSession);
          setHasRouteSessionMismatch(routeMismatch);
        }
      } catch (loadError) {
        if (!cancelled) {
          reportUnexpectedClientError(loadError, {
            area: 'practice',
            action: 'load_summary_session',
          });
          setSession(null);
          setSessionLoadFailed(true);
          setHasRouteSessionMismatch(false);
        }
      }
    };

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [routeScoreId, sessionId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const loadSummary = async () => {
      if (!sessionId) {
        setPerformanceTimeline(null);
        setPageError(t('summaryMissingSession'));
        setIsLoading(false);
        return;
      }
      if (hasRouteSessionMismatch) {
        setSummary(null);
        setPerformanceTimeline(null);
        setPageError(t('summaryInvalidSession'));
        setIsLoading(false);
        return;
      }
      if (!session && !sessionLoadFailed) {
        return;
      }
      if (!session && sessionLoadFailed) {
        setSummary(null);
        setPerformanceTimeline(null);
        setPageError(t('analysisFailedDesc'));
        setIsLoading(false);
        return;
      }
      if (session?.evaluation_profile !== 'PERFORMANCE') {
        setSummary(null);
        setPerformanceTimeline(null);
        setPageError(t('performanceReportUnavailableDesc'));
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setPageError(null);
        const response = await practiceApi.getPracticeSessionSummary(sessionId);
        const nextSummary = response.data;
        if (!cancelled) {
          const nextStatus = nextSummary?.summary_status ?? 'FAILED';
          setSummary(nextSummary?.summary_payload ?? null);
          setPerformanceTimeline(
            practiceTimelinePayload(nextSummary?.performance_timeline ?? null)
          );
          if (!nextSummary?.summary_payload) {
            if (nextStatus === 'PENDING' || nextStatus === 'NOT_REQUESTED') {
              retryTimer = setTimeout(loadSummary, 1000);
            }
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          reportUnexpectedClientError(loadError, {
            area: 'practice',
            action: 'load_summary',
          });
          setSummary(null);
          setPerformanceTimeline(null);
          setPageError(userFacingErrorMessage(errors, loadError, t('analysisFailedDesc')));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSummary();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [errors, hasRouteSessionMismatch, session, sessionId, sessionLoadFailed, t]);

  useEffect(() => {
    const container = scoreContainerRef.current;
    if (!container || renderRevision === 0) {
      return;
    }
    annotationController.apply(container, annotationRenderNoteIds);
    return () => annotationController.clear(container);
  }, [annotationController, annotationRenderNoteIds, renderRevision]);

  useEffect(() => {
    const container = scoreContainerRef.current;
    if (!container || renderRevision === 0) {
      return;
    }

    for (const noteId of focusedNoteIdsRef.current) {
      findSummaryNoteElement(container, noteId)?.classList.remove(
        'practice-summary-note-focused'
      );
    }

    const noteIds = focusedTarget?.render_note_ids ?? [];
    focusedNoteIdsRef.current = noteIds;
    for (const noteId of noteIds) {
      findSummaryNoteElement(container, noteId)?.classList.add(
        'practice-summary-note-focused'
      );
    }

    return () => {
      for (const noteId of noteIds) {
        findSummaryNoteElement(container, noteId)?.classList.remove(
          'practice-summary-note-focused'
        );
      }
    };
  }, [focusedTarget, renderRevision]);

  useEffect(() => {
    let cancelled = false;

    const loadSavedReplayArtifact = async () => {
      setSavedPerformanceReplay(null);
      setSavedReplayArtifact(null);
      setSavedReplayPlaybackFailed(false);
      setAutoStartSavedReplay(false);
      if (
        !sessionId ||
        localPerformanceReplay ||
        session?.state !== 'FINISHED' ||
        session.evaluation_profile !== 'PERFORMANCE'
      ) {
        return;
      }

      try {
        const artifactsResponse = await practiceApi.listPracticeReplayArtifacts(sessionId);
        const artifact =
          artifactsResponse.data?.find((candidate) => candidate.input_source === session.input_source) ??
          null;
        if (!cancelled) {
          setSavedReplayArtifact(artifact);
        }
      } catch (loadSavedReplayError) {
        reportUnexpectedClientError(loadSavedReplayError, {
          area: 'practice',
          action: 'list_saved_performance_replay',
        });
        if (!cancelled) {
          setSavedReplayArtifact(null);
        }
      }
    };

    void loadSavedReplayArtifact();

    return () => {
      cancelled = true;
    };
  }, [localPerformanceReplay, session, sessionId]);

  const handlePlaySavedReplay = useCallback(() => {
    if (!sessionId || !savedReplayArtifact || isLoadingSavedReplay) {
      return;
    }

    const play = async () => {
      try {
        setIsLoadingSavedReplay(true);
        setSavedReplayPlaybackFailed(false);
        setAutoStartSavedReplay(false);
        const playbackResponse = await practiceApi.getPracticeReplayArtifactPlaybackUrl(
          sessionId,
          savedReplayArtifact.artifact_id
        );
        if (!playbackResponse.data) {
          throw new Error('saved replay playback URL missing');
        }
        const replay = await readSavedPerformanceReplay(
          savedReplayArtifact,
          playbackResponse.data.playback_url
        );
        setSavedPerformanceReplay(replay);
        setSavedReplayPlaybackFailed(false);
        setAutoStartSavedReplay(true);
      } catch (loadSavedReplayError) {
        reportUnexpectedClientError(loadSavedReplayError, {
          area: 'practice',
          action: 'play_saved_performance_replay',
        });
        setSavedPerformanceReplay(null);
        setSavedReplayPlaybackFailed(true);
        setAutoStartSavedReplay(false);
      } finally {
        setIsLoadingSavedReplay(false);
      }
    };

    void play();
  }, [isLoadingSavedReplay, savedReplayArtifact, sessionId]);

  const focusMeasureTarget = useCallback(
    (measureNumber: string) => {
      const target = selectFocusTarget(summary, measureNumber);
      const container = scoreContainerRef.current;
      if (!target || !container) {
        return;
      }

      setFocusedTarget(target);
      const firstNote = (target.render_note_ids ?? [])
        .map((noteId) => findSummaryNoteElement(container, noteId))
        .find((node): node is HTMLElement => Boolean(node));
      firstNote?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
      firstNote?.focus?.({ preventScroll: true });
    },
    [summary]
  );

  const handleReplayTimeChange = useCallback(
    (replayTimeMs: number | null) => {
      const container = scoreContainerRef.current;
      if (!container || renderRevision === 0) {
        return;
      }
      if (replayTimeMs === null || !performanceTimeline || !performanceReplay) {
        performancePlayheadController.clear(container);
        return;
      }
      performancePlayheadController.applyPerformanceTime(
        container,
        adapter,
        replayTimeMs * performanceReplay.timebase.speedRatio,
        performanceTimeline
      );
    },
    [
      adapter,
      performancePlayheadController,
      performanceReplay,
      performanceTimeline,
      renderRevision,
    ]
  );

  useEffect(() => {
    const container = scoreContainerRef.current;
    return () => {
      if (container) {
        performancePlayheadController.clear(container);
      }
    };
  }, [performancePlayheadController, performanceReplay, renderRevision]);

  const handleSaveReplay = useCallback(async () => {
    if (!sessionId || !localPerformanceReplay) {
      return;
    }

    try {
      setIsSavingReplay(true);
      const upload = buildSavedPerformanceReplayUpload(localPerformanceReplay);
      const checksumSha256 = await checksumSha256Hex(upload.file);
      const authorizationResponse = await practiceApi.authorizePracticeReplayUpload(sessionId, {
        kind: upload.kind,
        content_type: upload.contentType,
        byte_size: upload.file.size,
        checksum_sha256: checksumSha256,
        duration_ms: upload.durationMs,
        timebase_version: upload.timebaseVersion,
        format_version: upload.formatVersion,
      });
      const authorization = authorizationResponse.data;
      if (!authorization) {
        throw new Error('practice replay upload authorization missing');
      }
      await practiceApi.uploadPracticeReplayObject(
        authorization.upload_url,
        upload.file,
        authorization.upload_headers
      );
      const response = await practiceApi.finalizePracticeReplayArtifact(sessionId, {
        artifact_id: authorization.artifact_id,
        kind: upload.kind,
        content_type: upload.contentType,
        byte_size: upload.file.size,
        checksum_sha256: checksumSha256,
        duration_ms: upload.durationMs,
        timebase_version: upload.timebaseVersion,
        format_version: upload.formatVersion,
      });
      if (response.data) {
        setSavedReplayArtifact(response.data);
      }
      toast({
        title: t('savePerformanceSuccessTitle'),
        description: t('savePerformanceSuccessDesc'),
      });
    } catch (saveError) {
      reportUnexpectedClientError(saveError, {
        area: 'practice',
        action: 'save_performance_replay',
      });
      toast({
        title: t('savePerformanceFailedTitle'),
        description: userFacingErrorMessage(errors, saveError, t('savePerformanceFailedDesc')),
        variant: 'destructive',
      });
    } finally {
      setIsSavingReplay(false);
    }
  }, [errors, localPerformanceReplay, sessionId, t, toast]);

  const difficultMeasures = summary?.difficult_measures ?? [];
  const facts = summary ? performanceFacts(summary) : [];
  const hasReplayCard = Boolean(performanceReplay || savedReplayArtifact);
  const hasSummaryCard = facts.length > 0;
  const hasSidebar = hasReplayCard || hasSummaryCard;
  const contentGridClassName = hasSidebar
    ? 'grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]'
    : 'grid grid-cols-1 gap-6';
  const canSaveReplay =
    Boolean(localPerformanceReplay) &&
    session?.evaluation_profile === 'PERFORMANCE' &&
    session?.state === 'FINISHED';

  return (
    <ScoreSurface>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title={t('performanceSummaryTitle')}
          description={t('performanceSummarySubtitle')}
          actions={
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToPractice')}
            </Button>
          }
        />
        {isLoading && !session && (
          <ResourceLoading label={t('loadingSummary')} minHeight="md" />
        )}

        {!isLoading && pageError && (
          <SectionErrorState title={t('analysisFailedTitle')} description={pageError} />
        )}

        {!pageError && session && (
          <div className="space-y-6">
            <div className={contentGridClassName}>
              <div className="space-y-6">
                <TextCard icon={Music2} title={t('scoreAnnotations')}>
                <style jsx global>{`
                .practice-summary-score-svg .practice-summary-note-confirmed-correct {
                  fill: #16a34a !important;
                  stroke: #15803d !important;
                  stroke-width: 2px !important;
                  opacity: 1 !important;
                  filter: drop-shadow(0 0 5px rgba(22, 163, 74, 0.35));
                }
                .practice-summary-score-svg .practice-summary-note-confirmed-correct use,
                .practice-summary-score-svg .practice-summary-note-confirmed-correct path,
                .practice-summary-score-svg .practice-summary-note-confirmed-correct ellipse,
                .practice-summary-score-svg .practice-summary-note-confirmed-correct circle,
                .practice-summary-score-svg .practice-summary-note-confirmed-correct polygon,
                .practice-summary-score-svg .practice-summary-note-confirmed-correct rect,
                .practice-summary-score-svg .practice-summary-note-confirmed-correct line,
                .practice-summary-score-svg .practice-summary-note-confirmed-correct polyline {
                  fill: #16a34a !important;
                  stroke: #15803d !important;
                  opacity: 1 !important;
                }
                .practice-summary-score-svg .practice-summary-note-confirmed-error {
                  fill: #dc2626 !important;
                  stroke: #b91c1c !important;
                  stroke-width: 2px !important;
                  opacity: 1 !important;
                  filter: drop-shadow(0 0 5px rgba(220, 38, 38, 0.45));
                }
                .practice-summary-score-svg .practice-summary-note-confirmed-error use,
                .practice-summary-score-svg .practice-summary-note-confirmed-error path,
                .practice-summary-score-svg .practice-summary-note-confirmed-error ellipse,
                .practice-summary-score-svg .practice-summary-note-confirmed-error circle,
                .practice-summary-score-svg .practice-summary-note-confirmed-error polygon,
                .practice-summary-score-svg .practice-summary-note-confirmed-error rect,
                .practice-summary-score-svg .practice-summary-note-confirmed-error line,
                .practice-summary-score-svg .practice-summary-note-confirmed-error polyline {
                  fill: #dc2626 !important;
                  stroke: #b91c1c !important;
                  opacity: 1 !important;
                }
                .practice-summary-score-svg .practice-summary-note-focused {
                  outline: 3px solid #2563eb;
                  outline-offset: 4px;
                  filter: drop-shadow(0 0 7px rgba(37, 99, 235, 0.5));
                }
                .practice-summary-score-svg .practice-note-active {
                  fill: #f97316 !important;
                  stroke: #ea580c !important;
                  stroke-width: 2px !important;
                  opacity: 1 !important;
                  filter: drop-shadow(0 0 6px rgba(249, 115, 22, 0.65));
                }
                .practice-summary-score-svg .practice-note-active use,
                .practice-summary-score-svg .practice-note-active path,
                .practice-summary-score-svg .practice-note-active ellipse,
                .practice-summary-score-svg .practice-note-active circle,
                .practice-summary-score-svg .practice-note-active polygon,
                .practice-summary-score-svg .practice-note-active rect,
                .practice-summary-score-svg .practice-note-active line,
                .practice-summary-score-svg .practice-note-active polyline {
                  fill: #f97316 !important;
                  stroke: #ea580c !important;
                  opacity: 1 !important;
                }
                .practice-summary-score-svg svg {
                  display: block;
                  width: 100% !important;
                  height: auto;
                }
                `}</style>
                <VerovioScoreViewer
                  xmlContent={xmlContent}
                  isLoading={isLoadingScore}
                  adapterFactory={adapterFactory}
                  pageDataAttribute="data-practice-summary-page"
                  onRendered={handleScoreRendered}
                  className="max-h-[44rem] overflow-auto rounded-md border border-border bg-white"
                  pagesClassName="gap-4 p-4"
                  pageClassName="w-full overflow-hidden bg-white"
                  svgClassName="practice-summary-score-svg"
                  loadingContent={
                    <PreviewLoading label={t('loadingSummaryScore')} className="min-h-80" />
                  }
                  emptyContent={
                    <EmptyState title={t('scoreAnnotationsUnavailable')} className="min-h-80" />
                  }
                  errorMessage={t('scoreAnnotationsUnavailable')}
                  renderError={(message) => (
                    <div className="flex min-h-80 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                      {message}
                    </div>
                  )}
                />
                </TextCard>

                {summary && difficultMeasures.length > 0 ? (
                  <TextCard icon={Target} title={t('performanceProblemMeasures')}>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {difficultMeasures.slice(0, 6).map((measure) => {
                        const missingPitches = missingPitchesForMeasure(
                          summary,
                          measure.measure_number
                        );
                        const unexpectedPitches = unexpectedPitchesForMeasure(
                          summary,
                          measure.measure_number
                        );
                        return (
                          <div
                            key={measure.measure_number}
                            className="rounded-md border border-border px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">
                                  {t('measureNumber', {
                                    number: formatMeasureLabel(measure.measure_number),
                                  })}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t(reviewReasonKey(measure))}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => focusMeasureTarget(measure.measure_number)}
                              >
                                <Target className="mr-2 h-3.5 w-3.5" />
                                {t('focusMeasure')}
                              </Button>
                            </div>
                            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                              <div>
                                <dt className="text-muted-foreground">{t('mismatches')}</dt>
                                <dd className="mt-1 font-medium">
                                  {measure.mismatch_attempt_count}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">{t('partials')}</dt>
                                <dd className="mt-1 font-medium">
                                  {measure.partial_attempt_count}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">{t('attempts')}</dt>
                                <dd className="mt-1 font-medium">{measure.attempt_count}</dd>
                              </div>
                            </dl>
                            {missingPitches.length > 0 ? (
                              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                                <span className="font-medium text-red-900">
                                  {t('missingPitchesLabel')}
                                </span>{' '}
                                {formatPitchCounts(missingPitches)}
                              </p>
                            ) : null}
                            {unexpectedPitches.length > 0 ? (
                              <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {t('unexpectedPitchesLabel')}
                                </span>{' '}
                                {formatPitchCounts(unexpectedPitches)}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </TextCard>
                ) : null}
              </div>

              {hasSidebar ? (
              <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
                {performanceReplay ? (
                  <TextCard icon={Music2} title={t('playback')}>
                    <PerformanceReplayPlayer
                      replay={performanceReplay}
                      autoStart={Boolean(savedPerformanceReplay && autoStartSavedReplay)}
                      onReplayTimeChange={handleReplayTimeChange}
                      actions={
                        <div className="flex flex-wrap items-center gap-2">
                          {!savedReplayArtifact && canSaveReplay ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-10"
                              onClick={handleSaveReplay}
                              disabled={isSavingReplay}
                            >
                              {isSavingReplay ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="mr-2 h-4 w-4" />
                              )}
                              {t('savePerformance')}
                            </Button>
                          ) : null}
                        </div>
                      }
                    />
                  </TextCard>
                ) : savedReplayArtifact ? (
                  <TextCard icon={Music2} title={t('playback')}>
                    <div className="space-y-4">
                      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-sm tabular-nums text-slate-600">
                        <span>0:00</span>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, Math.round(savedReplayArtifact.duration_ms))}
                          step={50}
                          value={0}
                          readOnly
                          className="h-2 w-full accent-orange-500"
                          aria-label={t('replaySeek')}
                          disabled
                        />
                        <span>{formatReplayTimeLabel(savedReplayArtifact.duration_ms)}</span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-10 w-24"
                          onClick={handlePlaySavedReplay}
                          disabled={isLoadingSavedReplay}
                        >
                          {isLoadingSavedReplay ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="mr-2 h-4 w-4" />
                          )}
                          {t('playReplay')}
                        </Button>
                      </div>
                      {savedReplayPlaybackFailed ? (
                        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                          {t('savedReplayPlaybackFailed')}
                        </p>
                      ) : null}
                    </div>
                  </TextCard>
                ) : null}

                {hasSummaryCard ? (
                  <TextCard icon={FileText} title={t('summary')}>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3">
                        {facts.map((fact) => (
                          <EvidenceMetric
                            key={fact.titleKey}
                            icon={fact.icon}
                            title={t(fact.titleKey)}
                            value={fact.value ?? 'n/a'}
                            detail={
                              fact.detailKey
                                ? t(fact.detailKey, fact.detailValues)
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </TextCard>
                ) : null}
              </aside>
              ) : null}
            </div>

          </div>
        )}
      </div>
    </ScoreSurface>
  );
}
