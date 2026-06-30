'use client';

import type { RefObject } from 'react';
import type { MouseEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface ScorePreviewViewportProps {
  className?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  loadError: string | null;
  onScoreClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onScoreMouseLeave?: (event: MouseEvent<HTMLDivElement>) => void;
  onScoreMouseMove?: (event: MouseEvent<HTMLDivElement>) => void;
  scoreContainerRef: (node: HTMLDivElement | null) => void;
}

export function ScorePreviewViewport({
  className,
  containerRef,
  isLoading,
  loadError,
  onScoreClick,
  onScoreMouseLeave,
  onScoreMouseMove,
  scoreContainerRef,
}: ScorePreviewViewportProps) {
  const t = useTranslations('common');

  return (
    <>
      <style jsx global>{`
        .score-preview-scroll-area {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .score-preview-scroll-area::-webkit-scrollbar {
          display: none;
        }
        .verovio-preview-page {
          position: relative;
          margin: 0 auto 1.5rem;
          overflow: hidden;
          border: 1px solid #e7e5e4;
          border-radius: 0.75rem;
          background: white;
        }
        .verovio-preview-page svg {
          display: block;
          width: 100% !important;
          height: auto;
        }
        .verovio-preview-page .score-playback-cursor {
          position: absolute;
          z-index: 2;
          width: 12px;
          min-height: 1px;
          border-radius: 2px;
          background: rgb(249 115 22 / 24%);
          box-shadow: 0 0 0 1px rgb(255 255 255 / 55%);
          pointer-events: none;
          transform: translateX(-50%);
          transition: left 80ms linear, top 120ms ease, height 120ms ease;
        }
        .verovio-preview-page .score-metadata-placeholder {
          position: absolute;
          z-index: 3;
          border: 1px dashed rgb(148 163 184 / 60%);
          border-radius: 0.375rem;
          background: rgb(255 255 255 / 72%);
          color: rgb(100 116 139);
          font-size: 0.75rem;
          line-height: 1rem;
          padding: 0.125rem 0.375rem;
          pointer-events: auto;
          cursor: text;
        }
        .verovio-preview-page .score-metadata-placeholder:hover {
          border-color: rgb(37 99 235 / 70%);
          color: rgb(37 99 235);
        }
        .verovio-preview-page .score-measure-warning-outline {
          position: absolute;
          z-index: 1;
          border: 1px solid rgb(245 158 11 / 28%);
          border-radius: 0.375rem;
          background: rgb(245 158 11 / 4%);
          box-shadow: inset 0 0 0 9999px rgb(255 251 235 / 2%);
          pointer-events: none;
        }
        .verovio-preview-page .score-metadata-placeholder-title {
          left: 50%;
          top: 1.25rem;
          transform: translateX(-50%);
        }
        .verovio-preview-page .score-metadata-placeholder-subtitle {
          left: 50%;
          top: 2.75rem;
          transform: translateX(-50%);
        }
        .verovio-preview-page .score-metadata-placeholder-lyricist {
          right: 2.5rem;
          top: 4rem;
        }
        .verovio-preview-page .score-metadata-placeholder-composer {
          right: 2.5rem;
          top: 5.25rem;
        }
        .score-preview-editable .verovio-preview-page [data-id],
        .score-preview-editable .verovio-preview-page [id] {
          cursor: pointer;
        }
        .score-preview-editable .score-editor-selected,
        .score-preview-editable .score-editor-selected path,
        .score-preview-editable .score-editor-selected ellipse,
        .score-preview-editable .score-editor-selected circle,
        .score-preview-editable .score-editor-selected polygon,
        .score-preview-editable .score-editor-selected rect,
        .score-preview-editable .score-editor-selected line,
        .score-preview-editable .score-editor-selected polyline,
        .score-preview-editable .score-editor-selected use {
          color: var(--score-editor-selection-color, #2563eb);
          fill: var(--score-editor-selection-color, #2563eb);
          stroke: var(--score-editor-selection-color, #2563eb);
        }
        .score-preview-editable .score-editor-hidden {
          display: none;
        }
      `}</style>

      <div
        ref={containerRef}
        data-testid="score-preview-viewport"
        onClick={onScoreClick}
        onMouseLeave={onScoreMouseLeave}
        onMouseMove={onScoreMouseMove}
        className={cn(
          'score-preview-scroll-area relative min-h-[40vh] w-full flex-1 overflow-y-auto overflow-x-hidden rounded-lg bg-white',
          onScoreClick && 'score-preview-editable',
          className
        )}
      >
        {isLoading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/80 text-muted-foreground backdrop-blur-sm">
            <LoaderCircle className="h-8 w-8 animate-spin" />
            <p>{t('loadingScoreData')}</p>
          </div>
        ) : null}
        {loadError ? (
          <div role="alert" className="absolute inset-0 z-10 flex items-center justify-center bg-white p-6 text-center text-destructive">
            <p>{loadError}</p>
          </div>
        ) : null}
        <div ref={scoreContainerRef} className="h-full w-full" />
      </div>
    </>
  );
}
