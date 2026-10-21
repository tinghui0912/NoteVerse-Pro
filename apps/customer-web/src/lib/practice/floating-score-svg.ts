const FLOATING_SCORE_COLOR = '#f8fafc';

const NON_DRAWING_ANCESTORS = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern']);
const DRAWING_ELEMENTS = 'path, line, polyline, polygon, ellipse, circle, rect, text, tspan, use';

export function applyFloatingScoreSvgStyle(svg: SVGSVGElement): void {
  for (const element of Array.from(svg.querySelectorAll<SVGElement>(DRAWING_ELEMENTS))) {
    if (hasNonDrawingAncestor(element)) continue;
    setLightPaint(element, 'fill');
    setLightPaint(element, 'stroke');
  }
}

function setLightPaint(element: SVGElement, property: 'fill' | 'stroke') {
  const attribute = element.getAttribute(property)?.trim().toLowerCase();
  const inlineValue = element.style.getPropertyValue(property).trim().toLowerCase();
  if (attribute === 'none' || inlineValue === 'none') return;
  element.setAttribute(property, FLOATING_SCORE_COLOR);
  element.style.setProperty(property, FLOATING_SCORE_COLOR, 'important');
}

function hasNonDrawingAncestor(element: SVGElement): boolean {
  let parent = element.parentElement;
  while (parent) {
    if (NON_DRAWING_ANCESTORS.has(parent.localName.toLowerCase())) return true;
    parent = parent.parentElement;
  }
  return false;
}

