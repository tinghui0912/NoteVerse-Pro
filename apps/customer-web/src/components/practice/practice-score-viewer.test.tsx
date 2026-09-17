// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PracticeScoreViewer } from './practice-score-viewer';
import { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';
import type { PracticeAlignmentUpdateMessage } from '@/lib/practice/protocol';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/loading', () => ({
  PreviewLoading: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock('@/components/states', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('@/components/score-preview/verovio-score-viewer', () => ({
  VerovioScoreViewer: ({
    className,
    svgClassName,
    onRendered,
  }: {
    className?: string;
    svgClassName?: string;
    onRendered?: (
      adapter: unknown,
      container: HTMLDivElement,
      pages: unknown[]
    ) => void;
  }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const container = containerRef.current;
      if (container) {
        onRendered?.({}, container, [{ pageNumber: 1 }]);
      }
    }, [onRendered]);

    return (
      <div ref={containerRef} className={className}>
        <svg className={svgClassName}>
          <g className="system" data-testid="score-system">
            <g data-id="note-a" data-testid="selected-note">
              <path d="M 10 10 L 20 20" />
            </g>
            <g data-id="note-b">
              <path d="M 80 30 L 90 40" />
            </g>
          </g>
        </svg>
      </div>
    );
  },
}));

type PracticeScoreViewerProps = ComponentProps<typeof PracticeScoreViewer>;

function renderViewer(props: Partial<PracticeScoreViewerProps> = {}) {
  render(
    <PracticeScoreViewer
      xmlContent="<score-partwise />"
      isLoadingXml={false}
      practiceStatus="idle"
      sessionMode="STEP_BY_STEP"
      {...props}
    />
  );
}

function makeAlignment(): PracticeAlignmentUpdateMessage['payload'] {
  return {
    beat_position: 64,
    confidence: 1,
    alignment_confidence: 1,
    audio_confidence: 1,
    continuity_confidence: 1,
    visual_confidence: 1,
    timestamp_ms: 100,
    scope_completed: true,
    completion_reason: 'FINAL_EXPECTED_GROUP_MATCHED',
    audio_active: false,
    input_rms: 0,
    input_peak: 0,
    input_health: {
      available: true,
      level: 'good',
      noise: 'good',
      confidence: 1,
    },
    match_state: 'matched',
    feature_confidence: 1,
    beat_delta: null,
    stream_state: 'skipped',
    frame_class: 'unknown',
    gate_reason: 'user_skipped',
    queue_decision: 'user_skipped',
    tonal_signal: false,
    onset_signal: false,
    spectral_flatness: 0,
    peak_prominence: 0,
    spectral_flux: 0,
    alignment_state: 'skipped',
    continuity_state: 'stable',
    beat_velocity: null,
    validation_confidence: 1,
    input_weight: 0,
    input_policy_confidence: 1,
    decision: {
      action: 'skip',
      reason: 'user_skipped',
      experience_state: 'skipped',
      display_anchor: {
        beat: 64,
        group_id: 'entry-64',
        render_note_ids: ['note-a'],
      },
      confidence_summary: {
        visual: 1,
        alignment: 1,
        audio: 1,
        continuity: 1,
        validation: 1,
        input_policy: 1,
      },
    },
  };
}

describe('PracticeScoreViewer', () => {
  it('renders selected section as note backgrounds without recoloring note shapes', async () => {
    const getBBox = vi.fn(function getBBox(this: SVGElement) {
      if (this.classList.contains('system')) {
        return {
          x: 0,
          y: 0,
          width: 120,
          height: 80,
        } as DOMRect;
      }
      if (this.getAttribute('data-id') === 'note-b') {
        return {
          x: 80,
          y: 30,
          width: 10,
          height: 10,
        } as DOMRect;
      }
      return {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      } as DOMRect;
    });
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: getBBox,
    });

    renderViewer({ selectedRangeRenderNoteIds: ['note-a', 'note-b'] });

    const selectedNote = await screen.findByTestId('selected-note');
    const scoreSystem = await screen.findByTestId('score-system');
    await waitFor(() => {
      expect(scoreSystem.querySelectorAll('[data-practice-range-background]')).toHaveLength(1);
    });
    expect(scoreSystem.querySelector('[data-practice-range-background]')).toHaveAttribute('width', '96');
    expect(selectedNote).not.toHaveStyle({ fill: '#0d9488' });

    delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
  });

  it('reapplies selected section backgrounds after the score svg mutates', async () => {
    const getBBox = vi.fn(function getBBox(this: SVGElement) {
      if (this.classList.contains('system')) {
        return {
          x: 0,
          y: 0,
          width: 120,
          height: 80,
        } as DOMRect;
      }
      if (this.getAttribute('data-id') === 'note-b') {
        return {
          x: 80,
          y: 30,
          width: 10,
          height: 10,
        } as DOMRect;
      }
      return {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      } as DOMRect;
    });
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: getBBox,
    });

    renderViewer({ selectedRangeRenderNoteIds: ['note-a', 'note-b'] });

    const scoreSystem = await screen.findByTestId('score-system');
    await waitFor(() => {
      expect(scoreSystem.querySelectorAll('[data-practice-range-background]')).toHaveLength(1);
    });

    scoreSystem.querySelector('[data-practice-range-background]')?.remove();
    scoreSystem.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));

    await waitFor(() => {
      expect(scoreSystem.querySelectorAll('[data-practice-range-background]')).toHaveLength(1);
    });

    delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
  });

  it('keeps the final step-by-step alignment visible after completion', async () => {
    const getTimelineEntryForDisplayAnchor = vi
      .spyOn(PracticeVerovioAdapter.prototype, 'getTimelineEntryForDisplayAnchor')
      .mockReturnValue({
        index: 0,
        beat: 64,
        endBeat: 66,
        noteIds: ['note-a'],
        groupId: 'entry-64',
      });
    const getPageWithElement = vi
      .spyOn(PracticeVerovioAdapter.prototype, 'getPageWithElement')
      .mockReturnValue(1);

    renderViewer({
      practiceStatus: 'finished',
      alignment: makeAlignment(),
    });

    const selectedNote = await screen.findByTestId('selected-note');
    await waitFor(() => {
      expect(selectedNote).toHaveClass('practice-note-active');
    });

    getTimelineEntryForDisplayAnchor.mockRestore();
    getPageWithElement.mockRestore();
  });
});
