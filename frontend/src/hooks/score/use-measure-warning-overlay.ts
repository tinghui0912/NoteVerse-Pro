'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { ScoreValidationIssue } from '@/lib/musicxml/validator';

const MEASURE_SELECTOR = '[data-class="measure"], .measure';
const STAFF_SELECTOR = '[data-class="staff"], .staff';
const WARNING_SELECTOR = '[data-score-measure-warning-outline]';

function getDirectMeasureElements(container: Element): Element[] {
  return Array.from(container.querySelectorAll(MEASURE_SELECTOR))
    .filter((measure) => measure.closest(MEASURE_SELECTOR) === measure);
}

function getDirectStaffElements(measure: Element): Element[] {
  return Array.from(measure.querySelectorAll(STAFF_SELECTOR))
    .filter((staff) => staff.closest(MEASURE_SELECTOR) === measure);
}

function getStaffLineBounds(measure: Element): { left: number; right: number } | null {
  const rects = getDirectStaffElements(measure).flatMap((staff) => (
    Array.from(staff.children)
      .filter((child) => child instanceof SVGPathElement)
      .map((path) => path.getBoundingClientRect())
      .filter((rect) => rect.width > 8)
  ));

  if (rects.length === 0) return null;
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    right: Math.max(...rects.map((rect) => rect.right)),
  };
}

function removeWarningOutlines(container: Element) {
  container.querySelectorAll(WARNING_SELECTOR).forEach((element) => element.remove());
}

export function useMeasureWarningOverlay({
  containerRef,
  isLoading,
  issues,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  issues: ScoreValidationIssue[];
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isLoading) return;

    let frameId: number | null = null;
    const render = () => {
      removeWarningOutlines(container);
      const measureIndexes = [...new Set(issues.flatMap((issue) => (
        issue.measureIndex === undefined ? [] : [issue.measureIndex]
      )))];
      if (measureIndexes.length === 0) return;

      const measures = getDirectMeasureElements(container);
      measureIndexes.forEach((measureIndex) => {
        const measure = measures[measureIndex];
        const page = measure?.closest<HTMLElement>('[data-score-page]');
        if (!measure || !page) return;

        const measureRect = measure.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const staffLines = getStaffLineBounds(measure);
        if (!staffLines) return;

        const outline = document.createElement('div');
        outline.dataset.scoreMeasureWarningOutline = 'true';
        outline.dataset.scoreMeasureIndex = String(measureIndex);
        outline.id = `score-measure-warning-${measureIndex}`;
        outline.className = 'score-measure-warning-outline';
        outline.style.left = `${Math.max(0, staffLines.left - pageRect.left)}px`;
        outline.style.top = `${Math.max(0, measureRect.top - pageRect.top)}px`;
        outline.style.width = `${Math.max(1, staffLines.right - staffLines.left)}px`;
        outline.style.height = `${Math.max(1, measureRect.height)}px`;
        page.append(outline);
      });
    };

    const scheduleRender = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = requestAnimationFrame(render);
      });
    };

    scheduleRender();
    const observer = new MutationObserver((mutations) => {
      const scoreChanged = mutations.some((mutation) => (
        [...mutation.addedNodes, ...mutation.removedNodes].some((node) => (
          node instanceof Element && !node.matches(WARNING_SELECTOR)
        ))
      ));
      if (scoreChanged) scheduleRender();
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
      removeWarningOutlines(container);
    };
  }, [containerRef, isLoading, issues]);
}
