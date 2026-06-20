'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  VerovioScoreAdapter,
  type VerovioRenderedPage,
} from '@/lib/score/verovio';

type RenderResult = {
  xml: string;
  pages: VerovioRenderedPage[];
  error: string | null;
};

type VerovioScoreViewerProps = {
  xmlContent: string | null;
  isLoading?: boolean;
  adapterFactory?: () => VerovioScoreAdapter;
  className?: string;
  pagesClassName?: string;
  pageClassName?: string;
  svgClassName?: string;
  pageDataAttribute?: `data-${string}`;
  loadingContent: React.ReactNode;
  emptyContent: React.ReactNode;
  renderError: (message: string) => React.ReactNode;
  onRendered?: (
    adapter: VerovioScoreAdapter,
    container: HTMLDivElement,
    pages: VerovioRenderedPage[]
  ) => void;
};

export function VerovioScoreViewer({
  xmlContent,
  isLoading = false,
  adapterFactory,
  className,
  pagesClassName,
  pageClassName,
  svgClassName,
  pageDataAttribute = 'data-score-page',
  loadingContent,
  emptyContent,
  renderError,
  onRendered,
}: VerovioScoreViewerProps) {
  const adapter = useMemo(
    () => (adapterFactory ? adapterFactory() : new VerovioScoreAdapter()),
    [adapterFactory]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onRenderedRef = useRef(onRendered);
  const [result, setResult] = useState<RenderResult | null>(null);

  useEffect(() => {
    onRenderedRef.current = onRendered;
  }, [onRendered]);

  useEffect(() => {
    if (!xmlContent) {
      return;
    }

    let cancelled = false;
    void adapter
      .loadMusicXml(xmlContent)
      .then(() => {
        if (!cancelled) {
          setResult({ xml: xmlContent, pages: adapter.renderAllPages(), error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            xml: xmlContent,
            pages: [],
            error: error instanceof Error ? error.message : 'Verovio failed to render the score.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adapter, xmlContent]);

  useEffect(() => () => adapter.dispose(), [adapter]);

  const visibleResult = result?.xml === xmlContent ? result : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !visibleResult || visibleResult.pages.length === 0) {
      return;
    }
    onRenderedRef.current?.(adapter, container, visibleResult.pages);
  }, [adapter, visibleResult]);

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !visibleResult ||
      visibleResult.pages.length === 0 ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }

    let previousWidth: number | null = null;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(entry?.contentRect.width ?? 0);
      if (nextWidth <= 0 || previousWidth === null) {
        previousWidth = nextWidth;
        return;
      }
      if (Math.abs(nextWidth - previousWidth) < 2) {
        return;
      }
      previousWidth = nextWidth;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        try {
          const pages = adapter.relayout({ pageWidth: Math.max(900, Math.round(nextWidth * 2.25)) });
          setResult({ xml: visibleResult.xml, pages, error: null });
        } catch (error) {
          setResult({
            xml: visibleResult.xml,
            pages: [],
            error: error instanceof Error ? error.message : 'Verovio failed to resize the score.',
          });
        }
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [adapter, visibleResult]);

  const showLoading = isLoading || Boolean(xmlContent && !visibleResult);
  const showEmpty = !showLoading && !xmlContent;

  return (
    <div ref={containerRef} className={className}>
      {showLoading ? loadingContent : null}
      {!showLoading && visibleResult?.error ? renderError(visibleResult.error) : null}
      {showEmpty ? emptyContent : null}
      {!showLoading && visibleResult && !visibleResult.error && visibleResult.pages.length > 0 ? (
        <div className={cn('flex flex-col items-center gap-6', pagesClassName)}>
          {visibleResult.pages.map((page) => (
            <div
              key={page.pageNumber}
              data-score-page={page.pageNumber}
              {...{ [pageDataAttribute]: page.pageNumber }}
              className={pageClassName}
            >
              <div
                className={svgClassName}
                dangerouslySetInnerHTML={{ __html: page.svg }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
