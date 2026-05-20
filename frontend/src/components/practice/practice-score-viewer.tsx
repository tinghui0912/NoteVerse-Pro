'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Maximize, Minimize, LoaderCircle, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import { PracticeFollowController } from '@/lib/practice/follow-controller';
import type { PracticeAlignmentUpdateMessage } from '@/types/api';
import type { VerovioRenderedPage } from '@/lib/practice/verovio-types';

type PracticeScoreViewerProps = {
  isMaximized: boolean;
  onToggleMaximize: () => void;
  xmlContent: string | null;
  isLoadingXml: boolean;
  toolbar?: React.ReactNode;
  practiceStatus:
    | 'idle'
    | 'connecting'
    | 'arming'
    | 'practicing'
    | 'paused'
    | 'finished';
  alignment?: PracticeAlignmentUpdateMessage['payload'] | null;
};

export function PracticeScoreViewer({
  isMaximized,
  onToggleMaximize,
  xmlContent,
  isLoadingXml,
  toolbar = null,
  practiceStatus,
  alignment = null,
}: PracticeScoreViewerProps) {
  const isMobile = useIsMobile();
  const t = useTranslations('common');
  const tPractice = useTranslations('practice');
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const followController = useMemo(() => new PracticeFollowController(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderedPages, setRenderedPages] = useState<VerovioRenderedPage[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!xmlContent) {
      setRenderedPages([]);
      setRenderError(null);
      return;
    }

    let cancelled = false;

    const loadScore = async () => {
      try {
        setRenderError(null);
        await adapter.loadMusicXml(xmlContent);
        const nextPages = adapter.renderAllPages();
        if (!cancelled) {
          setRenderedPages(nextPages);
        }
      } catch (error) {
        if (!cancelled) {
          setRenderedPages([]);
          setRenderError(
            error instanceof Error ? error.message : 'Failed to render the practice score.'
          );
        }
      }
    };

    void loadScore();

    return () => {
      cancelled = true;
    };
  }, [adapter, xmlContent]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const shouldClearFollowState =
      !alignment ||
      renderedPages.length === 0 ||
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

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [adapter, alignment, followController, practiceStatus, renderedPages]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !alignment ||
      renderedPages.length === 0 ||
      practiceStatus === 'idle' ||
      practiceStatus === 'finished'
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      followController.refreshDecorations(container);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  });

  if (isMobile === undefined) {
    return null;
  }

  const showEmptyState = !isLoadingXml && !xmlContent && !renderError;

  return (
    <div
      className={cn(
        'relative bg-white rounded-2xl shadow-lg overflow-hidden',
        isMaximized ? 'fixed inset-0 z-[100] rounded-none' : 'min-h-[60vh]'
      )}
    >
      <style jsx global>{`
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
        .practice-score-svg .practice-note-active polyline {
          fill: #f97316 !important;
          stroke: #ea580c !important;
          stroke-width: 1.6px !important;
          opacity: 1 !important;
        }

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

        .practice-score-svg-natural svg {
          width: auto;
          max-width: none;
        }
      `}</style>

      <div
        className={cn(
          'absolute right-3 top-3 z-40 flex flex-wrap items-center justify-end gap-2 pointer-events-auto',
          isMaximized && 'right-4 top-4'
        )}
      >
        {toolbar}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="bg-black/20 text-white hover:bg-black/40 hover:text-white"
                onClick={onToggleMaximize}
              >
                {isMaximized ? (
                  <Minimize className="h-5 w-5" />
                ) : (
                  <Maximize className="h-5 w-5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMaximized ? t('minimize') : t('maximize')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div
        ref={containerRef}
        className={cn(
          'h-full overflow-auto bg-stone-100',
          isMaximized ? 'pt-20 px-6 pb-8' : 'pt-16 px-4 pb-6'
        )}
      >
        {isLoadingXml ? (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-muted-foreground">
            <LoaderCircle className="h-8 w-8 animate-spin" />
            <p>Loading practice score...</p>
          </div>
        ) : null}

        {renderError ? (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center text-destructive">
            <AlertTriangle className="h-8 w-8" />
            <p className="max-w-lg">{renderError}</p>
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <p>{tPractice('scoreDisplayArea')}</p>
            <p className="text-sm">The practice score will appear here once the MusicXML loads.</p>
          </div>
        ) : null}

        {!isLoadingXml && !renderError && renderedPages.length > 0 ? (
          <div className="flex flex-col items-center gap-6">
            {renderedPages.map((page) => (
              <div
                key={page.pageNumber}
                data-practice-page={page.pageNumber}
                className={cn(
                  'rounded-xl border border-stone-200 bg-white shadow-sm',
                  isMaximized
                    ? 'w-fit max-w-full overflow-x-auto'
                    : 'w-full overflow-hidden'
                )}
              >
                <div
                  className={cn(
                    'practice-score-svg',
                    isMaximized ? 'practice-score-svg-natural' : 'practice-score-svg-fit'
                  )}
                  dangerouslySetInnerHTML={{ __html: page.svg }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
