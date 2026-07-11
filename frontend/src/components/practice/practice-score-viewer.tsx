'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Maximize, Minimize } from 'lucide-react';

import { PreviewLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { VerovioScoreViewer } from '@/components/score/verovio-score-viewer';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { PracticeFollowController } from '@/lib/practice/follow-controller';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import { cn } from '@/lib/utils';
import type { PracticeAlignmentUpdateMessage } from '@/types/api';

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
    | 'listening'
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
  const errors = useTranslations('errors');
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const followController = useMemo(() => new PracticeFollowController(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
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
        'relative overflow-hidden rounded-2xl bg-white shadow-lg',
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
        .practice-score-svg-natural svg {
          width: auto;
          max-width: none;
        }
      `}</style>

      <div
        className={cn(
          'pointer-events-auto absolute right-3 top-3 z-40 flex flex-wrap items-center justify-end gap-2',
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
                {isMaximized ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMaximized ? t('minimize') : t('maximize')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <VerovioScoreViewer
        xmlContent={xmlContent}
        isLoading={isLoadingXml}
        adapterFactory={adapterFactory}
        pageDataAttribute="data-practice-page"
        onRendered={handleRendered}
        className={cn(
          'h-full overflow-auto bg-stone-100',
          isMaximized ? 'px-6 pb-8 pt-20' : 'px-4 pb-6 pt-16'
        )}
        pageClassName={cn(
          'rounded-xl border border-stone-200 bg-white shadow-sm',
          isMaximized ? 'w-fit max-w-full overflow-x-auto' : 'w-full overflow-hidden'
        )}
        svgClassName={cn(
          'practice-score-svg',
          isMaximized ? 'practice-score-svg-natural' : 'practice-score-svg-fit'
        )}
        loadingContent={
          <PreviewLoading label={tPractice('preparingPractice')} className="min-h-[45vh]" />
        }
        emptyContent={
          <EmptyState title={tPractice('scoreDisplayArea')} className="min-h-[45vh]" />
        }
        errorMessage={errors('score_render_failed')}
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
