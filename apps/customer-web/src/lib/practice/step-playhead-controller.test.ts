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
      <g data-class="chord" data-testid="chord-1">
        <g data-class="stem" data-testid="stem-1"></g>
        <g data-id="n1"></g>
      </g>
      <g data-id="n2"></g>
      <g data-id="n3"></g>
    </div>
  `;
  document.body.appendChild(container);
  return container;
}

describe('StepPlayheadController', () => {
  it('highlights current active target notes and clears previous target', () => {
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
    expect(container.querySelector('[data-id="n1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-testid="chord-1"]')).toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass('practice-note-active');

    // Advance to next group
    controller.apply(container, adapter, group2);
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-testid="chord-1"]')).not.toHaveClass('practice-note-active');
    expect(container.querySelector('[data-id="n2"]')).toHaveClass('practice-note-active');

    // End/null
    controller.apply(container, adapter, null);
    expect(container.querySelector('.practice-note-active')).toBeNull();
  });
});
