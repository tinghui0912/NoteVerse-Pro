function escapeCssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

export function findScoreElementByRenderId(container: ParentNode, renderId: string): Element | null {
  return container.querySelector(`[data-id=${JSON.stringify(renderId)}]`)
    ?? container.querySelector(`#${escapeCssId(renderId)}`);
}

export function findScoreGraphicsElementByRenderId(container: ParentNode, renderId: string): SVGGraphicsElement | null {
  return findScoreElementByRenderId(container, renderId) as SVGGraphicsElement | null;
}
