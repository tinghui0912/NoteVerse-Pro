// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { PerformancePlayheadController } from './performance-playhead-controller';
import type { PracticeVerovioAdapter, PracticeVisualTimelineEntry } from './verovio-adapter';

function makeAdapter(entries: PracticeVisualTimelineEntry[]) {
  return {
    getTimelineEntryForTick: (tick: number) =>
      entries.reduce<PracticeVisualTimelineEntry | null>((bestEntry, entry) => {
        if (bestEntry === null) {
          return entry;
        }
        return Math.abs(entry.tick - tick) < Math.abs(bestEntry.tick - tick)
          ? entry
          : bestEntry;
      }, null),
    getCursorTimelineEntryForTickRange: (
      tick: number,
      startTick: number,
      terminalTick: number,
      allowedNoteIds: readonly string[] = []
    ) => {
      const boundedTick = Math.min(Math.max(tick, startTick), terminalTick);
      const allowed = allowedNoteIds.length > 0 ? new Set(allowedNoteIds) : null;
      return entries.reduce<PracticeVisualTimelineEntry | null>((bestEntry, entry) => {
        if (
          entry.tick < startTick - 0.001 ||
          entry.tick > terminalTick + 0.001 ||
          entry.tick > boundedTick + 0.001
        ) {
          return bestEntry;
        }
        const noteIds = allowed
          ? entry.noteIds.filter((noteId) => allowed.has(noteId))
          : entry.noteIds;
        if (noteIds.length === 0) {
          return bestEntry;
        }
        const candidate = { ...entry, noteIds };
        if (bestEntry === null) {
          return candidate;
        }
        return candidate.tick >= bestEntry.tick ? candidate : bestEntry;
      }, null);
    },
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
          <g data-id="n1"></g>
          <g data-id="n2"></g>
          <g data-id="n3"></g>
        </g>
      </svg>
    </div>
  `;
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
    'system-1': { x: 0, y: 100, width: 800, height: 180 },
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

describe('PerformancePlayheadController', () => {
  const entries: PracticeVisualTimelineEntry[] = [
    { index: 0, tick: 1, endTick: 2, noteIds: ['n1'] },
    { index: 1, tick: 2, endTick: 3, noteIds: ['n2'] },
    { index: 2, tick: 3, endTick: 4, noteIds: ['n3'] },
  ];

  it('moves one background cursor for the given musical tick without coloring notes', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, 2, {
      kind: 'FULL',
      startTick: 1,
      terminalTick: 4,
    });

    expect(container.querySelector('[data-practice-playhead-cursor]')).not.toBeNull();
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
  });

  it('clears decorations when musical tick is null', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, 2, {
      kind: 'FULL',
      startTick: 1,
      terminalTick: 4,
    });
    expect(container.querySelector('[data-practice-playhead-cursor]')).not.toBeNull();

    controller.apply(container, adapter, null, {
      kind: 'FULL',
      startTick: 1,
      terminalTick: 4,
    });
    expect(container.querySelector('[data-practice-playhead-cursor]')).toBeNull();
  });

  it('scopes cursor to tick range and selected note IDs', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, 3, {
      kind: 'RANGE',
      startTick: 1,
      terminalTick: 2,
      allowedNoteIds: ['n1', 'n2'],
    });

    // Bounded tick is 2, so n2 is active, not n3
    expect(container.querySelector('[data-practice-playhead-cursor]')).not.toBeNull();
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).not.toHaveClass('practice-note-active');
  });

  it('fails closed when a range has no allowed note IDs', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, 2, {
      kind: 'RANGE',
      startTick: 1,
      terminalTick: 4,
      allowedNoteIds: [],
    });

    expect(container.querySelector('[data-practice-playhead-cursor]')).toBeNull();
  });
});
