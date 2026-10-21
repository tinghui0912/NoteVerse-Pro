// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { StepPlayheadController } from './step-playhead-controller';
import type { ExpectedPracticeGroup } from './local-core/artifact';
import type { PracticeVerovioAdapter } from './verovio-adapter';

function makeAdapter() {
  return {
    getPageWithElement: () => 1,
  } as unknown as PracticeVerovioAdapter;
}

function makeContainer() {
  const container = document.createElement('div');
  container.scrollTo = vi.fn();
  container.innerHTML = `
    <div data-practice-page="1">
      <svg viewBox="0 0 1000 1000">
        <g class="system" data-testid="system-1">
          <g data-class="chord" data-testid="chord-1">
            <g data-class="stem" data-testid="stem-1"></g>
            <g data-id="n1"></g>
          </g>
          <g data-id="n2"></g>
          <g data-id="n3"></g>
        </g>
      </svg>
    </div>
  `;
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
    'system-1': { x: 0, y: 100, width: 800, height: 180 },
    'chord-1': { x: 90, y: 145, width: 40, height: 48 },
    'stem-1': { x: 115, y: 120, width: 4, height: 80 },
    n1: { x: 100, y: 150, width: 24, height: 32 },
    n2: { x: 220, y: 150, width: 24, height: 32 },
    n3: { x: 340, y: 150, width: 24, height: 32 },
  };
  container.querySelectorAll<SVGGraphicsElement>('[data-id], [data-testid]').forEach((element) => {
    const id = element.getAttribute('data-id') ?? element.getAttribute('data-testid') ?? '';
    element.getBBox = vi.fn(() => boxes[id] as DOMRect);
  });
  document.body.appendChild(container);
  return container;
}

describe('StepPlayheadController', () => {
  it('keeps one background cursor on the current target until the target changes', () => {
    const controller = new StepPlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter();

    const group1: ExpectedPracticeGroup = {
      groupId: 'g1',
      onsetBeat: 1,
      canonicalEndBeat: 2,
      pitches: ['C4'],
      renderNoteIds: ['n1'],
      measureNumbers: ['1'],
      eventIds: ['e1'],
      expectedNotes: [],
      strikeTargets: [],
      staffIds: ['1'],
      voiceIds: ['1'],
    };

    const group2: ExpectedPracticeGroup = {
      groupId: 'g2',
      onsetBeat: 2,
      canonicalEndBeat: 3,
      pitches: ['D4'],
      renderNoteIds: ['n2'],
      measureNumbers: ['1'],
      eventIds: ['e2'],
      expectedNotes: [],
      strikeTargets: [],
      staffIds: ['1'],
      voiceIds: ['1'],
    };

    controller.apply(container, adapter, group1);
    const firstCursorX = container
      .querySelector('[data-practice-playhead-cursor]')
      ?.getAttribute('x');
    expect(firstCursorX).not.toBeNull();
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-testid="chord-1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');

    // Reapplying the same target, as when a chord is not complete yet, keeps the cursor in place.
    controller.apply(container, adapter, group1);
    expect(container.querySelector('[data-practice-playhead-cursor]')?.getAttribute('x')).toBe(
      firstCursorX
    );

    // Advance to next group
    controller.apply(container, adapter, group2);
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-testid="chord-1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-practice-playhead-cursor]')?.getAttribute('x')).not.toBe(
      firstCursorX
    );

    // End/null
    controller.apply(container, adapter, null);
    expect(container.querySelector('[data-practice-playhead-cursor]')).toBeNull();
  });
});
