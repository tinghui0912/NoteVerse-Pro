// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  PerformancePlayheadController,
  projectPerformanceTimeToBeat,
} from './performance-playhead-controller';
import type {
  PracticePerformanceClockPayload,
  PracticePerformanceTimelinePayload,
} from './protocol';
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
    getNextTimelineEntryAfterBeat: (beat: number) =>
      entries.find((entry) => entry.beat > beat + 0.001) ?? entries.at(-1) ?? null,
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
      <g data-id="n4"></g>
    </div>
  `;
  document.body.appendChild(container);
  return container;
}

function makeSync(
  overrides: Partial<PracticePerformanceClockPayload> = {}
): PracticePerformanceClockPayload {
  return {
    state: 'RUNNING',
    musical_beat: 1,
    performance_time_ms: 0,
    count_in_remaining_ms: 0,
    count_in_remaining_pulses: 0,
    scope_completed: false,
    scope_start_group_id: null,
    scope_end_group_id: null,
    scope_start_beat: 1,
    scope_terminal_beat: 3,
    nominal_scope_duration_ms: 2000,
    speed_ratio: 1,
    ...overrides,
  };
}

function makeTimeline(
  overrides: Partial<PracticePerformanceTimelinePayload> = {}
): PracticePerformanceTimelinePayload {
  return {
    scope_start_beat: 1,
    scope_terminal_beat: 3,
    segments: [
      {
        start_performance_time_ms: 0,
        end_performance_time_ms: 2000,
        start_beat: 1,
        end_beat: 3,
      },
    ],
    ...overrides,
  };
}

describe('PerformancePlayheadController', () => {
  const entries: PracticeVisualTimelineEntry[] = [
    { index: 0, beat: 1, endBeat: 2, noteIds: ['n1'] },
    { index: 1, beat: 2, endBeat: 3, noteIds: ['n2'] },
    { index: 2, beat: 3, endBeat: 4, noteIds: ['n3'] },
  ];

  it('highlights the visual entry for the latest backend clock sync', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveSync(makeSync({ musical_beat: 2, performance_time_ms: 1000 }), 1000);
    controller.apply(container, adapter, 1000);

    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
  });

  it('uses bounded local interpolation for running visual playhead movement', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveTimeline(makeTimeline());
    controller.receiveSync(makeSync({ musical_beat: 1, performance_time_ms: 0 }), 1000);
    controller.apply(container, adapter, 2500);

    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
  });

  it('does not extrapolate beyond the terminal beat', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveTimeline(makeTimeline());
    controller.receiveSync(makeSync({ musical_beat: 2.9, performance_time_ms: 1900 }), 1000);
    controller.apply(container, adapter, 5000);

    expect(container.querySelector('[data-id="n3"]')).toHaveClass('practice-note-active');
  });

  it('keeps paused sync fixed at the authoritative beat', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveSync(makeSync({ state: 'PAUSED', musical_beat: 1 }), 1000);
    controller.apply(container, adapter, 5000);

    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).not.toHaveClass('practice-note-active');
  });

  it('keeps count-in sync fixed at the scope start beat', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveSync(
      makeSync({
        state: 'COUNT_IN',
        musical_beat: 1,
        count_in_remaining_ms: 1000,
        count_in_remaining_pulses: 2,
      }),
      1000
    );
    controller.apply(container, adapter, 5000);

    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
  });

  it('keeps the playhead frozen when local count-in time elapses before running sync', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveTimeline(makeTimeline());
    controller.receiveSync(
      makeSync({
        state: 'COUNT_IN',
        musical_beat: 1,
        performance_time_ms: 0,
        count_in_remaining_ms: 500,
        count_in_remaining_pulses: 1,
      }),
      1000
    );
    controller.apply(container, adapter, 2500);

    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
  });

  it('does not jump ahead to a future note before its beat arrives', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter([
      { index: 0, beat: 1, endBeat: 2, noteIds: ['n1'] },
      { index: 1, beat: 3, endBeat: 4, noteIds: ['n3'] },
    ]);

    controller.receiveTimeline(makeTimeline());
    controller.receiveSync(makeSync({ musical_beat: 1, performance_time_ms: 0 }), 1000);
    controller.apply(container, adapter, 1500);

    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).not.toHaveClass('practice-note-active');
  });

  it('does not visually move backwards for a slightly lower running sync', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveTimeline(makeTimeline());
    controller.receiveSync(makeSync({ musical_beat: 2, performance_time_ms: 1000 }), 1000);
    controller.apply(container, adapter, 1000);
    controller.receiveSync(makeSync({ musical_beat: 1.2, performance_time_ms: 1200 }), 1200);
    controller.apply(container, adapter, 1200);

    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
  });

  it('projects running playhead through backend timeline tempo segments', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter([
      { index: 0, beat: 1, endBeat: 2, noteIds: ['n1'] },
      { index: 1, beat: 2, endBeat: 3, noteIds: ['n2'] },
      { index: 2, beat: 3, endBeat: 4, noteIds: ['n3'] },
    ]);

    controller.receiveTimeline(
      makeTimeline({
        scope_terminal_beat: 3,
        segments: [
          {
            start_performance_time_ms: 0,
            end_performance_time_ms: 500,
            start_beat: 1,
            end_beat: 2,
          },
          {
            start_performance_time_ms: 500,
            end_performance_time_ms: 2500,
            start_beat: 2,
            end_beat: 3,
          },
        ],
      })
    );
    controller.receiveSync(makeSync({ musical_beat: 1.8, performance_time_ms: 400 }), 1000);
    controller.apply(container, adapter, 1600);

    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).not.toHaveClass('practice-note-active');
  });

  it('uses speed ratio only to advance performance time against backend projection', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveTimeline(makeTimeline());
    controller.receiveSync(
      makeSync({ musical_beat: 1, performance_time_ms: 0, speed_ratio: 0.5 }),
      1000
    );
    controller.apply(container, adapter, 3000);

    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).not.toHaveClass('practice-note-active');
  });

  it('starts selected-range projection at the backend scope start beat', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter([
      { index: 0, beat: 4, endBeat: 5, noteIds: ['n1'] },
      { index: 1, beat: 5, endBeat: 6, noteIds: ['n2'] },
      { index: 2, beat: 6, endBeat: 7, noteIds: ['n3'] },
    ]);

    controller.receiveTimeline(
      makeTimeline({
        scope_start_beat: 4,
        scope_terminal_beat: 6,
        segments: [
          {
            start_performance_time_ms: 0,
            end_performance_time_ms: 2000,
            start_beat: 4,
            end_beat: 6,
          },
        ],
      })
    );
    controller.receiveSync(
      makeSync({
        musical_beat: 4,
        performance_time_ms: 0,
        scope_start_beat: 4,
        scope_terminal_beat: 6,
        nominal_scope_duration_ms: 2000,
      }),
      1000
    );
    controller.apply(container, adapter, 1000);

    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
  });

  it('projects replay performance time through backend timeline segments', () => {
    expect(
      projectPerformanceTimeToBeat(
        makeTimeline({
          segments: [
            {
              start_performance_time_ms: 0,
              end_performance_time_ms: 1000,
              start_beat: 4,
              end_beat: 6,
            },
          ],
          scope_start_beat: 4,
          scope_terminal_beat: 6,
        }),
        500
      )
    ).toBe(5);
  });

  it('does not highlight the next full-score note outside a selected range at terminal', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter([
      { index: 0, beat: 1, endBeat: 2, noteIds: ['n1'] },
      { index: 1, beat: 2, endBeat: 3, noteIds: ['n2'] },
      { index: 2, beat: 3, endBeat: 4, noteIds: ['n3'] },
      { index: 3, beat: 4, endBeat: 5, noteIds: ['n4'] },
    ]);

    controller.receiveTimeline(
      makeTimeline({
        scope_start_beat: 2,
        scope_terminal_beat: 3,
        segments: [
          {
            start_performance_time_ms: 0,
            end_performance_time_ms: 1000,
            start_beat: 2,
            end_beat: 3,
          },
        ],
      })
    );
    controller.receiveSync(
      makeSync({
        state: 'RUNNING',
        musical_beat: 3,
        performance_time_ms: 999,
        scope_start_beat: 2,
        scope_terminal_beat: 3,
        nominal_scope_duration_ms: 1000,
      }),
      1000
    );
    controller.apply(container, adapter, 1000);

    expect(container.querySelector('[data-id="n3"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n4"]')).not.toHaveClass('practice-note-active');
  });

  it('filters same-beat outside notes when a selected range has explicit render ids', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter([
      { index: 0, beat: 2, endBeat: 3, noteIds: ['n2'] },
      { index: 1, beat: 3, endBeat: 4, noteIds: ['n3', 'n4'] },
    ]);

    controller.receiveTimeline(
      makeTimeline({
        scope_start_beat: 2,
        scope_terminal_beat: 3,
        segments: [
          {
            start_performance_time_ms: 0,
            end_performance_time_ms: 1000,
            start_beat: 2,
            end_beat: 3,
          },
        ],
      })
    );
    controller.receiveSelectedRangeNoteIds(['n2', 'n3']);
    controller.receiveSync(
      makeSync({
        musical_beat: 3,
        performance_time_ms: 999,
        scope_start_beat: 2,
        scope_terminal_beat: 3,
        nominal_scope_duration_ms: 1000,
      }),
      1000
    );
    controller.apply(container, adapter, 1000);

    expect(container.querySelector('[data-id="n3"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n4"]')).not.toHaveClass('practice-note-active');
  });

  it('highlights the cursor onset instead of every still-sounding note', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter([
      { index: 0, beat: 1, endBeat: 4, noteIds: ['n1'] },
      { index: 1, beat: 2, endBeat: 3, noteIds: ['n2'] },
    ]);

    controller.receiveTimeline(
      makeTimeline({
        scope_start_beat: 1,
        scope_terminal_beat: 4,
        segments: [
          {
            start_performance_time_ms: 0,
            end_performance_time_ms: 3000,
            start_beat: 1,
            end_beat: 4,
          },
        ],
      })
    );
    controller.receiveSync(
      makeSync({
        musical_beat: 2,
        performance_time_ms: 1000,
        scope_start_beat: 1,
        scope_terminal_beat: 4,
      }),
      1000
    );
    controller.apply(container, adapter, 1000);

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
  });

  it('clears the visible playhead after the performance scope completes', () => {
    const controller = new PerformancePlayheadController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.receiveTimeline(makeTimeline());
    controller.receiveSync(makeSync({ musical_beat: 2, performance_time_ms: 1000 }), 1000);
    controller.apply(container, adapter, 1000);
    controller.receiveSync(
      makeSync({
        state: 'ENDED',
        musical_beat: 3,
        performance_time_ms: 2000,
        scope_completed: true,
      }),
      2000
    );
    controller.apply(container, adapter, 2000);

    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).not.toHaveClass('practice-note-active');
  });

});
