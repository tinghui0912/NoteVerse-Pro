// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { PracticeFollowController } from './follow-controller';
import type { PracticeAlignmentUpdateMessage } from './protocol';
import type { PracticeVerovioAdapter, PracticeVisualTimelineEntry } from './verovio-adapter';

type AlignmentPayload = PracticeAlignmentUpdateMessage['payload'];

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
    getTimelineEntryByIndex: (index: number) => entries[index] ?? null,
    getTimelineEntryForDisplayAnchor: (anchor: { beat: number; render_note_ids?: string[] }) => {
      const baseEntry = entries.find((entry) => entry.beat === anchor.beat) ?? null;
      if (!baseEntry) {
        return null;
      }
      return {
        ...baseEntry,
        noteIds: anchor.render_note_ids?.length ? anchor.render_note_ids : baseEntry.noteIds,
      };
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

function makeAlignment(
  overrides: Partial<AlignmentPayload> = {}
): AlignmentPayload {
  const action = overrides.decision?.action ?? 'advance';
  return {
    beat_position: 3,
    confidence: 0.95,
    alignment_confidence: 0.95,
    audio_confidence: 0.95,
    continuity_confidence: 0.95,
    visual_confidence: 0.95,
    timestamp_ms: 20,
    score_completed: false,
    audio_active: true,
    input_rms: 0.04,
    input_peak: 0.1,
    match_state: 'matched',
    feature_confidence: 0.95,
    beat_delta: null,
    stream_state: 'following',
    frame_class: 'tonal',
    gate_reason: 'start_confirmed',
    queue_decision: 'queued_tonal',
    tonal_signal: true,
    onset_signal: false,
    spectral_flatness: 0.02,
    peak_prominence: 20,
    spectral_flux: 0.1,
    alignment_state: 'matched',
    continuity_state: 'stable',
    beat_velocity: null,
    validation_confidence: 0.95,
    input_weight: 1,
    input_policy_confidence: 1,
    decision: {
      action,
      reason: action === 'wait' ? 'insufficient_input' : 'stable_match',
      experience_state: action === 'wait' ? 'waiting_for_input' : 'following',
      display_anchor: { beat: 3, render_note_ids: ['n1'] },
      confidence_summary: {
        visual: 0.95,
        alignment: 0.95,
        audio: 0.95,
        continuity: 0.95,
        validation: 0.95,
        input_policy: 1,
      },
    },
    ...overrides,
  };
}

describe('PracticeFollowController', () => {
  const entries: PracticeVisualTimelineEntry[] = [
    { index: 0, beat: 3, noteIds: ['n1'] },
    { index: 1, beat: 4, noteIds: ['n2'] },
    { index: 2, beat: 9, noteIds: ['n3'] },
  ];

  it('keeps the existing highlight for hold decisions', () => {
    const controller = new PracticeFollowController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, makeAlignment());
    controller.apply(
      container,
      adapter,
      makeAlignment({
        beat_position: 4,
        decision: {
          action: 'hold',
          reason: 'holding_position',
          experience_state: 'recovering',
          display_anchor: { beat: 3, render_note_ids: ['n1'] },
          confidence_summary: {
            visual: 0.3,
            alignment: 0.3,
            audio: 0.3,
            continuity: 0.95,
            validation: 0.3,
            input_policy: 0.3,
          },
        },
      })
    );

    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');
  });

  it('does not highlight notes while waiting before any accepted anchor', () => {
    const controller = new PracticeFollowController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(
      container,
      adapter,
      makeAlignment({
        decision: {
          action: 'wait',
          reason: 'insufficient_input',
          experience_state: 'waiting_for_input',
          display_anchor: null,
          confidence_summary: {
            visual: 0,
            alignment: 0,
            audio: 0,
            continuity: 1,
            validation: 0,
            input_policy: 0,
          },
        },
      })
    );

    expect(container.querySelector('.practice-note-active')).toBeNull();
  });

  it('allows relocalize decisions to jump to a confirmed distant anchor', () => {
    const controller = new PracticeFollowController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(container, adapter, makeAlignment());
    controller.apply(
      container,
      adapter,
      makeAlignment({
        beat_position: 9,
        decision: {
          action: 'relocalize',
          reason: 'large_jump',
          experience_state: 'following',
          display_anchor: { beat: 9, render_note_ids: ['n3'] },
          confidence_summary: {
            visual: 0.9,
            alignment: 0.9,
            audio: 0.9,
            continuity: 0.8,
            validation: 0.9,
            input_policy: 1,
          },
        },
      })
    );

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n3"]')).toHaveClass('practice-note-active');
  });

  it('uses backend display-anchor render note ids for musical event highlighting', () => {
    const controller = new PracticeFollowController();
    const container = makeContainer();
    const adapter = makeAdapter(entries);

    controller.apply(
      container,
      adapter,
      makeAlignment({
        decision: {
          action: 'advance',
          reason: 'stable_match',
          experience_state: 'following',
          display_anchor: { beat: 3, render_note_ids: ['n1', 'n2'] },
          confidence_summary: {
            visual: 0.95,
            alignment: 0.95,
            audio: 0.95,
            continuity: 0.95,
            validation: 0.95,
            input_policy: 1,
          },
        },
      })
    );

    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');
  });
});
