export const SCORE_EDITOR_SELECTED_CLASS = 'score-editor-selected';
export const SCORE_EDITOR_SELECTION_COLOR_PROPERTY = '--score-editor-selection-color';

function isStyleableElement(element: Element): element is HTMLElement | SVGElement {
  return element instanceof HTMLElement || element instanceof SVGElement;
}

export function clearSelectedVerovioElements(container: Element): void {
  container
    .querySelectorAll(`.${SCORE_EDITOR_SELECTED_CLASS}`)
    .forEach((element) => {
      element.classList.remove(SCORE_EDITOR_SELECTED_CLASS);
      if (isStyleableElement(element)) {
        element.style.removeProperty(SCORE_EDITOR_SELECTION_COLOR_PROPERTY);
      }
    });
}

export function applySelectedVerovioElements(params: {
  container: Element;
  sourceIds: Set<string> | null;
  selectedColor?: string;
}): void {
  const { container, sourceIds, selectedColor } = params;
  clearSelectedVerovioElements(container);

  if (!sourceIds) return;

  container.querySelectorAll('[data-id], [id]').forEach((element) => {
    const id = element.getAttribute('data-id') || element.getAttribute('id');
    if (!id || !sourceIds.has(id)) return;

    element.classList.add(SCORE_EDITOR_SELECTED_CLASS);
    if (selectedColor && isStyleableElement(element)) {
      element.style.setProperty(SCORE_EDITOR_SELECTION_COLOR_PROPERTY, selectedColor);
    }
  });
}
