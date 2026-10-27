'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

import { PreviewLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { useIsMobile } from '@/hooks/use-mobile';
import { StepPlayheadController } from '@/lib/practice/score-view/step-playhead-controller';
import { PerformancePlayheadController } from '@/lib/practice/score-view/performance-playhead-controller';
import {
  EvaluationAnnotationController,
  noteAnnotationsFromLiveFeedback,
} from '@/lib/practice/score-view/evaluation-annotations';
import { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';
import { syncRangeOverlay, clearRangeOverlay, isRangeBackgroundMutation } from '@/lib/practice/score-view/range-overlay';
import { SCORE_DECORATIONS } from '@/lib/practice/score-view/decorations';
import { cn } from '@/lib/utils';
import type { ExpectedPracticeGroup } from '@/lib/practice/kernel/artifact';
import type { PracticeMode } from '@/lib/practice/kernel/session';
import type { CursorScope } from '@/lib/practice/score-view/cursor-scope';
import type { ContinuousLiveFeedback } from '@/lib/practice/continuous/domain/evaluation/live-feedback';

import type { ContinuousPracticeLifecycle } from '@/lib/practice/continuous/domain/session';
import type { StepControllerState } from '@/lib/practice/step/step-practice-controller';

type PracticeScoreViewerProps = {
  className?: string;
  sessionStatus?: ReactNode;
  xmlContent: string | null;
  isLoadingXml: boolean;
  lifecycle: ContinuousPracticeLifecycle | StepControllerState;
  sessionMode: PracticeMode;
  activeStepGroup?: ExpectedPracticeGroup | null;
  performanceMusicalBeat?: number | null;
  performanceScope?: CursorScope | null;
  performanceEvaluation?: ContinuousLiveFeedback | null;
  showContinuousFeedback?: boolean;
  selectedRangeRenderNoteIds?: readonly string[];
  onRenderNoteClick?: (renderNoteId: string) => void;
};

export function PracticeScoreViewer({
  className,
  sessionStatus = null,
  xmlContent,
  isLoadingXml,
  lifecycle,
  sessionMode,
  activeStepGroup = null,
  performanceMusicalBeat = null,
  performanceScope = null,
  performanceEvaluation = null,
  showContinuousFeedback = false,
  selectedRangeRenderNoteIds = [],
  onRenderNoteClick,
}: PracticeScoreViewerProps) {
  const isMobile = useIsMobile();
  const tPractice = useTranslations('practice');
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const stepPlayheadController = useMemo(() => new StepPlayheadController(), []);
  const performancePlayheadController = useMemo(() => new PerformancePlayheadController(), []);
  const annotationController = useMemo(() => new EvaluationAnnotationController(), []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderRevision, setRenderRevision] = useState(0);
  const selectedRangeRenderNoteIdSignature = selectedRangeRenderNoteIds.join('\u001f');
  const performanceAnnotationSignature = useMemo(
    () =>
      (performanceEvaluation?.groups ?? [])
        .map((group) => [
          group.groupId,
          group.strikes.map(strike => `${strike.strikeId}:${strike.state}:${strike.renderNoteIds.join(',')}`).join(';'),
        ].join(':'))
        .join('\u001f'),
    [performanceEvaluation]
  );
  const handleRendered = useCallback(
    (_adapter: unknown, container: HTMLDivElement) => {
      containerRef.current = container;
      setRenderRevision((revision) => revision + 1);
    },
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const shouldClear =
      sessionMode !== 'STEP_BY_STEP' ||
      !activeStepGroup ||
      !xmlContent ||
      renderRevision === 0 ||
      (lifecycle !== 'ACTIVE' && lifecycle !== 'PAUSED');

    if (shouldClear) {
      stepPlayheadController.clear(container);
      return;
    }

    stepPlayheadController.apply(container, adapter, activeStepGroup);
    const frame = window.requestAnimationFrame(() => {
      stepPlayheadController.refreshDecorations(container);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    adapter,
    activeStepGroup,
    stepPlayheadController,
    lifecycle,
    renderRevision,
    sessionMode,
    xmlContent,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      sessionMode !== 'CONTINUOUS_PLAY' ||
      !showContinuousFeedback ||
      !xmlContent ||
      renderRevision === 0
    ) {
      if (container) {
        annotationController.clear(container);
      }
      return;
    }

    annotationController.apply(
      container,
      performanceEvaluation
        ? noteAnnotationsFromLiveFeedback(performanceEvaluation)
        : { supportedNoteIds: [], unsupportedNoteIds: [] },
      { renderRevision }
    );
  }, [
    annotationController,
    performanceAnnotationSignature,
    performanceEvaluation,
    showContinuousFeedback,
    renderRevision,
    sessionMode,
    xmlContent,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      sessionMode !== 'CONTINUOUS_PLAY' ||
      performanceMusicalBeat === null ||
      !xmlContent ||
      renderRevision === 0 ||
      (lifecycle !== 'ACTIVE' && lifecycle !== 'PAUSED')
    ) {
      if (container) {
        performancePlayheadController.clear(container);
      }
      return;
    }

    const scope = performanceScope;
    if (!scope) {
      performancePlayheadController.clear(container);
      return;
    }
    performancePlayheadController.apply(
      container,
      adapter,
      performanceMusicalBeat,
      scope
    );
  }, [
    adapter,
    performanceMusicalBeat,
    performanceScope,
    performancePlayheadController,
    lifecycle,
    renderRevision,
    selectedRangeRenderNoteIdSignature,
    sessionMode,
    xmlContent,
  ]);

  useEffect(() => {
    const container = rootRef.current;
    if (!container || !xmlContent || renderRevision === 0) {
      return;
    }

    const rangeNoteIds = selectedRangeRenderNoteIdSignature
      ? selectedRangeRenderNoteIdSignature.split('\u001f')
      : [];
    let frame: number | null = null;
    const scheduleSync = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        syncRangeOverlay(container, rangeNoteIds);
      });
    };

    scheduleSync();
    const scoreRoot = container.querySelector<HTMLElement>('.practice-score-svg') ?? container;
    const mutationObserver = new MutationObserver((mutations) => {
      if (mutations.every(isRangeBackgroundMutation)) {
        return;
      }
      scheduleSync();
    });
    mutationObserver.observe(scoreRoot, { childList: true, subtree: true });

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => scheduleSync());
    resizeObserver?.observe(scoreRoot);

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      clearRangeOverlay(container);
    };
  }, [
    renderRevision,
    selectedRangeRenderNoteIdSignature,
    xmlContent,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !activeStepGroup ||
      sessionMode !== 'STEP_BY_STEP' ||
      !xmlContent ||
      renderRevision === 0 ||
      (lifecycle !== 'ACTIVE' && lifecycle !== 'PAUSED')
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      stepPlayheadController.refreshDecorations(container);
    });
    return () => window.cancelAnimationFrame(frame);
  });

  if (isMobile === undefined) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm',
        'min-h-[38rem]',
        className
      )}
      data-practice-range-note-ids={selectedRangeRenderNoteIds.join(',')}
    >
      <style jsx global>{`
        .practice-score-svg-selectable svg {
          cursor: crosshair;
        }
        .practice-score-svg-selectable [data-class='note'],
        .practice-score-svg-selectable .note,
        .practice-score-svg-selectable [data-class='chord'],
        .practice-score-svg-selectable .chord {
          cursor: pointer;
        }
        .practice-score-svg-selectable .note *,
        .practice-score-svg-selectable [data-class='note'] *,
        .practice-score-svg-selectable .chord *,
        .practice-score-svg-selectable [data-class='chord'] * {
          pointer-events: auto;
        }
        .practice-score-svg .${SCORE_DECORATIONS.rangeBackground} {
          fill: rgb(251 191 36 / 15%);
          stroke: rgb(245 158 11 / 40%);
          stroke-width: 1.5px;
          pointer-events: none !important;
        }
        .practice-score-svg .${SCORE_DECORATIONS.rangeSelected} {
          opacity: 1 !important;
        }
        .practice-score-svg .${SCORE_DECORATIONS.cursor} {
          stroke-width: 1.5px;
          pointer-events: none !important;
        }
        .practice-score-svg .${SCORE_DECORATIONS.cursor}[data-playhead-staff='treble'] {
          fill: rgb(125 211 252 / 24%);
          stroke: rgb(14 165 233 / 48%);
          filter: drop-shadow(0 0 4px rgb(14 165 233 / 22%));
        }
        .practice-score-svg .${SCORE_DECORATIONS.cursor}[data-playhead-staff='bass'] {
          fill: rgb(251 191 36 / 22%);
          stroke: rgb(245 158 11 / 46%);
          filter: drop-shadow(0 0 4px rgb(245 158 11 / 24%));
        }
        .practice-score-svg .${SCORE_DECORATIONS.cursor}[data-playhead-staff='other'] {
          fill: rgb(148 163 184 / 20%);
          stroke: rgb(100 116 139 / 44%);
          filter: drop-shadow(0 0 4px rgb(100 116 139 / 18%));
        }
        .practice-score-svg .${SCORE_DECORATIONS.supported} {
          fill: #16a34a !important;
          stroke: #15803d !important;
          opacity: 1 !important;
        }
        .practice-score-svg .${SCORE_DECORATIONS.unsupported} {
          fill: #dc2626 !important;
          stroke: #b91c1c !important;
          opacity: 1 !important;
        }
        .practice-score-svg svg {
          display: block;
          height: auto;
        }
        .practice-score-svg-fit svg {
          width: 100% !important;
        }
        .practice-score-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .practice-score-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <div className="relative z-40 flex min-h-14 shrink-0 items-center border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4">
        <div className="flex min-w-0 flex-1 justify-center">
          {sessionStatus}
        </div>
      </div>

      <VerovioScoreViewer
        xmlContent={xmlContent}
        isLoading={isLoadingXml}
        adapterFactory={adapterFactory}
        pageDataAttribute="data-practice-page"
        onRendered={handleRendered}
        className={cn(
          'practice-score-scroll min-h-0 flex-1 overflow-auto bg-white',
          'px-4 py-4'
        )}
        pageClassName={cn(
          'bg-white',
          'w-full overflow-hidden border-0 shadow-none'
        )}
        svgClassName={cn(
          'practice-score-svg',
          onRenderNoteClick ? 'practice-score-svg-selectable' : null,
          'practice-score-svg-fit'
        )}
        onRenderNoteClick={onRenderNoteClick}
        loadingContent={
          <PreviewLoading label={tPractice('preparingPractice')} className="min-h-[45vh]" />
        }
        emptyContent={
          <EmptyState title={tPractice('scoreDisplayArea')} className="min-h-[45vh]" />
        }
        errorMessage={tPractice('scoreUnavailableDesc')}
        renderError={(message) => (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center text-destructive">
            <AlertTriangle className="h-8 w-8" />
            <p className="max-w-lg">{message}</p>
          </div>
        )}
      />
    </div>
  );
}
