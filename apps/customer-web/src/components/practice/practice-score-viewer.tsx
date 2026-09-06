'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

import { PreviewLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { useIsMobile } from '@/hooks/use-mobile';
import { PracticeFollowController } from '@/lib/practice/follow-controller';
import { PerformancePlayheadController } from '@/lib/practice/performance-playhead-controller';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import { cn } from '@/lib/utils';
import type {
  PracticeAlignmentUpdateMessage,
  PracticePerformanceClockPayload,
  PracticePerformanceTimelinePayload,
} from '@/lib/practice/protocol';
import type { PracticeSessionMode } from '@/lib/practice/session-policy';

type PracticeScoreViewerProps = {
  className?: string;
  sessionStatus?: ReactNode;
  xmlContent: string | null;
  isLoadingXml: boolean;
  practiceStatus:
    | 'idle'
    | 'connecting'
    | 'arming'
    | 'listening'
    | 'practicing'
    | 'paused'
    | 'finishing'
    | 'finished';
  alignment?: PracticeAlignmentUpdateMessage['payload'] | null;
  performanceClockSync?: PracticePerformanceClockPayload | null;
  performanceTimeline?: PracticePerformanceTimelinePayload | null;
  sessionMode: PracticeSessionMode;
  selectedRangeRenderNoteIds?: readonly string[];
  selectedRangeStartRenderNoteIds?: readonly string[];
  selectedRangeEndRenderNoteIds?: readonly string[];
  onRenderNoteClick?: (renderNoteId: string) => void;
};

export function PracticeScoreViewer({
  className,
  sessionStatus = null,
  xmlContent,
  isLoadingXml,
  practiceStatus,
  alignment = null,
  performanceClockSync = null,
  performanceTimeline = null,
  sessionMode,
  selectedRangeRenderNoteIds = [],
  selectedRangeStartRenderNoteIds = [],
  selectedRangeEndRenderNoteIds = [],
  onRenderNoteClick,
}: PracticeScoreViewerProps) {
  const isMobile = useIsMobile();
  const tPractice = useTranslations('practice');
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const followController = useMemo(() => new PracticeFollowController(), []);
  const performancePlayheadController = useMemo(() => new PerformancePlayheadController(), []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderRevision, setRenderRevision] = useState(0);
  const selectedRangeRenderNoteIdSignature = selectedRangeRenderNoteIds.join('\u001f');
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

    const shouldClearFollowState =
      sessionMode !== 'STEP_BY_STEP' ||
      !alignment ||
      !xmlContent ||
      renderRevision === 0 ||
      practiceStatus === 'idle' ||
      practiceStatus === 'finished';

    if (shouldClearFollowState) {
      followController.clear(container);
      return;
    }

    followController.apply(container, adapter, alignment);
    const frame = window.requestAnimationFrame(() => {
      followController.refreshDecorations(container);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    adapter,
    alignment,
    followController,
    practiceStatus,
    renderRevision,
    sessionMode,
    xmlContent,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      sessionMode !== 'CONTINUOUS_PLAY' ||
      !performanceClockSync ||
      !xmlContent ||
      renderRevision === 0 ||
      practiceStatus === 'idle' ||
      practiceStatus === 'finished'
    ) {
      if (container) {
        performancePlayheadController.clear(container);
      }
      return;
    }

    if (performanceTimeline) {
      performancePlayheadController.receiveTimeline(performanceTimeline);
    }
    const rangeNoteIds = selectedRangeRenderNoteIdSignature
      ? selectedRangeRenderNoteIdSignature.split('\u001f')
      : [];
    performancePlayheadController.receiveSelectedRangeNoteIds(rangeNoteIds);
    performancePlayheadController.receiveSync(performanceClockSync);
    let frame: number | null = null;
    const renderPlayhead = () => {
      performancePlayheadController.apply(container, adapter);
      if (performanceClockSync.state === 'COUNT_IN' || performanceClockSync.state === 'RUNNING') {
        frame = window.requestAnimationFrame(renderPlayhead);
      }
    };

    frame = window.requestAnimationFrame(renderPlayhead);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    adapter,
    performanceClockSync,
    performanceTimeline,
    performancePlayheadController,
    practiceStatus,
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
        clearRangeBackgrounds(container);
        applyRangeBackgrounds(container, rangeNoteIds);
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
      clearRangeBackgrounds(container);
    };
  }, [renderRevision, selectedRangeRenderNoteIdSignature, xmlContent]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !alignment ||
      sessionMode !== 'STEP_BY_STEP' ||
      !xmlContent ||
      renderRevision === 0 ||
      practiceStatus === 'idle' ||
      practiceStatus === 'finished'
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      followController.refreshDecorations(container);
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
      data-practice-range-start-note-ids={selectedRangeStartRenderNoteIds.join(',')}
      data-practice-range-end-note-ids={selectedRangeEndRenderNoteIds.join(',')}
    >
      <style jsx global>{`
        .practice-score-svg-selectable svg {
          cursor: crosshair;
        }
        .practice-score-svg-selectable [data-class='note'],
        .practice-score-svg-selectable .note {
          pointer-events: bounding-box;
        }
        .practice-score-svg .practice-range-background {
          fill: rgb(251 191 36 / 10%);
          stroke: rgb(245 158 11 / 34%);
          stroke-width: 1.2px;
          pointer-events: none;
        }
        .practice-score-svg .practice-note-active {
          fill: #f97316 !important;
          stroke: #ea580c !important;
          stroke-width: 2px !important;
          opacity: 1 !important;
          filter: drop-shadow(0 0 6px rgba(249, 115, 22, 0.65));
        }
        .practice-score-svg .practice-note-active use,
        .practice-score-svg .practice-note-active path,
        .practice-score-svg .practice-note-active ellipse,
        .practice-score-svg .practice-note-active circle,
        .practice-score-svg .practice-note-active polygon,
        .practice-score-svg .practice-note-active rect,
        .practice-score-svg .practice-note-active line,
        .practice-score-svg .practice-note-active polyline,
        .practice-score-svg .practice-note-active .stem,
        .practice-score-svg .practice-note-active .flag,
        .practice-score-svg .practice-note-active .beam,
        .practice-score-svg .practice-note-active .notehead {
          fill: #f97316 !important;
          stroke: #ea580c !important;
          opacity: 1 !important;
        }
        .practice-score-svg .practice-note-active .practice-range-background {
          fill: rgb(251 191 36 / 10%) !important;
          stroke: rgb(245 158 11 / 34%) !important;
          stroke-width: 1.2px !important;
          filter: none !important;
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

function cssStringLiteral(value: string) {
  return JSON.stringify(value);
}

function clearRangeBackgrounds(container: HTMLElement) {
  container
    .querySelectorAll('[data-practice-range-background]')
    .forEach((element) => element.remove());
}

function isRangeBackgroundMutation(mutation: MutationRecord) {
  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return (
    changedNodes.length > 0 &&
    changedNodes.every(
      (node) =>
        node instanceof Element &&
        node.hasAttribute('data-practice-range-background')
    )
  );
}

function applyRangeBackgrounds(
  container: HTMLElement,
  noteIds: readonly string[]
) {
  const systemBoxes = new Map<SVGGraphicsElement, DOMRect>();
  for (const noteId of Array.from(new Set(noteIds.filter(Boolean)))) {
    const note = container.querySelector<SVGGraphicsElement>(
      `[data-id=${cssStringLiteral(noteId)}]`
    );
    if (!note || typeof note.getBBox !== 'function') {
      continue;
    }

    let box: DOMRect;
    try {
      box = note.getBBox();
    } catch {
      continue;
    }

    const system = note.closest<SVGGraphicsElement>('.system');
    const layer = system ?? note.ownerSVGElement;
    if (!layer) {
      continue;
    }

    const currentBox = systemBoxes.get(layer);
    systemBoxes.set(layer, currentBox ? mergeRangeBox(currentBox, box) : box);
  }

  for (const [layer, rangeBox] of systemBoxes) {
    const verticalBox = rangeVerticalBox(layer, rangeBox);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const paddingX = Math.max(8, rangeBox.width * 0.02);
    const paddingY = Math.max(8, verticalBox.height * 0.04);
    rect.setAttribute('data-practice-range-background', 'true');
    rect.setAttribute('class', 'practice-range-background');
    rect.setAttribute('x', String(rangeBox.x - paddingX));
    rect.setAttribute('y', String(verticalBox.y - paddingY));
    rect.setAttribute('width', String(rangeBox.width + paddingX * 2));
    rect.setAttribute('height', String(verticalBox.height + paddingY * 2));
    rect.setAttribute('rx', '4');
    layer.insertBefore(rect, layer.firstChild);
  }
}

function mergeRangeBox(first: DOMRect, second: DOMRect): DOMRect {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return DOMRect.fromRect({
    x,
    y,
    width: right - x,
    height: bottom - y,
  });
}

function rangeVerticalBox(layer: SVGGraphicsElement, rangeBox: DOMRect): DOMRect {
  if (!layer.classList.contains('system')) {
    return rangeBox;
  }

  try {
    const systemBox = layer.getBBox();
    return DOMRect.fromRect({
      x: rangeBox.x,
      y: systemBox.y,
      width: rangeBox.width,
      height: systemBox.height,
    });
  } catch {
    return rangeBox;
  }
}
