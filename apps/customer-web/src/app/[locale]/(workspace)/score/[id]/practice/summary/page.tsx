'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Gauge,
  Lightbulb,
  ListChecks,
  Music2,
  Target,
  XCircle,
} from 'lucide-react';

import { PreviewLoading, ResourceLoading } from '@/components/loading';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page';
import { ScoreSurface } from '@/components/score/score-surface';
import { EmptyState, SectionErrorState } from '@/components/states';
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { practiceApi } from '@/lib/api';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';
import { practiceSummaryArtifactForSession } from '@/lib/practice/summary-artifact';
import { PracticeSummaryAnnotationController } from '@/lib/practice/summary-annotation-controller';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import type {
  PracticeSessionSummaryAttemptRead,
  PracticeSessionSummaryMeasureRead,
  PracticeSessionSummaryPayloadRead,
  PracticeSessionSummaryTargetRead,
  PracticeSessionDetailRead,
} from '@/generated/practice-api';

type MetricValue = PracticeSessionSummaryPayloadRead['metrics'][string];

const SummaryCard = ({
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
    <Card className="rounded-lg bg-white shadow-sm">
      <CardHeader className="flex flex-row items-center gap-3 pb-1">
        <Icon className="h-5 w-5 text-orange-500" />
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
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

const AttemptStatusIcon = ({ attempt }: { attempt: PracticeSessionSummaryAttemptRead }) => {
  if (attempt.completion_status === 'INTERRUPTED') {
    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  }
  if (attempt.result === 'MATCH') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  if (attempt.result === 'MISMATCH') {
    return <XCircle className="h-4 w-4 text-red-500" />;
  }
  return <Music2 className="h-4 w-4 text-orange-500" />;
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

function formatPercent(value: MetricValue): string {
  if (typeof value !== 'number') {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
}

function formatAttemptNotes(attempt: PracticeSessionSummaryAttemptRead): string {
  if (attempt.render_note_ids && attempt.render_note_ids.length > 0) {
    return attempt.render_note_ids.join(', ');
  }
  return attempt.event_id ?? attempt.expected_group_id ?? `#${attempt.attempt_index}`;
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
  problemNoteIds: string[];
  reviewNoteIds: string[];
} {
  const problemNoteIds: string[] = [];
  const reviewNoteIds: string[] = [];
  for (const target of summary?.targets ?? []) {
    const noteIds = target.render_note_ids ?? [];
    const hasScorableIssue =
      target.scorable_attempt_count > 0 &&
      (target.partial_attempt_count > 0 || target.mismatch_attempt_count > 0);
    if (!hasScorableIssue) {
      continue;
    }
    if (target.completed) {
      reviewNoteIds.push(...noteIds);
    } else {
      problemNoteIds.push(...noteIds);
    }
  }
  return {
    problemNoteIds: Array.from(new Set(problemNoteIds)),
    reviewNoteIds: Array.from(new Set(reviewNoteIds)),
  };
}

function targetHasScorableIssue(target: PracticeSessionSummaryTargetRead): boolean {
  return (
    target.scorable_attempt_count > 0 &&
    (target.partial_attempt_count > 0 || target.mismatch_attempt_count > 0)
  );
}

function targetNeedsProblemAnnotation(target: PracticeSessionSummaryTargetRead): boolean {
  return targetHasScorableIssue(target) && !target.completed;
}

function targetNeedsReviewAnnotation(target: PracticeSessionSummaryTargetRead): boolean {
  return targetHasScorableIssue(target) && target.completed;
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

function selectFocusTarget(
  summary: PracticeSessionSummaryPayloadRead | null,
  measureNumber: string
): PracticeSessionSummaryTargetRead | null {
  const targets = targetsForMeasure(summary, measureNumber).filter(targetHasScorableIssue);
  return (
    targets.find(targetNeedsProblemAnnotation) ??
    targets.find(targetNeedsReviewAnnotation) ??
    targets[0] ??
    null
  );
}

function scoreIdFromParams(params: ReturnType<typeof useParams>): string {
  const id = params.id;
  return Array.isArray(id) ? id[0] ?? '' : id ?? '';
}

export default function PracticeSummaryPage() {
  const t = useTranslations('practice');
  const errors = useTranslations('errors');
  const router = useRouter();
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const summaryArtifact = useMemo(
    () => practiceSummaryArtifactForSession(session),
    [session]
  );
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const annotationController = useMemo(
    () => new PracticeSummaryAnnotationController(),
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

    const loadSummary = async () => {
      if (!sessionId) {
        setError(t('summaryMissingSession'));
        setIsLoading(false);
        return;
      }
      if (hasRouteSessionMismatch) {
        setSummary(null);
        setError(t('summaryInvalidSession'));
        setIsLoading(false);
        return;
      }
      if (!session && !sessionLoadFailed) {
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const response = await practiceApi.getPracticeSessionSummary(sessionId);
        const nextSummary = response.data;
        if (!nextSummary?.summary_payload) {
          throw new Error(t('analysisFailedDesc'));
        }
        if (!cancelled) {
          setSummary(nextSummary.summary_payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          reportUnexpectedClientError(loadError, {
            area: 'practice',
            action: 'load_summary',
          });
          setError(userFacingErrorMessage(errors, loadError, t('analysisFailedDesc')));
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

  const attempts = summary?.attempts ?? [];
  const difficultMeasures = summary?.difficult_measures ?? [];

  return (
    <ScoreSurface>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title={t(summaryArtifact.titleKey)}
          description={t(summaryArtifact.subtitleKey)}
          actions={
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToPractice')}
            </Button>
          }
        />
        {isLoading && <ResourceLoading label={t('loadingSummary')} minHeight="md" />}

        {!isLoading && error && (
          <SectionErrorState title={t('analysisFailedTitle')} description={error} />
        )}

        {!isLoading && summary && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <SummaryCard
                icon={Target}
                title={t(summaryArtifact.completionLabelKey)}
                value={formatPercent(metric(summary.metrics, 'target_completion_rate'))}
                detail={t('summaryTargetCount', {
                  completed: formatNumber(metric(summary.metrics, 'completed_targets')),
                  total: formatNumber(metric(summary.metrics, 'target_count')),
                })}
              />
              <SummaryCard
                icon={Gauge}
                title={t(summaryArtifact.accuracyLabelKey)}
                value={formatPercent(metric(summary.metrics, 'match_rate'))}
                detail={t('summaryScorableAttempts', {
                  count: formatNumber(metric(summary.metrics, 'scorable_attempt_count')),
                })}
              />
              <SummaryCard
                icon={ListChecks}
                title={t(summaryArtifact.coverageLabelKey)}
                value={formatPercent(metric(summary.metrics, 'scoring_coverage'))}
                detail={t('summaryInterruptedCount', {
                  count: formatNumber(metric(summary.metrics, 'interrupted_attempts')),
                })}
              />
            </div>

            <TextCard icon={FileText} title={t('summary')}>
              <p className="text-sm leading-6 text-muted-foreground">{summary.summary}</p>
            </TextCard>

            <TextCard icon={Music2} title={t('scoreAnnotations')}>
              <style jsx global>{`
                .practice-summary-score-svg .practice-summary-note-problem {
                  fill: #dc2626 !important;
                  stroke: #b91c1c !important;
                  stroke-width: 2px !important;
                  opacity: 1 !important;
                  filter: drop-shadow(0 0 5px rgba(220, 38, 38, 0.45));
                }
                .practice-summary-score-svg .practice-summary-note-problem use,
                .practice-summary-score-svg .practice-summary-note-problem path,
                .practice-summary-score-svg .practice-summary-note-problem ellipse,
                .practice-summary-score-svg .practice-summary-note-problem circle,
                .practice-summary-score-svg .practice-summary-note-problem polygon,
                .practice-summary-score-svg .practice-summary-note-problem rect,
                .practice-summary-score-svg .practice-summary-note-problem line,
                .practice-summary-score-svg .practice-summary-note-problem polyline {
                  fill: #dc2626 !important;
                  stroke: #b91c1c !important;
                  opacity: 1 !important;
                }
                .practice-summary-score-svg .practice-summary-note-review {
                  fill: #f59e0b !important;
                  stroke: #d97706 !important;
                  stroke-width: 2px !important;
                  opacity: 1 !important;
                  filter: drop-shadow(0 0 5px rgba(245, 158, 11, 0.45));
                }
                .practice-summary-score-svg .practice-summary-note-review use,
                .practice-summary-score-svg .practice-summary-note-review path,
                .practice-summary-score-svg .practice-summary-note-review ellipse,
                .practice-summary-score-svg .practice-summary-note-review circle,
                .practice-summary-score-svg .practice-summary-note-review polygon,
                .practice-summary-score-svg .practice-summary-note-review rect,
                .practice-summary-score-svg .practice-summary-note-review line,
                .practice-summary-score-svg .practice-summary-note-review polyline {
                  fill: #f59e0b !important;
                  stroke: #d97706 !important;
                  opacity: 1 !important;
                }
                .practice-summary-score-svg .practice-summary-note-focused {
                  outline: 3px solid #2563eb;
                  outline-offset: 4px;
                  filter: drop-shadow(0 0 7px rgba(37, 99, 235, 0.5));
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
                className="max-h-[38rem] overflow-auto rounded-md border border-border bg-white"
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
              {annotationRenderNoteIds.problemNoteIds.length === 0 &&
              annotationRenderNoteIds.reviewNoteIds.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('scoreAnnotationsEmpty')}
                </p>
              ) : null}
            </TextCard>

            <TextCard icon={Target} title={t(summaryArtifact.difficultMeasuresLabelKey)}>
              {difficultMeasures.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t(summaryArtifact.difficultMeasuresEmptyKey)}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {difficultMeasures.slice(0, 6).map((measure) => {
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
                        <div className="flex shrink-0 gap-2">
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
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <dt className="text-muted-foreground">{t('mismatches')}</dt>
                          <dd className="mt-1 font-medium">{measure.mismatch_attempt_count}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t('partials')}</dt>
                          <dd className="mt-1 font-medium">{measure.partial_attempt_count}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t('attempts')}</dt>
                          <dd className="mt-1 font-medium">{measure.attempt_count}</dd>
                        </div>
                      </dl>
                    </div>
                    );
                  })}
                </div>
              )}
            </TextCard>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <TextCard icon={Music2} title={t('attempts')}>
                {attempts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('attemptsEmpty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs font-medium uppercase text-muted-foreground">
                          <th className="py-2 pr-3">{t('attempt')}</th>
                          <th className="py-2 pr-3">{t('target')}</th>
                          <th className="py-2 pr-3">{t('result')}</th>
                          <th className="py-2 pr-3">{t('completionStatus')}</th>
                          <th className="py-2 pr-3">{t('resolutionReason')}</th>
                          <th className="py-2 text-right">{t('confidence')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.map((attempt) => (
                          <tr key={attempt.attempt_uid} className="border-b last:border-0">
                            <td className="py-3 pr-3">
                              <div className="flex items-center gap-2">
                                <AttemptStatusIcon attempt={attempt} />
                                <span>{attempt.attempt_index}</span>
                              </div>
                            </td>
                            <td className="py-3 pr-3 text-muted-foreground">
                              {formatAttemptNotes(attempt)}
                            </td>
                            <td className="py-3 pr-3">{t(`attemptResult.${attempt.result}`)}</td>
                            <td className="py-3 pr-3">
                              {t(`attemptCompletion.${attempt.completion_status}`)}
                            </td>
                            <td className="py-3 pr-3 text-muted-foreground">
                              {t(`resolutionReasonValue.${attempt.resolution_reason}`)}
                            </td>
                            <td className="py-3 text-right">
                              {formatPercent(attempt.confidence)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TextCard>

              <TextCard icon={Lightbulb} title={t('recommendations')}>
                {summary.recommendations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t(summaryArtifact.recommendationsEmptyKey)}
                  </p>
                ) : (
                  <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                    {summary.recommendations.map((recommendation) => (
                      <li key={recommendation}>{recommendation}</li>
                    ))}
                  </ul>
                )}
              </TextCard>
            </div>

            <TextCard icon={ListChecks} title={t('metrics')}>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  'attempt_count',
                  'scorable_attempt_count',
                  'target_count',
                  'scorable_target_count',
                  'scorable_target_completion_rate',
                  'scoring_policy_version',
                ].map((key) => (
                  <div key={key} className="rounded-md border border-border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{key}</dt>
                    <dd className="mt-1 font-medium">{formatNumber(metric(summary.metrics, key))}</dd>
                  </div>
                ))}
              </dl>
            </TextCard>
          </div>
        )}
      </div>
    </ScoreSurface>
  );
}
