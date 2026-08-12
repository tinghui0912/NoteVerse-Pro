// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  SCORE_EDITOR_SELECTED_CLASS,
  SCORE_EDITOR_SELECTION_COLOR_PROPERTY,
  applySelectedVerovioElements,
  clearSelectedVerovioElements,
} from '@/components/editor/editor-preview-selection-highlight';

function createContainer() {
  const container = document.createElement('div');
  container.innerHTML = `
    <svg>
      <g data-id="note-a"></g>
      <g id="note-b"></g>
      <g data-id="note-c" class="${SCORE_EDITOR_SELECTED_CLASS}" style="${SCORE_EDITOR_SELECTION_COLOR_PROPERTY}: #111111"></g>
    </svg>
  `;
  return container;
}

describe('editor preview selection highlight helpers', () => {
  it('clears existing selected classes and selection colors', () => {
    const container = createContainer();

    clearSelectedVerovioElements(container);

    const previous = container.querySelector('[data-id="note-c"]') as SVGElement;
    expect(previous.classList.contains(SCORE_EDITOR_SELECTED_CLASS)).toBe(false);
    expect(previous.style.getPropertyValue(SCORE_EDITOR_SELECTION_COLOR_PROPERTY)).toBe('');
  });

  it('applies selected class and color to elements matching source ids', () => {
    const container = createContainer();

    applySelectedVerovioElements({
      container,
      sourceIds: new Set(['note-a', 'note-b']),
      selectedColor: '#2563eb',
    });

    const noteA = container.querySelector('[data-id="note-a"]') as SVGElement;
    const noteB = container.querySelector('#note-b') as SVGElement;
    const noteC = container.querySelector('[data-id="note-c"]') as SVGElement;

    expect(noteA.classList.contains(SCORE_EDITOR_SELECTED_CLASS)).toBe(true);
    expect(noteB.classList.contains(SCORE_EDITOR_SELECTED_CLASS)).toBe(true);
    expect(noteC.classList.contains(SCORE_EDITOR_SELECTED_CLASS)).toBe(false);
    expect(noteA.style.getPropertyValue(SCORE_EDITOR_SELECTION_COLOR_PROPERTY)).toBe('#2563eb');
    expect(noteB.style.getPropertyValue(SCORE_EDITOR_SELECTION_COLOR_PROPERTY)).toBe('#2563eb');
    expect(noteC.style.getPropertyValue(SCORE_EDITOR_SELECTION_COLOR_PROPERTY)).toBe('');
  });

  it('clears previous selection without adding a new selection when source ids are absent', () => {
    const container = createContainer();

    applySelectedVerovioElements({
      container,
      sourceIds: null,
      selectedColor: '#2563eb',
    });

    expect(container.querySelectorAll(`.${SCORE_EDITOR_SELECTED_CLASS}`)).toHaveLength(0);
  });
});
