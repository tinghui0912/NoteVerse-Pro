// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { PracticeSummaryAnnotationController } from './summary-annotation-controller';

describe('PracticeSummaryAnnotationController', () => {
  it('applies performance annotations and replaces stale annotations', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <span data-id="n1"></span>
      <span data-id="n2"></span>
      <span id="n3"></span>
    `;
    const controller = new PracticeSummaryAnnotationController();

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
    const controller = new PracticeSummaryAnnotationController();

    controller.apply(container, {
      confirmedCorrectNoteIds: ['n1'],
      confirmedErrorNoteIds: [],
    });
    controller.clear(container);

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-confirmed-correct'
    );
  });
});
