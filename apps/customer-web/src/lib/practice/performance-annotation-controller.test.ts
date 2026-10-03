// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

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
});
