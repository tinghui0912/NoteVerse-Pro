'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Maximize, Minimize, Settings } from 'lucide-react';

import { PreviewLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
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
  className?: string;
  bottomControls?: ReactNode;
  sessionStatus?: ReactNode;
  isMaximized: boolean;
  onOpenSettings: () => void;
  onToggleMaximize: () => void;
  xmlContent: string | null;
  isLoadingXml: boolean;
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
  className,
  bottomControls = null,
  sessionStatus = null,
  isMaximized,
  onOpenSettings,
  onToggleMaximize,
  xmlContent,
  isLoadingXml,
  practiceStatus,
  alignment = null,
}: PracticeScoreViewerProps) {
  const isMobile = useIsMobile();
  const t = useTranslations('common');
  const tPractice = useTranslations('practice');
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
        'relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm',
        isMaximized ? 'fixed inset-0 z-[45] rounded-none' : 'min-h-[38rem]',
        className
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
        .practice-score-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .practice-score-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <div className="relative z-40 flex min-h-14 shrink-0 items-center border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4">
        <div className="flex min-w-0 flex-1 justify-center px-11 sm:px-14">
          {sessionStatus}
        </div>
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 sm:right-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-950"
                  onClick={onOpenSettings}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                <p>{tPractice('settingsTitle')}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-950"
                  onClick={onToggleMaximize}
                >
                  {isMaximized ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                <p>{isMaximized ? t('minimize') : t('maximize')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
          isMaximized ? 'px-6 pb-28 pt-4' : 'px-4 py-4'
        )}
        pageClassName={cn(
          'bg-white',
          isMaximized
            ? 'w-fit max-w-full overflow-x-auto'
            : 'w-full overflow-hidden border-0 shadow-none'
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
        errorMessage={tPractice('scoreUnavailableDesc')}
        renderError={(message) => (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center text-destructive">
            <AlertTriangle className="h-8 w-8" />
            <p className="max-w-lg">{message}</p>
          </div>
        )}
      />

      {isMaximized && bottomControls ? (
        <div className="absolute inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:px-6">
          <div className="mx-auto max-w-5xl">{bottomControls}</div>
        </div>
      ) : null}
    </div>
  );
}
