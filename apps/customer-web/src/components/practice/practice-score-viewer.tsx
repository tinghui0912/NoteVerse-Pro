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
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import { cn } from '@/lib/utils';
import type { PracticeAlignmentUpdateMessage } from '@/lib/practice/protocol';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rangeSelectionCss = useMemo(
    () =>
      [
        rangeNoteStyleRules(selectedRangeRenderNoteIds, 'range'),
        rangeNoteStyleRules(selectedRangeStartRenderNoteIds, 'start'),
        rangeNoteStyleRules(selectedRangeEndRenderNoteIds, 'end'),
      ].join('\n'),
    [
      selectedRangeEndRenderNoteIds,
      selectedRangeRenderNoteIds,
      selectedRangeStartRenderNoteIds,
    ]
  );
  const [renderRevision, setRenderRevision] = useState(0);
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
  }, [adapter, alignment, followController, practiceStatus, renderRevision, xmlContent]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !alignment ||
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
        ${rangeSelectionCss}
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

function renderedNoteSelector(noteId: string) {
  return `.practice-score-svg [data-id=${cssStringLiteral(noteId)}]`;
}

function renderedNoteDescendantSelector(noteId: string) {
  return `${renderedNoteSelector(noteId)} use,
${renderedNoteSelector(noteId)} path,
${renderedNoteSelector(noteId)} ellipse,
${renderedNoteSelector(noteId)} circle,
${renderedNoteSelector(noteId)} polygon,
${renderedNoteSelector(noteId)} rect,
${renderedNoteSelector(noteId)} line,
${renderedNoteSelector(noteId)} polyline,
${renderedNoteSelector(noteId)} .stem,
${renderedNoteSelector(noteId)} .flag,
${renderedNoteSelector(noteId)} .beam,
${renderedNoteSelector(noteId)} .notehead`;
}

function rangeNoteStyleRules(
  noteIds: readonly string[],
  role: 'range' | 'start' | 'end'
) {
  const uniqueNoteIds = Array.from(new Set(noteIds.filter(Boolean)));
  if (uniqueNoteIds.length === 0) {
    return '';
  }

  const baseRules = uniqueNoteIds
    .map((noteId) => {
      const selector = renderedNoteSelector(noteId);
      const descendantSelector = renderedNoteDescendantSelector(noteId);
      const filter =
        role === 'range'
          ? 'drop-shadow(0 0 4px rgba(13, 148, 136, 0.45))'
          : role === 'start'
            ? 'drop-shadow(0 0 6px rgba(5, 150, 105, 0.7))'
            : 'drop-shadow(0 0 6px rgba(20, 184, 166, 0.75))';
      const strokeWidth = role === 'range' ? '1.75px' : '3px';
      return `${selector} {
  fill: #0d9488 !important;
  stroke: #0f766e !important;
  stroke-width: ${strokeWidth} !important;
  opacity: 1 !important;
  filter: ${filter};
}
${descendantSelector} {
  fill: #0d9488 !important;
  stroke: #0f766e !important;
  opacity: 1 !important;
}`;
    })
    .join('\n');

  return baseRules;
}
