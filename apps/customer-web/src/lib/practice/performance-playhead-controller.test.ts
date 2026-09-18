// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { PerformancePlayheadController } from './performance-playhead-controller';
import type { PracticeVerovioAdapter, PracticeVisualTimelineEntry } from './verovio-adapter';

function makeAdapter(entries: PracticeVisualTimelineEntry[]) {
  return {
    getTimelineEntryForBeat: (beat: number) =>
      entries.reduce<PracticeVisualTimelineEntry | null>((bestEntry, entry) => {
        if (bestEntry === null) {
          return entry;
        }
        return Math.abs(entry.beat - beat) < Math.abs(bestEntry.beat - beat)
          ? entry
          : bestEntry;
      }, null),
    getCursorTimelineEntryForBeatRange: (
      beat: number,
      startBeat: number,
      terminalBeat: number,
      allowedNoteIds: readonly string[] = []
    ) => {
      const boundedBeat = Math.min(Math.max(beat, startBeat), terminalBeat);
      const allowed = allowedNoteIds.length > 0 ? new Set(allowedNoteIds) : null;
      return entries.reduce<PracticeVisualTimelineEntry | null>((bestEntry, entry) => {
        if (
          entry.beat < startBeat - 0.001 ||
          entry.beat > terminalBeat + 0.001 ||
          entry.beat > boundedBeat + 0.001
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
        return candidate.beat >= bestEntry.beat ? candidate : bestEntry;
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
      <g data-id="n1"></g>
      <g data-id="n2"></g>
      <g data-id="n3"></g>
    </div>
  `;
  document.body.appendChild(container);
  return container;
}

describe('PerformancePlayheadController', () => {
  const entries: PracticeVisualTimelineEntry[] = [
    { index: 0, beat: 1, endBeat: 2, noteIds: ['n1'] },
    { index: 1, beat: 2, endBeat: 3, noteIds: ['n2'] },
    { index: 2, beat: 3, endBeat: 4, noteIds: ['n3'] },
  ];

  it('highlights the visual entry for the given musical beat', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, 2);

    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
  });

  it('clears decorations when musical beat is null', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, 2);
    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');

    controller.apply(container, adapter, null);
    expect(container.querySelector('.practice-note-active')).toBeNull();
  });

  it('scopes cursor to beat range and selected note IDs', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, 3, {
      startBeat: 1,
      terminalBeat: 2,
      selectedRangeNoteIds: ['n1', 'n2'],
    });

    // Bounded beat is 2, so n2 is active, not n3
    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).not.toHaveClass('practice-note-active');
  });
});
