// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  PerformanceAnnotationController,
  noteAnnotationsFromContinuousEvaluation,
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

  it('derives strike-level note annotations without coloring pending notes', () => {
    const annotations = noteAnnotationsFromContinuousEvaluation({
      strikes: [
        {
          strikeId: 'c',
          groupId: 'g-1',
          pitch: 'C4',
          expectedPerformanceTimeMs: 1000,
          renderNoteIds: ['note-c'],
          verdict: 'MATCHED',
          matchedObservationId: 'obs-c',
          timingOffsetMs: 0,
        },
        {
          strikeId: 'e',
          groupId: 'g-1',
          pitch: 'E4',
          expectedPerformanceTimeMs: 1000,
          renderNoteIds: ['note-e'],
          verdict: 'MISSING',
        },
        {
          strikeId: 'g',
          groupId: 'g-1',
          pitch: 'G4',
          expectedPerformanceTimeMs: 1000,
          renderNoteIds: ['note-g'],
          verdict: 'PENDING',
        },
      ],
      extras: [{ observationId: 'extra', pitch: 'F#4', performanceTimeMs: 1000, confidence: 0.8, source: 'ACOUSTIC' }],
    });

    expect(annotations.confirmedCorrectNoteIds).toEqual(['note-c']);
    expect(annotations.confirmedErrorNoteIds).toEqual(['note-e']);
    expect(annotations.confirmedCorrectNoteIds).not.toContain('note-g');
    expect(annotations.confirmedErrorNoteIds).not.toContain('note-g');
  });
});
