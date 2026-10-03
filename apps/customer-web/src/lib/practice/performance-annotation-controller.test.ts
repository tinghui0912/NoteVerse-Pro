// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  PerformanceAnnotationController,
  noteAnnotationsFromPerformanceOutcomes,
} from './performance-annotation-controller';

describe('PerformanceAnnotationController', () => {
  it('applies performance annotations and replaces stale annotations', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <span data-id="n1"></span>
      <span data-id="n2"></span>
      <span id="n3"></span>
    `;
    const controller = new PerformanceAnnotationController();

    controller.apply(container, {
      confirmedCorrectNoteIds: ['n1'],
      confirmedErrorNoteIds: ['n2', 'missing', 'n2'],
    });

    expect(container.querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-confirmed-correct'
    );
    expect(container.querySelector('[data-id="n2"]')).toHaveClass(
      'practice-summary-note-confirmed-error'
    );

    controller.apply(container, {
      confirmedCorrectNoteIds: [],
      confirmedErrorNoteIds: ['n3'],
    });

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-confirmed-correct'
    );
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass(
      'practice-summary-note-confirmed-error'
    );
    expect(container.querySelector('#n3')).toHaveClass(
      'practice-summary-note-confirmed-error'
    );
  });

  it('clears annotations from the current container', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span data-id="n1"></span>';
    const controller = new PerformanceAnnotationController();

    controller.apply(container, {
      confirmedCorrectNoteIds: ['n1'],
      confirmedErrorNoteIds: [],
    });
    controller.clear(container);

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-confirmed-correct'
    );
  });

  it('does not remove and re-add unchanged settled annotations', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <span data-id="n1"></span>
      <span data-id="n2"></span>
    `;
    const controller = new PerformanceAnnotationController();
    controller.apply(
      container,
      {
        confirmedCorrectNoteIds: [],
        confirmedErrorNoteIds: ['n1'],
      },
      { renderRevision: 1 }
    );
    const addSpy = vi.spyOn(DOMTokenList.prototype, 'add');
    const removeSpy = vi.spyOn(DOMTokenList.prototype, 'remove');

    controller.apply(
      container,
      {
        confirmedCorrectNoteIds: [],
        confirmedErrorNoteIds: ['n1', 'n2'],
      },
      { renderRevision: 1 }
    );

    expect(container.querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-confirmed-error'
    );
    expect(container.querySelector('[data-id="n2"]')).toHaveClass(
      'practice-summary-note-confirmed-error'
    );
    expect(
      removeSpy.mock.calls.some((call) =>
        call.includes('practice-summary-note-confirmed-error')
      )
    ).toBe(false);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it('rehydrates settled annotations when the score DOM render revision changes', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span data-id="n1"></span>';
    const controller = new PerformanceAnnotationController();
    controller.apply(
      container,
      {
        confirmedCorrectNoteIds: [],
        confirmedErrorNoteIds: ['n1'],
      },
      { renderRevision: 1 }
    );

    container.innerHTML = '<span data-id="n1"></span>';
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-confirmed-error'
    );

    controller.apply(
      container,
      {
        confirmedCorrectNoteIds: [],
        confirmedErrorNoteIds: ['n1'],
      },
      { renderRevision: 2 }
    );

    expect(container.querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-confirmed-error'
    );
  });

  it('derives strike-level note annotations without coloring unconfirmed notes', () => {
    const annotations = noteAnnotationsFromPerformanceOutcomes([
      {
        expectedGroupId: 'g-1',
        performanceTimeMs: 1000,
        result: 'PARTIAL',
        confidence: 0.95,
        source: 'ACOUSTIC',
        expectedStrikeOutcomes: [
          {
            strikeId: 'c',
            pitch: 'C4',
            renderNoteIds: ['note-c'],
            result: 'MATCHED',
          },
          {
            strikeId: 'e',
            pitch: 'E4',
            renderNoteIds: ['note-e'],
            result: 'MISSING',
          },
          {
            strikeId: 'g',
            pitch: 'G4',
            renderNoteIds: ['note-g'],
            result: 'UNCONFIRMED',
          },
        ],
        unexpectedPitches: ['F#4'],
        renderNoteIds: ['note-c', 'note-e', 'note-g'],
        measureNumbers: ['1'],
      },
    ]);

    expect(annotations.confirmedCorrectNoteIds).toEqual(['note-c']);
    expect(annotations.confirmedErrorNoteIds).toEqual(['note-e']);
    expect(annotations.confirmedCorrectNoteIds).not.toContain('note-g');
    expect(annotations.confirmedErrorNoteIds).not.toContain('note-g');
  });

  it('ignores incomplete outcome records instead of crashing annotation projection', () => {
    const annotations = noteAnnotationsFromPerformanceOutcomes([
      {
        expectedGroupId: 'legacy-incomplete',
        performanceTimeMs: 0,
        result: 'MISMATCH',
        confidence: 0,
        source: 'MIDI',
        unexpectedPitches: [],
        measureNumbers: [],
        expectedStrikeOutcomes: undefined as never,
        renderNoteIds: undefined as never,
      },
    ]);

    expect(annotations).toEqual({
      confirmedCorrectNoteIds: [],
      confirmedErrorNoteIds: [],
    });
  });
});
