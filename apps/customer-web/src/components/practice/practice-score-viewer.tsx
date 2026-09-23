'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

import { PreviewLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { useIsMobile } from '@/hooks/use-mobile';
import { StepPlayheadController } from '@/lib/practice/step-playhead-controller';
import {
  PerformancePlayheadController,
  type PerformanceScopeBeats,
} from '@/lib/practice/performance-playhead-controller';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import { cn } from '@/lib/utils';
import type { ExpectedPracticeGroup, PracticeMode } from '@/lib/practice/local-core/artifact';

import type { LocalPracticeLifecycle } from '@/lib/practice/local-core/session';

type PracticeScoreViewerProps = {
  className?: string;
  sessionStatus?: ReactNode;
  xmlContent: string | null;
  isLoadingXml: boolean;
  lifecycle: LocalPracticeLifecycle;
  sessionMode: PracticeMode;
  activeStepGroup?: ExpectedPracticeGroup | null;
  performanceMusicalBeat?: number | null;
  performanceScopeBeats?: PerformanceScopeBeats | null;
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
  performanceScopeBeats = null,
  selectedRangeRenderNoteIds = [],
  onRenderNoteClick,
}: PracticeScoreViewerProps) {
  const isMobile = useIsMobile();
  const tPractice = useTranslations('practice');
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const stepPlayheadController = useMemo(() => new StepPlayheadController(), []);
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

    const rangeNoteIds = selectedRangeRenderNoteIdSignature
      ? selectedRangeRenderNoteIdSignature.split('\u001f')
      : [];
    performancePlayheadController.receiveSelectedRangeNoteIds(rangeNoteIds);
    performancePlayheadController.apply(
      container,
      adapter,
      performanceMusicalBeat,
      performanceScopeBeats ?? undefined
    );
  }, [
    adapter,
    performanceMusicalBeat,
    performanceScopeBeats,
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
        clearRangeBackgrounds(container);
        applyRangeBackgrounds(container, rangeNoteIds);
        clearRangeClasses(container);
        applyRangeClasses(container, rangeNoteIds);
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
      clearRangeClasses(container);
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
        .practice-score-svg .practice-range-background {
          fill: rgb(251 191 36 / 15%);
          stroke: rgb(245 158 11 / 40%);
          stroke-width: 1.5px;
          pointer-events: none !important;
        }
        .practice-score-svg .practice-range-selected {
          opacity: 1 !important;
        }
        .practice-score-svg .practice-playhead-cursor {
          stroke-width: 1.5px;
          pointer-events: none !important;
        }
        .practice-score-svg .practice-playhead-cursor[data-playhead-staff='treble'] {
          fill: rgb(125 211 252 / 24%);
          stroke: rgb(14 165 233 / 48%);
          filter: drop-shadow(0 0 4px rgb(14 165 233 / 22%));
        }
        .practice-score-svg .practice-playhead-cursor[data-playhead-staff='bass'] {
          fill: rgb(251 191 36 / 22%);
          stroke: rgb(245 158 11 / 46%);
          filter: drop-shadow(0 0 4px rgb(245 158 11 / 24%));
        }
        .practice-score-svg .practice-playhead-cursor[data-playhead-staff='other'] {
          fill: rgb(148 163 184 / 20%);
          stroke: rgb(100 116 139 / 44%);
          filter: drop-shadow(0 0 4px rgb(100 116 139 / 18%));
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

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function findElementByVerovioId(container: HTMLElement, verovioId: string): SVGGraphicsElement | null {
  return (
    container.querySelector<SVGGraphicsElement>(`[data-id=${cssStringLiteral(verovioId)}]`) ??
    container.querySelector<SVGGraphicsElement>(`#${escapeCssId(verovioId)}`)
  );
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
    const note = findElementByVerovioId(container, noteId);
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

function clearRangeClasses(container: HTMLElement) {
  container
    .querySelectorAll('.practice-range-selected')
    .forEach((element) => element.classList.remove('practice-range-selected'));
  container
    .querySelectorAll('.practice-range-boundary')
    .forEach((element) => element.classList.remove('practice-range-boundary'));
}

function applyRangeClasses(
  container: HTMLElement,
  selectedNoteIds: readonly string[]
) {
  for (const id of Array.from(new Set(selectedNoteIds.filter(Boolean)))) {
    const el = findElementByVerovioId(container, id);
    el?.classList.add('practice-range-selected');
  }
}
