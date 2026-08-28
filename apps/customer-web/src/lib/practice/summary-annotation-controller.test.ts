// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { PracticeSummaryAnnotationController } from './summary-annotation-controller';

describe('PracticeSummaryAnnotationController', () => {
  it('applies problem-note annotations and replaces stale annotations', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <span data-id="n1"></span>
      <span data-id="n2"></span>
      <span id="n3"></span>
    `;
    const controller = new PracticeSummaryAnnotationController();

    controller.apply(container, {
      problemNoteIds: ['n2', 'missing', 'n2'],
      reviewNoteIds: ['n1'],
    });

    expect(container.querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-review'
    );
    expect(container.querySelector('[data-id="n2"]')).toHaveClass(
      'practice-summary-note-problem'
    );

    controller.apply(container, { problemNoteIds: ['n3'], reviewNoteIds: [] });

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-review'
    );
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass(
      'practice-summary-note-problem'
    );
    expect(container.querySelector('#n3')).toHaveClass('practice-summary-note-problem');
  });

  it('clears annotations from the current container', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span data-id="n1"></span>';
    const controller = new PracticeSummaryAnnotationController();

    controller.apply(container, { problemNoteIds: ['n1'], reviewNoteIds: [] });
    controller.clear(container);

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-problem'
    );
  });
});
