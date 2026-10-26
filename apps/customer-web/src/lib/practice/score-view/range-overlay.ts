import { findScoreGraphicsElementByRenderId } from './dom';
import { SCORE_DECORATIONS } from './decorations';

function clearRangeBackgrounds(container: HTMLElement) {
  container
    .querySelectorAll(`[${SCORE_DECORATIONS.rangeBackgroundAttribute}]`)
    .forEach((element) => element.remove());
}

export function isRangeBackgroundMutation(mutation: MutationRecord) {
  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return (
    changedNodes.length > 0 &&
    changedNodes.every(
      (node) =>
        node instanceof Element &&
        node.hasAttribute(SCORE_DECORATIONS.rangeBackgroundAttribute)
    )
  );
}

function applyRangeBackgrounds(
  container: HTMLElement,
  noteIds: readonly string[]
) {
  const systemBoxes = new Map<SVGGraphicsElement, DOMRect>();
  for (const noteId of Array.from(new Set(noteIds.filter(Boolean)))) {
    const note = findScoreGraphicsElementByRenderId(container, noteId);
    if (!note || typeof note.getBBox !== 'function') {
      continue;
    }

    let box: DOMRect;
    try {
      box = note.getBBox();
    } catch {
      continue;
    }

    const system = note.closest<SVGGraphicsElement>('.system');
    const layer = system ?? note.ownerSVGElement;
    if (!layer) {
      continue;
    }

    const currentBox = systemBoxes.get(layer);
    systemBoxes.set(layer, currentBox ? mergeRangeBox(currentBox, box) : box);
  }

  for (const [layer, rangeBox] of systemBoxes) {
    const verticalBox = rangeVerticalBox(layer, rangeBox);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const paddingX = Math.max(8, rangeBox.width * 0.02);
    const paddingY = Math.max(8, verticalBox.height * 0.04);
    rect.setAttribute(SCORE_DECORATIONS.rangeBackgroundAttribute, 'true');
    rect.setAttribute('class', SCORE_DECORATIONS.rangeBackground);
    rect.setAttribute('x', String(rangeBox.x - paddingX));
    rect.setAttribute('y', String(verticalBox.y - paddingY));
    rect.setAttribute('width', String(rangeBox.width + paddingX * 2));
    rect.setAttribute('height', String(verticalBox.height + paddingY * 2));
    rect.setAttribute('rx', '4');
    layer.insertBefore(rect, layer.firstChild);
  }
}

function mergeRangeBox(first: DOMRect, second: DOMRect): DOMRect {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return DOMRect.fromRect({
    x,
    y,
    width: right - x,
    height: bottom - y,
  });
}

function rangeVerticalBox(layer: SVGGraphicsElement, rangeBox: DOMRect): DOMRect {
  if (!layer.classList.contains('system')) {
    return rangeBox;
  }

  try {
    const systemBox = layer.getBBox();
    return DOMRect.fromRect({
      x: rangeBox.x,
      y: systemBox.y,
      width: rangeBox.width,
      height: systemBox.height,
    });
  } catch {
    return rangeBox;
  }
}

function clearRangeClasses(container: HTMLElement) {
  container
    .querySelectorAll(`.${SCORE_DECORATIONS.rangeSelected}`)
    .forEach((element) => element.classList.remove(SCORE_DECORATIONS.rangeSelected));
}

function applyRangeClasses(
  container: HTMLElement,
  selectedNoteIds: readonly string[]
) {
  for (const id of Array.from(new Set(selectedNoteIds.filter(Boolean)))) {
    const el = findScoreGraphicsElementByRenderId(container, id);
    el?.classList.add(SCORE_DECORATIONS.rangeSelected);
  }
}

export function syncRangeOverlay(container: HTMLElement, noteIds: readonly string[]): void {
  clearRangeBackgrounds(container); applyRangeBackgrounds(container, noteIds);
  clearRangeClasses(container); applyRangeClasses(container, noteIds);
}

export function clearRangeOverlay(container: HTMLElement): void {
  clearRangeBackgrounds(container); clearRangeClasses(container);
}
